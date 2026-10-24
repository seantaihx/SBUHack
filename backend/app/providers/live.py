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

    async def infer(self, prompt: str, model_id: str, run_id: str) -> InferenceResult:
        if self.settings.live_disabled_reason or model_id not in (self.settings.small_model_id, self.settings.large_model_id):
            raise ProviderError('PROVIDER_UNAVAILABLE')
        # Full advertised context + output ceiling is a conservative reservation,
        # NOT an estimate of missing usage. Unknown/failed usage retains it.
        ceiling = cost(model_id, 131072, 256)
        reservation = self.store.reserve_inference(run_id, ceiling, self.settings)
        headers = {'Authorization': 'Bearer ' + self.settings.api_key} if self.settings.api_key else {}
        payload = {'model': model_id, 'messages': [{'role': 'system', 'content': SYSTEM_MESSAGE},
                   {'role': 'user', 'content': prompt}], 'temperature': 0, 'max_tokens': 256, 'stream': False}
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
        return InferenceResult(output, latency, inputs, outputs)
