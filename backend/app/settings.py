"""Server-only settings: environment overrides root .env; api.env is not loaded."""
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
import math
import os
import re

from dotenv import dotenv_values

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
    small_model_id: str = 'openai/gpt-oss-20b'
    large_model_id: str = 'openai/gpt-oss-120b'
    benchmark_max_cases: int = 10
    benchmark_extra_model_ids: tuple[str, ...] = ('qwen/qwen3.8-27b',)
    benchmark_mode: str = 'simulated'
    live_enabled: bool = False
    base_url: str = 'https://api.groq.com/openai/v1'
    api_key: str = field(default='', repr=False)
    request_timeout_seconds: float = 30
    max_completion_tokens: int = 65536
    max_requests_per_run: int = 20
    max_requests_per_minute: int = 60
    max_run_cost_usd: float = 0.50
    max_daily_cost_usd: float = 1.00
    benchmark_runs_per_minute: int = 10

    def __post_init__(self):
        path = Path(self.database_path).expanduser()
        object.__setattr__(self, 'database_path', path if path.is_absolute() else ROOT / path)
        if self.agent_workspace_root is not None:
            workspace = Path(self.agent_workspace_root).expanduser()
            object.__setattr__(self, 'agent_workspace_root', workspace if workspace.is_absolute() else ROOT / workspace)
        if self.benchmark_mode not in ('simulated', 'groq'):
            raise ValueError('BENCHMARK_INFERENCE_MODE must be simulated or groq.')
        if type(self.max_completion_tokens) is not int or not 1 <= self.max_completion_tokens <= 65536:
            raise ValueError('INFERENCE_MAX_COMPLETION_TOKENS must be an integer from 1 to 65536.')
        limits = (self.benchmark_max_cases, self.max_requests_per_run, self.max_requests_per_minute,
                  self.max_run_cost_usd, self.max_daily_cost_usd, self.benchmark_runs_per_minute,
                  self.request_timeout_seconds)
        if any(not math.isfinite(value) or value <= 0 for value in limits) or self.request_timeout_seconds > 30:
            raise ValueError('Backend limits must be positive and finite; request timeout cannot exceed 30 seconds.')
        # Identifiers are public metadata: disallow URLs, whitespace and the configured secret.
        for model in (self.small_model_id, self.large_model_id, *self.benchmark_extra_model_ids):
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,199}', model) or (self.api_key and self.api_key in model):
                raise ValueError('Configured model identifiers are invalid.')

    @property
    def live_disabled_reason(self):
        if not self.live_enabled:
            return 'Live inference is disabled. Set LIVE_ENABLED=true on the backend to enable it.'
        try:
            url = urlsplit(self.base_url)
        except ValueError:
            return 'The server inference endpoint configuration is invalid.'
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
            return 'The server inference endpoint configuration is invalid.'
        if url.hostname == 'api.groq.com' and (url.scheme != 'https' or not self.api_key):
            return 'Groq requires HTTPS and a backend GROQ_API_KEY.'
        if self.small_model_id == self.large_model_id:
            return 'Live comparison requires two distinct model identifiers.'
        from .pricing import PRICES
        if any(model not in PRICES for model in (self.small_model_id, self.large_model_id)):
            return 'Live inference requires supported model pricing for spending controls.'
        return None

    def completion_limit_for(self, model_id):
        """Return the configured cap bounded by known Groq model output limits."""
        return min(self.max_completion_tokens, MODEL_MAX_COMPLETION_TOKENS.get(model_id, self.max_completion_tokens))

    @classmethod
    def from_env(cls):
        values = {**dotenv_values(ROOT / '.env'), **os.environ}
        def value(name, default):
            return values.get(name) if values.get(name) is not None else default
        try:
            return cls(database_path=Path(value('DATABASE_PATH', str(cls.database_path))),
                       agent_workspace_root=Path(value('AGENT_WORKSPACE_ROOT', '')) if value('AGENT_WORKSPACE_ROOT', '') else None,
                       agent_enabled=value('AGENT_ENABLED', 'false').lower() == 'true',
                       small_model_id=value('GROQ_MODEL_SMALL', value('SMALL_MODEL_ID', cls.small_model_id)) or cls.small_model_id,
                       large_model_id=value('GROQ_MODEL_LARGE', value('LARGE_MODEL_ID', cls.large_model_id)) or cls.large_model_id,
                       api_key=value('GROQ_API_KEY', value('INFERENCE_API_KEY', '')) or '',
                       base_url=value('INFERENCE_BASE_URL', cls.base_url) or cls.base_url,
                       live_enabled=value('LIVE_ENABLED', 'false').lower() == 'true',
                       benchmark_mode=value('BENCHMARK_INFERENCE_MODE', 'simulated'),
                       max_completion_tokens=int(value('INFERENCE_MAX_COMPLETION_TOKENS', 65536)),
                       benchmark_max_cases=int(value('BENCHMARK_MAX_CASES', 10)),
                       benchmark_extra_model_ids=tuple(part.strip() for part in value('BENCHMARK_EXTRA_MODEL_IDS', 'qwen/qwen3.8-27b').split(',') if part.strip()),
                       benchmark_runs_per_minute=int(value('BENCHMARK_RUNS_PER_MINUTE', 10)),
                       request_timeout_seconds=float(value('INFERENCE_TIMEOUT_SECONDS', 30)),
                       max_requests_per_run=int(value('INFERENCE_MAX_REQUESTS_PER_RUN', 20)),
                       max_requests_per_minute=int(value('INFERENCE_REQUESTS_PER_MINUTE', 60)),
                       max_run_cost_usd=float(value('INFERENCE_MAX_RUN_COST_USD', 0.50)),
                       max_daily_cost_usd=float(value('INFERENCE_MAX_DAILY_COST_USD', 1.00)))
        except (ValueError, TypeError):
            raise ValueError('Invalid backend configuration; check identifiers, mode and numeric limits.') from None
