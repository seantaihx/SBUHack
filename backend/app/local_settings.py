"""Local-only, server-side provider-key setup for the development prototype."""
from __future__ import annotations

import ipaddress
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Request

from .settings import ROOT
from .model_catalog import normalize_model_key

ENV_PATH = ROOT / '.env'
_PROVIDER_KEY_ENV = {
    'groq': 'GROQ_API_KEY', 'openai': 'OPENAI_API_KEY',
    'gemini': 'GEMINI_API_KEY', 'anthropic': 'ANTHROPIC_API_KEY',
}
_AGENT_MODEL_ENV = {
    'manager': 'ECOAGENT_AGENT_MODEL_MANAGER',
    'writer': 'ECOAGENT_AGENT_MODEL_WRITER',
    'coder': 'ECOAGENT_AGENT_MODEL_CODER',
    'reviewer': 'ECOAGENT_AGENT_MODEL_REVIEWER',
}
_LEGACY_AGENT_MODEL_ENV = {role: name.replace('ECOAGENT_', 'GROQ_') for role, name in _AGENT_MODEL_ENV.items()}


def local_same_origin_request(request: Request, *, allow_missing_origin_for_read: bool = False) -> bool:
    """Require loopback caller/Host; only read-only status may omit Origin."""
    peer = getattr(getattr(request, 'client', None), 'host', None)
    try:
        if not ipaddress.ip_address(peer).is_loopback:
            return False
        request_host = (request.url.hostname or '').casefold()
        if request_host not in ('localhost', '127.0.0.1', '::1'):
            return False
        origin = request.headers.get('origin')
        if not origin:
            return allow_missing_origin_for_read
        parsed = urlsplit(origin)
        return (parsed.scheme == request.url.scheme and parsed.hostname is not None
                and parsed.hostname.casefold() == request_host and parsed.port == request.url.port
                and parsed.username is None and parsed.password is None
                and parsed.path in ('', '/') and not parsed.query and not parsed.fragment)
    except (ValueError, TypeError):
        return False


def _read_env_keys(path: Path) -> dict:
    if path.is_symlink() or not path.is_file():
        return {}
    from dotenv import dotenv_values
    return dotenv_values(path)


def provider_settings(settings) -> dict:
    env = _read_env_keys(ENV_PATH)
    statuses = {}
    for provider, env_name in _PROVIDER_KEY_ENV.items():
        saved = env.get(env_name)
        active = settings.provider_api_keys.get(provider, '')
        override = bool(os.environ.get(env_name))
        statuses[provider] = {
            'configured': bool(active), 'saved_in_env': isinstance(saved, str) and bool(saved),
            'restart_required': bool(saved) and saved != active,
            'environment_override': override,
        }
    statuses['ollama'] = {'configured': True, 'saved_in_env': False,
                          'restart_required': False, 'environment_override': False,
                          'local_only': True}
    groq = statuses['groq']
    return {
        'local_setup_available': True,
        'provider_key_configured': groq['configured'],
        'provider_key_saved_in_env': groq['saved_in_env'],
        'restart_required': groq['restart_required'],
        'environment_override': groq['environment_override'],
        'providers': statuses,
    }


def save_provider_key(secret: str) -> None:
    save_provider_api_key('groq', secret)


def save_provider_api_key(provider: str, secret: str) -> None:
    """Atomically save a provider credential to the ignored root .env."""
    env_name = _PROVIDER_KEY_ENV.get(provider)
    if not env_name:
        raise ValueError('This provider does not accept an API key here.')
    path = ENV_PATH
    if path.is_symlink():
        raise ValueError('The backend .env path is not a regular file.')
    if os.environ.get(env_name):
        raise RuntimeError(f'{env_name} is set in the backend process environment, which takes precedence over .env.')
    if not secret or len(secret) > 512 or any(not char.isprintable() or char.isspace() for char in secret):
        raise ValueError('Enter a provider key containing printable characters without spaces or line breaks.')

    _atomic_update_env({env_name: secret})


def agent_model_settings(settings) -> dict:
    from dotenv import dotenv_values
    file_values = {}
    if not ENV_PATH.is_symlink() and ENV_PATH.is_file():
        file_values = dotenv_values(ENV_PATH)
    available = set(settings.available_agent_models)
    active = dict(settings.agent_role_models)
    saved = {}
    for role, env_name in _AGENT_MODEL_ENV.items():
        candidate = file_values.get(env_name) or file_values.get(_LEGACY_AGENT_MODEL_ENV[role])
        if isinstance(candidate, str) and candidate not in available:
            candidate = normalize_model_key(candidate)
        saved[role] = candidate if candidate in available else active[role]
    from .model_catalog import MODELS
    options = [{'id': key, 'provider': model.provider,
                'provider_label': {'groq': 'Groq', 'openai': 'OpenAI', 'gemini': 'Google Gemini',
                                   'anthropic': 'Anthropic Claude', 'ollama': 'Ollama (local)'}[model.provider],
                'label': model.label, 'local': model.local}
               for key, model in MODELS.items()]
    return {
        'available_models': settings.available_agent_models,
        'model_options': [option for option in options if option['id'] in available],
        'active_models': active,
        'saved_models': saved,
        'restart_required': saved != active,
        'environment_override': any(os.environ.get(name) for name in (*_AGENT_MODEL_ENV.values(), *_LEGACY_AGENT_MODEL_ENV.values())),
    }


def save_agent_role_models(assignments: dict[str, str], settings) -> None:
    if any(os.environ.get(name) for name in (*_AGENT_MODEL_ENV.values(), *_LEGACY_AGENT_MODEL_ENV.values())):
        raise RuntimeError('Agent model settings are set in the backend process environment, which takes precedence over .env.')
    if set(assignments) != set(_AGENT_MODEL_ENV):
        raise ValueError('All four agent roles must have a model assignment.')
    available = set(settings.available_agent_models)
    if any(not isinstance(model, str) or model not in available for model in assignments.values()):
        raise ValueError('Choose models from the backend-supported model list.')
    _atomic_update_env({_AGENT_MODEL_ENV[role]: model for role, model in assignments.items()})


def _atomic_update_env(updates: dict[str, str]) -> None:
    path = ENV_PATH
    if path.is_symlink():
        raise ValueError('The backend .env path is not a regular file.')
    keys = '|'.join(re.escape(key) for key in updates)
    update_line = re.compile(r'^\s*(?:export\s+)?(?:' + keys + r')\s*=.*$', re.IGNORECASE)
    old_text = path.read_text(encoding='utf-8') if path.exists() else ''
    newline = '\r\n' if '\r\n' in old_text else '\n'
    lines = [line for line in old_text.splitlines() if not update_line.fullmatch(line)]
    lines.extend(key + '=' + json.dumps(value, ensure_ascii=True) for key, value in updates.items())
    content = newline.join(lines).rstrip('\r\n') + newline
    file_descriptor, temp_name = tempfile.mkstemp(prefix='.ecoagent-env-', dir=path.parent)
    try:
        if os.name != 'nt':
            os.fchmod(file_descriptor, 0o600)
        with os.fdopen(file_descriptor, 'w', encoding='utf-8', newline='') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            os.close(file_descriptor)
        except OSError:
            pass
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise
