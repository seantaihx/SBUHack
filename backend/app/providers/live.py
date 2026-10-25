"""OpenAI-compatible Groq HTTP adapter, no retries, no demo fallback."""
import asyncio
import ipaddress
from time import perf_counter
from urllib.parse import urlsplit

import httpx

from .base import InferenceResult, ProviderError
from ..pricing import cost
from ..model_catalog import PROVIDER_INFO, get_model
from ..gpu_energy import NvidiaGpuPowerSampler

SYSTEM_MESSAGE = "Follow the user's task. Be concise. Return only the requested answer."


class LiveProvider:
    def __init__(self, settings, store, transport=None):
        self.settings = settings
        self.store = store
        self.transport = transport

    async def infer(self, prompt: str, model_id: str, run_id: str, allowed_models=None,
                    system_message: str = SYSTEM_MESSAGE, task_id: str | None = None,
                    max_completion_tokens: int | None = None,
                    measure_gpu_energy: bool = False,
                    response_format: dict | None = None,
                    input_token_ceiling: int | None = None) -> InferenceResult:
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
        if input_token_ceiling is not None:
            if type(input_token_ceiling) is not int or input_token_ceiling < 1:
                raise ProviderError('PROVIDER_BAD_REQUEST')
            input_ceiling = min(131072, input_token_ceiling)
        else:
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
        elif provider_id == 'ollama':
            # Use Ollama's native response so eval_count/eval_duration remain available.
            # Its configured OpenAI-compatible URL is local and validated in Settings.
            parts = urlsplit(endpoint)
            url = f'{parts.scheme}://{parts.netloc}/api/chat'
            headers = {}
            payload = {'model': actual_model_id,
                       'messages': [{'role': 'system', 'content': system_message},
                                    {'role': 'user', 'content': prompt}],
                       'options': {'temperature': 0, 'num_predict': completion_limit},
                       'think': False, 'stream': False}
            if response_format is not None:
                if response_format.get('type') == 'json_schema':
                    schema = response_format.get('json_schema', {}).get('schema')
                    if isinstance(schema, dict):
                        # Ollama's native /api/chat accepts a JSON Schema directly
                        # in `format`; the OpenAI wrapper is not its native shape.
                        payload['format'] = schema
                elif response_format.get('type') == 'json_object':
                    payload['format'] = 'json'
        else:
            headers = {'Authorization': 'Bearer ' + api_key} if api_key else {}
            token_field = 'max_tokens' if provider_id == 'gemini' else 'max_completion_tokens'
            payload = {'model': actual_model_id, 'messages': [{'role': 'system', 'content': system_message},
                       {'role': 'user', 'content': prompt}], 'temperature': 0,
                       token_field: completion_limit, 'stream': False}
            # Structured-output support varies by provider/model. Callers only pass
            # this for an explicitly supported combination; other adapters retain
            # their existing request formats.
            if provider_id == 'groq' and response_format is not None:
                payload['response_format'] = response_format
            url = endpoint.rstrip('/') + '/chat/completions'
        sampler = await NvidiaGpuPowerSampler.start() if provider_id == 'ollama' and measure_gpu_energy else None
        gpu_measurement = None
        started = None
        try:
            if sampler is not None:
                await sampler.sample_idle_baseline(self.settings.gpu_idle_baseline_seconds)
            started = perf_counter()
            async with asyncio.timeout(self.settings.request_timeout_seconds):
                async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds, follow_redirects=False,
                                             transport=self.transport) as client:
                    response = await client.post(url,
                                                 headers=headers, json=payload)
                    ended = perf_counter()
                    latency = (ended - started) * 1000
        except (TimeoutError, httpx.TimeoutException):
            raise ProviderError('PROVIDER_TIMEOUT') from None
        except httpx.RequestError:
            raise ProviderError('PROVIDER_UNAVAILABLE') from None
        finally:
            if sampler is not None:
                ended = perf_counter()
                try:
                    if started is None:
                        await sampler.close()
                    else:
                        gpu_measurement = await sampler.measure(started, ended)
                except (OSError, ProcessLookupError, RuntimeError):
                    # Optional telemetry must never turn a successful inference into an error.
                    gpu_measurement = None
        status = response.status_code
        if status in (401, 403):
            raise ProviderError('PROVIDER_AUTH_ERROR')
        if status == 429:
            raise ProviderError('PROVIDER_RATE_LIMITED')
        if status >= 500:
            raise ProviderError('PROVIDER_UNAVAILABLE')
        if status != 200:
            raise ProviderError('PROVIDER_BAD_RESPONSE', {'provider_http_status': status, 'failure_stage': 'http'})
        try:
            body = response.json()
            if provider_id == 'anthropic':
                content = body['content']
                output = ''.join(block.get('text', '') for block in content
                                 if isinstance(block, dict) and block.get('type') == 'text')
                finish_reason = body.get('stop_reason')
                usage = body.get('usage')
            elif provider_id == 'ollama':
                output = body['message']['content']
                finish_reason = body.get('done_reason')
                usage = {'prompt_eval_count': body.get('prompt_eval_count'),
                         'eval_count': body.get('eval_count')}
            else:
                output = body['choices'][0]['message']['content']
                finish_reason = body['choices'][0].get('finish_reason')
                usage = body.get('usage')
            if not isinstance(output, str) or not output:
                raise ValueError()
        except (ValueError, TypeError, KeyError, IndexError):
            raise ProviderError('PROVIDER_BAD_RESPONSE', {'provider_http_status': 200, 'failure_stage': 'response_body'}) from None
        usage = usage if isinstance(usage, dict) else {}
        def tokens(name):
            value = usage.get(name)
            return value if type(value) is int and value >= 0 else None
        if provider_id == 'anthropic':
            inputs, outputs = tokens('input_tokens'), tokens('output_tokens')
        elif provider_id == 'ollama':
            inputs, outputs = tokens('prompt_eval_count'), tokens('eval_count')
        else:
            inputs, outputs = tokens('prompt_tokens'), tokens('completion_tokens')
        output_tokens_per_second = None
        if provider_id == 'ollama':
            eval_duration = body.get('eval_duration')
            if (outputs is not None and type(eval_duration) is int and eval_duration > 0):
                output_tokens_per_second = outputs / (eval_duration / 1_000_000_000)
        actual_cost = cost(model_id, inputs, outputs)
        if actual_cost is not None:
            self.store.settle_inference(reservation, actual_cost)
        safe_finish_reason = finish_reason if isinstance(finish_reason, str) and len(finish_reason) <= 64 else None
        truncated_reasons = {'length', 'max_tokens', 'MAX_TOKENS', 'model_context_window_exceeded'}
        completed_reasons = {'stop', 'end_turn', 'stop_sequence', 'STOP', 'tool_use'}
        output_truncated = (True if safe_finish_reason in truncated_reasons else
                            False if safe_finish_reason in completed_reasons else None)
        return InferenceResult(output, latency, inputs, outputs, safe_finish_reason,
                               output_truncated,
                               gpu_measurement.energy_wh if gpu_measurement else None,
                               'nvidia_smi_power_draw' if gpu_measurement and gpu_measurement.energy_wh is not None else None,
                               gpu_measurement.gpu_index if gpu_measurement else None,
                               gpu_measurement.gpu_name if gpu_measurement else None,
                               gpu_measurement.utilization_pct if gpu_measurement else None,
                               gpu_measurement.average_power_w if gpu_measurement else None,
                               gpu_measurement.sample_count if gpu_measurement else None,
                               gpu_measurement.idle_baseline_power_w if gpu_measurement else None,
                               gpu_measurement.idle_baseline_utilization_pct if gpu_measurement else None,
                               gpu_measurement.idle_baseline_sample_count if gpu_measurement else None,
                               gpu_measurement.idle_baseline_duration_ms if gpu_measurement else None,
                               (gpu_measurement.average_power_w - gpu_measurement.idle_baseline_power_w
                                if gpu_measurement and gpu_measurement.average_power_w is not None
                                and gpu_measurement.idle_baseline_power_w is not None else None),
                               output_tokens_per_second,
                               'ollama_eval_duration' if output_tokens_per_second is not None else None)
