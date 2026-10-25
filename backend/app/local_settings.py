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

ENV_PATH = ROOT / '.env'
_KEY_LINE = re.compile(r'^\s*(?:export\s+)?GROQ_API_KEY\s*=.*$', re.IGNORECASE)


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


def _read_env_key(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        return ''
    from dotenv import dotenv_values
    value = dotenv_values(path).get('GROQ_API_KEY')
    return value if isinstance(value, str) else ''


def provider_settings(settings) -> dict[str, bool]:
    env_key = _read_env_key(ENV_PATH)
    configured_key = bool(settings.api_key)
    return {
        'local_setup_available': True,
        'provider_key_configured': configured_key,
        'provider_key_saved_in_env': bool(env_key),
        'restart_required': bool(env_key) and env_key != settings.api_key,
        'environment_override': bool(os.environ.get('GROQ_API_KEY')),
    }


def save_provider_key(secret: str) -> None:
    """Atomically save only GROQ_API_KEY in the ignored root .env; never log or return it."""
    path = ENV_PATH
    if path.is_symlink():
        raise ValueError('The backend .env path is not a regular file.')
    if os.environ.get('GROQ_API_KEY'):
        raise RuntimeError('GROQ_API_KEY is set in the backend process environment, which takes precedence over .env.')
    if not secret or len(secret) > 512 or any(not char.isprintable() or char.isspace() for char in secret):
        raise ValueError('Enter a provider key containing printable characters without spaces or line breaks.')

    old_text = path.read_text(encoding='utf-8') if path.exists() else ''
    newline = '\r\n' if '\r\n' in old_text else '\n'
    lines = [line for line in old_text.splitlines() if not _KEY_LINE.fullmatch(line)]
    lines.append('GROQ_API_KEY=' + json.dumps(secret, ensure_ascii=True))
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
