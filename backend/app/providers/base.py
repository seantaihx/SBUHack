"""Inference result and safe, allowlisted attempt errors."""
from dataclasses import dataclass

from ..schemas import ErrorInfo


@dataclass(frozen=True)
class InferenceResult:
    output_text: str
    latency_ms: float
    input_tokens: int | None
    output_tokens: int | None


_MESSAGES = {
    'PROVIDER_TIMEOUT': 'The inference attempt exceeded its deadline.',
    'PROVIDER_AUTH_ERROR': 'The inference provider rejected authentication.',
    'PROVIDER_RATE_LIMITED': 'The provider or configured server request/spending limits blocked this attempt.',
    'PROVIDER_UNAVAILABLE': 'The inference provider is unavailable.',
    'PROVIDER_BAD_RESPONSE': 'The inference provider returned an invalid response.',
}


class ProviderError(Exception):
    def __init__(self, code: str):
        # No provider response body, endpoint, exception text or auth header is accepted here.
        self.error = ErrorInfo(code=code, message=_MESSAGES[code])
        super().__init__(code)
