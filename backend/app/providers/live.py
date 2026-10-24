"""OpenAI-compatible Groq HTTP adapter, no retries, no demo fallback."""
import asyncio
from time import perf_counter

import httpx

from .base import InferenceResult, ProviderError
from ..pricing import cost

SYSTEM_MESSAGE = "Follow the user's task. Be concise. Return only the requested answer."


class LiveProvider:
    def __init__(self, settings, store, transport=None):
        self.settings = settings
        self.store = store
        self.transport = transport

    async def infer(self, prompt: str, model_id: str, run_id: str, allowed_models=None,
                    system_message: str = SYSTEM_MESSAGE) -> InferenceResult:
        allowed = allowed_models or (self.settings.small_model_id, self.settings.large_model_id)
        if self.settings.live_disabled_reason or model_id not in allowed:
            raise ProviderError('PROVIDER_UNAVAILABLE')
        # Full advertised context + output ceiling is a conservative reservation,
        # NOT an estimate of missing usage. Unknown/failed usage retains it.
        completion_limit = self.settings.completion_limit_for(model_id)
        ceiling = cost(model_id, 131072, completion_limit)
        reservation = self.store.reserve_inference(run_id, ceiling, self.settings)
        headers = {'Authorization': 'Bearer ' + self.settings.api_key} if self.settings.api_key else {}
        payload = {'model': model_id, 'messages': [{'role': 'system', 'content': system_message},
                   {'role': 'user', 'content': prompt}], 'temperature': 0,
                   'max_completion_tokens': completion_limit, 'stream': False}
        try:
            async with asyncio.timeout(self.settings.request_timeout_seconds):
                async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds, follow_redirects=False,
                                             transport=self.transport) as client:
                    started = perf_counter()
                    response = await client.post(self.settings.base_url.rstrip('/') + '/chat/completions',
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
            output = body['choices'][0]['message']['content']
            finish_reason = body['choices'][0].get('finish_reason')
            if not isinstance(output, str):
                raise ValueError()
        except (ValueError, TypeError, KeyError, IndexError):
            raise ProviderError('PROVIDER_BAD_RESPONSE') from None
        usage = body.get('usage')
        usage = usage if isinstance(usage, dict) else {}
        def tokens(name):
            value = usage.get(name)
            return value if type(value) is int and value >= 0 else None
        inputs, outputs = tokens('prompt_tokens'), tokens('completion_tokens')
        actual_cost = cost(model_id, inputs, outputs)
        if actual_cost is not None:
            self.store.settle_inference(reservation, actual_cost)
        safe_finish_reason = finish_reason if isinstance(finish_reason, str) and len(finish_reason) <= 64 else None
        return InferenceResult(output, latency, inputs, outputs, safe_finish_reason,
                               safe_finish_reason == 'length' if safe_finish_reason is not None else None)
