"""Backend-owned provider endpoints and the small, price-bounded model catalog."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderModel:
    key: str
    provider: str
    model_id: str
    label: str
    input_usd_per_million: float
    output_usd_per_million: float
    max_completion_tokens: int
    local: bool = False


PROVIDER_INFO = {
    'groq': {'label': 'Groq', 'endpoint': 'https://api.groq.com/openai/v1', 'key_env': 'GROQ_API_KEY', 'adapter': 'openai'},
    'openai': {'label': 'OpenAI', 'endpoint': 'https://api.openai.com/v1', 'key_env': 'OPENAI_API_KEY', 'adapter': 'openai'},
    'gemini': {'label': 'Google Gemini', 'endpoint': 'https://generativelanguage.googleapis.com/v1beta/openai', 'key_env': 'GEMINI_API_KEY', 'adapter': 'openai'},
    'anthropic': {'label': 'Anthropic Claude', 'endpoint': 'https://api.anthropic.com/v1', 'key_env': 'ANTHROPIC_API_KEY', 'adapter': 'anthropic'},
    'ollama': {'label': 'Ollama (local)', 'endpoint': 'http://127.0.0.1:11434/v1', 'key_env': None, 'adapter': 'openai'},
}


def _model(provider: str, model_id: str, label: str, input_rate: float, output_rate: float,
           max_output: int = 32768, local: bool = False) -> ProviderModel:
    return ProviderModel(f'{provider}::{model_id}', provider, model_id, label,
                         input_rate, output_rate, max_output, local)


MODELS = {
    'groq::openai/gpt-oss-20b': _model('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B · Groq', 0.075, 0.30, 65536),
    'groq::openai/gpt-oss-120b': _model('groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B · Groq', 0.15, 0.60, 65536),
    'groq::qwen/qwen3.8-27b': _model('groq', 'qwen/qwen3.8-27b', 'Qwen 3.8 27B · Groq', 0.80, 4.00, 16384),
    'openai::gpt-6-luna': _model('openai', 'gpt-6-luna', 'GPT-6 Luna · OpenAI', 0.10, 0.50, 65536),
    'openai::gpt-6.1-sol': _model('openai', 'gpt-6.1-sol', 'GPT-6.1 Sol · OpenAI', 2.00, 10.00, 65536),
    'gemini::gemini-3.8-flash': _model('gemini', 'gemini-3.8-flash', 'Gemini 3.8 Flash', 0.75, 3.75, 65536),
    'anthropic::claude-haiku-5-5': _model('anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5', 0.50, 2.50, 65536),
    'anthropic::claude-sonnet-5-5': _model('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', 2.00, 10.00, 65536),
    # Ollama's local API has no hosted token fee. This is not a total-cost or energy estimate.
    'ollama::qwen3:8b': _model('ollama', 'qwen3:8b', 'Qwen 3 8B · Ollama local', 0.0, 0.0, 32768, True),
    'ollama::gpt-oss:20b': _model('ollama', 'gpt-oss:20b', 'GPT-OSS 20B · Ollama local', 0.0, 0.0, 32768, True),
}


def normalize_model_key(model_id: str) -> str:
    """Accept legacy Groq IDs in existing env files and snapshots."""
    if model_id in MODELS:
        return model_id
    legacy = f'groq::{model_id}'
    return legacy if legacy in MODELS else model_id


def get_model(model_id: str) -> ProviderModel | None:
    return MODELS.get(normalize_model_key(model_id))
