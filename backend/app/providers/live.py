"""OpenAI-compatible Groq HTTP adapter, no retries, no demo fallback."""
import asyncio
import ipaddress
from time import perf_counter
from urllib.parse import urlsplit

import httpx

from .base import InferenceResult, ProviderError
from ..pricing import cost
from ..model_catalog import PROVIDER_INFO, get_model

SYSTEM_MESSAGE = "Follow the user's task. Be concise. Return only the requested answer."


class LiveProvider:
    def __init__(self, settings, store, transport=None):
        self.settings = settings
        self.store = store
        self.transport = transport

    async def infer(self, prompt: str, model_id: str, run_id: str, allowed_models=None,
                    system_message: str = SYSTEM_MESSAGE, task_id: str | None = None,
                    max_completion_tokens: int | None = None) -> InferenceResult:
        allowed = allowed_models or (self.settings.small_model_id, self.settings.large_model_id)
        if not self.settings.live_enabled or model_id not in allowed:
            raise ProviderError('PROVIDER_UNAVAILABLE')
        spec = get_model(model_id)
        provider_id = spec.provider if spec else 'groq'
        actual_model_id = spec.model_id if spec else model_id
        provider = PROVIDER_INFO.get(provider_id)
        if provider is None:
            raise ProviderError('PROVIDER_UNAVAILABLE')
        if provider_id == 'ollama':
            endpoint = self.settings.ollama_base_url
        elif provider_id == 'groq':
            endpoint = self.settings.base_url
        else:
            endpoint = provider['endpoint']
        if provider['key_env'] and not self.settings.api_key_for_model(model_id):
            # Custom local OpenAI-compatible endpoints may intentionally be unauthenticated.
            host = urlsplit(endpoint).hostname or ''
            try:
                local_endpoint = host.casefold() == 'localhost' or ipaddress.ip_address(host).is_loopback
            except ValueError:
                local_endpoint = False
            if not local_endpoint:
                raise ProviderError('PROVIDER_AUTH_ERROR')
        completion_limit = self.settings.completion_limit_for(model_id)
        if max_completion_tokens is not None:
            if type(max_completion_tokens) is not int or max_completion_tokens < 1:
                raise ProviderError('PROVIDER_BAD_REQUEST')
            completion_limit = min(completion_limit, max_completion_tokens)
        # Comparisons keep the historic full-context reservation. Agent calls reserve
        # a conservative UTF-8 byte ceiling for the actual submitted prompt, plus framing.
        input_ceiling = 131072 if task_id is None else min(131072, len((system_message + prompt).encode('utf-8')) + 512)
        ceiling = cost(model_id, input_ceiling, completion_limit)
        reservation = self.store.reserve_inference(run_id, ceiling, self.settings, task_id=task_id)
        api_key = self.settings.api_key_for_model(model_id)
        if provider_id == 'anthropic':
            headers = {'Authorization': 'Bearer ' + api_key, 'anthropic-version': '2023-06-01'}
            payload = {'model': actual_model_id, 'system': system_message,
                       'messages': [{'role': 'user', 'content': prompt}],
                       'max_tokens': completion_limit, 'temperature': 0, 'stream': False}
            url = endpoint.rstrip('/') + '/messages'
        else:
            headers = {'Authorization': 'Bearer ' + api_key} if api_key and provider_id != 'ollama' else {}
            token_field = 'max_tokens' if provider_id in ('gemini', 'ollama') else 'max_completion_tokens'
            payload = {'model': actual_model_id, 'messages': [{'role': 'system', 'content': system_message},
                       {'role': 'user', 'content': prompt}], 'temperature': 0,
                       token_field: completion_limit, 'stream': False}
            url = endpoint.rstrip('/') + '/chat/completions'
        try:
            async with asyncio.timeout(self.settings.request_timeout_seconds):
                async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds, follow_redirects=False,
                                             transport=self.transport) as client:
                    started = perf_counter()
                    response = await client.post(url,
                                                 headers=headers, json=payload)
                    latency = (perf_counter() - started) * 1000
        except (TimeoutError, httpx.TimeoutException):
            raise ProviderError('PROVIDER_TIMEOUT') from None
        except httpx.RequestError:
            raise ProviderError('PROVIDER_UNAVAILABLE') from None
        status = response.status_code
        if status in (401, 403):
            raise ProviderError('PROVIDER_AUTH_ERROR')
        if status == 429:
            raise ProviderError('PROVIDER_RATE_LIMITED')
        if status >= 500:
            raise ProviderError('PROVIDER_UNAVAILABLE')
        if status != 200:
            raise ProviderError('PROVIDER_BAD_RESPONSE')
        try:
            body = response.json()
            if provider_id == 'anthropic':
                content = body['content']
                output = ''.join(block.get('text', '') for block in content
                                 if isinstance(block, dict) and block.get('type') == 'text')
                finish_reason = body.get('stop_reason')
                usage = body.get('usage')
            else:
                output = body['choices'][0]['message']['content']
                finish_reason = body['choices'][0].get('finish_reason')
                usage = body.get('usage')
            if not isinstance(output, str) or not output:
                raise ValueError()
        except (ValueError, TypeError, KeyError, IndexError):
            raise ProviderError('PROVIDER_BAD_RESPONSE') from None
        usage = usage if isinstance(usage, dict) else {}
        def tokens(name):
            value = usage.get(name)
            return value if type(value) is int and value >= 0 else None
        if provider_id == 'anthropic':
            inputs, outputs = tokens('input_tokens'), tokens('output_tokens')
        else:
            inputs, outputs = tokens('prompt_tokens'), tokens('completion_tokens')
        actual_cost = cost(model_id, inputs, outputs)
        if actual_cost is not None:
            self.store.settle_inference(reservation, actual_cost)
        safe_finish_reason = finish_reason if isinstance(finish_reason, str) and len(finish_reason) <= 64 else None
        truncated_reasons = {'length', 'max_tokens', 'MAX_TOKENS', 'model_context_window_exceeded'}
        completed_reasons = {'stop', 'end_turn', 'stop_sequence', 'STOP', 'tool_use'}
        output_truncated = (True if safe_finish_reason in truncated_reasons else
                            False if safe_finish_reason in completed_reasons else None)
        return InferenceResult(output, latency, inputs, outputs, safe_finish_reason,
                               output_truncated)
