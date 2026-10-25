"""Server-only settings: environment overrides root .env; api.env is not loaded."""
from dataclasses import dataclass, field
import ipaddress
from pathlib import Path
from urllib.parse import urlsplit
import math
import os
import re

from dotenv import dotenv_values
from .model_catalog import MODELS, PROVIDER_INFO, get_model, normalize_model_key

ROOT = Path(__file__).resolve().parents[2]
MODEL_MAX_COMPLETION_TOKENS = {
    'openai/gpt-oss-20b': 65536,
    'openai/gpt-oss-120b': 65536,
    'qwen/qwen3.8-27b': 16384,
}


@dataclass(frozen=True)
class Settings:
    database_path: Path = ROOT / 'backend/data/ecoagent.sqlite3'
    frontend_dist: Path = ROOT / 'frontend/dist'
    agent_workspace_root: Path | None = None
    agent_enabled: bool = False
    agent_max_steps: int = 100
    small_model_id: str = 'openai/gpt-oss-20b'
    large_model_id: str = 'openai/gpt-oss-120b'
    benchmark_max_cases: int = 20
    benchmark_extra_model_ids: tuple[str, ...] = ('qwen/qwen3.8-27b',)
    agent_role_models: dict[str, str] = field(default_factory=dict)
    benchmark_mode: str = 'simulated'
    live_enabled: bool = False
    base_url: str = 'https://api.groq.com/openai/v1'
    api_key: str = field(default='', repr=False)
    openai_api_key: str = field(default='', repr=False)
    gemini_api_key: str = field(default='', repr=False)
    anthropic_api_key: str = field(default='', repr=False)
    ollama_api_key: str = field(default='', repr=False)
    ollama_base_url: str = 'http://127.0.0.1:11434/v1'
    gpu_idle_baseline_seconds: float = 3.0
    request_timeout_seconds: float = 30
    max_completion_tokens: int = 65536
    max_requests_per_run: int = 60
    max_requests_per_minute: int = 60
    max_run_cost_usd: float = 0.50
    max_agent_task_cost_usd: float = 0.25
    max_agent_tokens_per_run: int = 48000
    max_agent_tokens_per_task: int = 12000
    max_daily_cost_usd: float = 1.00
    benchmark_runs_per_minute: int = 10

    def __post_init__(self):
        path = Path(self.database_path).expanduser()
        object.__setattr__(self, 'database_path', path if path.is_absolute() else ROOT / path)
        if self.agent_workspace_root is not None:
            workspace = Path(self.agent_workspace_root).expanduser()
            object.__setattr__(self, 'agent_workspace_root', workspace if workspace.is_absolute() else ROOT / workspace)
        try:
            ollama = urlsplit(self.ollama_base_url)
            host = ollama.hostname or ''
            is_loopback = host.casefold() == 'localhost' or ipaddress.ip_address(host).is_loopback
        except (ValueError, TypeError):
            is_loopback = False
            ollama = None
        if (not is_loopback or ollama.scheme != 'http' or ollama.username or ollama.password
                or ollama.query or ollama.fragment or ollama.path.rstrip('/') not in ('', '/v1')):
            raise ValueError('OLLAMA_BASE_URL must be a local HTTP loopback endpoint.')
        if self.benchmark_mode not in ('simulated', 'groq', 'live'):
            raise ValueError('BENCHMARK_INFERENCE_MODE must be simulated, groq, or live.')
        if type(self.max_completion_tokens) is not int or not 1 <= self.max_completion_tokens <= 65536:
            raise ValueError('INFERENCE_MAX_COMPLETION_TOKENS must be an integer from 1 to 65536.')
        if not math.isfinite(self.gpu_idle_baseline_seconds) or not 0 <= self.gpu_idle_baseline_seconds <= 10:
            raise ValueError('GPU_IDLE_BASELINE_SECONDS must be between 0 and 10.')
        if (type(self.max_agent_tokens_per_run) is not int or not 1024 <= self.max_agent_tokens_per_run <= 200000
                or type(self.max_agent_tokens_per_task) is not int or not 1024 <= self.max_agent_tokens_per_task <= self.max_agent_tokens_per_run):
            raise ValueError('Agent token budgets must be integers from 1024 to 200000, with the task budget no larger than the workflow budget.')
        limits = (self.benchmark_max_cases, self.max_requests_per_run, self.max_requests_per_minute,
                  self.max_run_cost_usd, self.max_agent_task_cost_usd, self.max_daily_cost_usd, self.benchmark_runs_per_minute,
                  self.request_timeout_seconds)
        if any(not math.isfinite(value) or value <= 0 for value in limits) or self.request_timeout_seconds > 30:
            raise ValueError('Backend limits must be positive and finite; request timeout cannot exceed 30 seconds.')
        # Identifiers are public metadata: disallow URLs, whitespace and the configured secret.
        for model in (self.small_model_id, self.large_model_id, *self.benchmark_extra_model_ids):
            if not re.fullmatch(r'(?:[a-z]+::)?[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}', model) or any(key and key in model for key in self.provider_api_keys.values()):
                raise ValueError('Configured model identifiers are invalid.')
        defaults = {
            'manager': self.large_model_id,
            'writer': self.small_model_id,
            'coder': self.large_model_id,
            'reviewer': self.large_model_id,
        }
        role_models = self.agent_role_models or defaults
        if set(role_models) != set(defaults):
            raise ValueError('Agent model assignments must configure manager, writer, coder, and reviewer.')
        normalized_roles = {role: normalize_model_key(model) for role, model in role_models.items()}
        if any(not isinstance(model, str) or model not in self.available_agent_models
               for model in normalized_roles.values()):
            raise ValueError('Agent role models must use a configured model identifier.')
        object.__setattr__(self, 'agent_role_models', normalized_roles)

    @property
    def available_agent_models(self):
        """Models with backend adapters and configured rates, used by the agent spend guard."""
        from .pricing import PRICES
        configured_groq = (normalize_model_key(model) for model in
                           (self.small_model_id, self.large_model_id, *self.benchmark_extra_model_ids))
        dynamic = (model for model in configured_groq if model.split('::', 1)[-1] in PRICES)
        return list(dict.fromkeys([*MODELS, *dynamic]))

    @property
    def provider_api_keys(self):
        return {'groq': self.api_key, 'openai': self.openai_api_key, 'gemini': self.gemini_api_key,
                'anthropic': self.anthropic_api_key, 'ollama': self.ollama_api_key}

    def api_key_for_model(self, model_id: str) -> str:
        spec = get_model(model_id)
        if spec is None:
            return self.api_key
        return self.provider_api_keys.get(spec.provider, '')

    @property
    def live_enabled_reason(self):
        if not self.live_enabled:
            return 'Live inference is disabled. Set LIVE_ENABLED=true on the backend to enable it.'
        return None

    def model_unavailable_reason(self, model_id: str) -> str | None:
        if not self.live_enabled:
            return self.live_enabled_reason
        spec = get_model(model_id)
        if spec is None:
            return 'The selected model is not in the backend-supported, price-catalogued model list.'
        provider = PROVIDER_INFO.get(spec.provider)
        if provider is None:
            return 'The selected provider is not supported by this backend.'
        if provider['key_env'] and not self.api_key_for_model(model_id):
            return f"{provider['label']} API key is missing. Add it in Provider Settings on this computer."
        if spec.provider == 'groq':
            try:
                url = urlsplit(self.base_url)
            except ValueError:
                return 'The server inference endpoint configuration is invalid.'
            if (url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password
                    or url.query or url.fragment):
                return 'The server inference endpoint configuration is invalid.'
            if url.hostname == 'api.groq.com' and url.scheme != 'https':
                return 'Groq requires HTTPS.'
        return None

    @property
    def live_disabled_reason(self):
        reason = self.live_enabled_reason
        if reason:
            return reason
        if normalize_model_key(self.small_model_id) == normalize_model_key(self.large_model_id):
            return 'Live comparison requires two distinct model identifiers.'
        return self.model_unavailable_reason(self.small_model_id) or self.model_unavailable_reason(self.large_model_id)

    def completion_limit_for(self, model_id):
        """Return the configured cap bounded by the selected provider model."""
        spec = get_model(model_id)
        provider_limit = spec.max_completion_tokens if spec else MODEL_MAX_COMPLETION_TOKENS.get(model_id, self.max_completion_tokens)
        return min(self.max_completion_tokens, provider_limit)

    @classmethod
    def from_env(cls):
        values = {**dotenv_values(ROOT / '.env'), **os.environ}
        def value(name, default):
            return values.get(name) if values.get(name) is not None else default
        try:
            small_model = value('GROQ_MODEL_SMALL', value('SMALL_MODEL_ID', cls.small_model_id)) or cls.small_model_id
            large_model = value('GROQ_MODEL_LARGE', value('LARGE_MODEL_ID', cls.large_model_id)) or cls.large_model_id
            role_defaults = {'manager': large_model, 'writer': small_model,
                             'coder': large_model, 'reviewer': large_model}
            return cls(database_path=Path(value('DATABASE_PATH', str(cls.database_path))),
                       agent_workspace_root=Path(value('AGENT_WORKSPACE_ROOT', '')) if value('AGENT_WORKSPACE_ROOT', '') else None,
                       agent_enabled=value('AGENT_ENABLED', 'false').lower() == 'true',
                       small_model_id=small_model,
                       large_model_id=large_model,
                       agent_role_models={
                           role: (value(f'ECOAGENT_AGENT_MODEL_{role.upper()}',
                                        value(env_name, role_defaults[role])) or role_defaults[role])
                                 for role, env_name in {
                                     'manager': 'GROQ_AGENT_MODEL_MANAGER',
                                     'writer': 'GROQ_AGENT_MODEL_WRITER',
                                     'coder': 'GROQ_AGENT_MODEL_CODER',
                                     'reviewer': 'GROQ_AGENT_MODEL_REVIEWER',
                                 }.items()
                       },
                       api_key=value('GROQ_API_KEY', value('INFERENCE_API_KEY', '')) or '',
                       openai_api_key=value('OPENAI_API_KEY', '') or '',
                       gemini_api_key=value('GEMINI_API_KEY', '') or '',
                       anthropic_api_key=value('ANTHROPIC_API_KEY', '') or '',
                       ollama_api_key=value('OLLAMA_API_KEY', '') or '',
                       ollama_base_url=value('OLLAMA_BASE_URL', 'http://127.0.0.1:11434/v1') or 'http://127.0.0.1:11434/v1',
                       gpu_idle_baseline_seconds=float(value('GPU_IDLE_BASELINE_SECONDS', 3)),
                       base_url=value('INFERENCE_BASE_URL', cls.base_url) or cls.base_url,
                       live_enabled=value('LIVE_ENABLED', 'false').lower() == 'true',
                       benchmark_mode=value('BENCHMARK_INFERENCE_MODE', 'simulated'),
                       max_completion_tokens=int(value('INFERENCE_MAX_COMPLETION_TOKENS', 65536)),
                       benchmark_max_cases=int(value('BENCHMARK_MAX_CASES', 20)),
                       benchmark_extra_model_ids=tuple(part.strip() for part in value('BENCHMARK_EXTRA_MODEL_IDS', 'qwen/qwen3.8-27b').split(',') if part.strip()),
                       benchmark_runs_per_minute=int(value('BENCHMARK_RUNS_PER_MINUTE', 10)),
                       request_timeout_seconds=float(value('INFERENCE_TIMEOUT_SECONDS', 30)),
                       max_requests_per_run=int(value('INFERENCE_MAX_REQUESTS_PER_RUN', 60)),
                       max_requests_per_minute=int(value('INFERENCE_REQUESTS_PER_MINUTE', 60)),
                       max_run_cost_usd=float(value('INFERENCE_MAX_RUN_COST_USD', 0.50)),
                       max_agent_task_cost_usd=float(value('AGENT_MAX_TASK_COST_USD', 0.25)),
                       max_agent_tokens_per_run=int(value('AGENT_MAX_TOKENS_PER_RUN', 48000)),
                       max_agent_tokens_per_task=int(value('AGENT_MAX_TOKENS_PER_TASK', 12000)),
                       max_daily_cost_usd=float(value('INFERENCE_MAX_DAILY_COST_USD', 1.00)))
        except (ValueError, TypeError):
            raise ValueError('Invalid backend configuration; check identifiers, mode and numeric limits.') from None
