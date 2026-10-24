import base64
import json
from ..errors import APIError


def encode(kind: str, key: list) -> str:
    return base64.urlsafe_b64encode(json.dumps([1, kind, key], separators=(',', ':')).encode()).decode().rstrip('=')


def decode(value: str | None, kind: str):
    if value is None:
        return None
    try:
        if len(value) > 1000:
            raise ValueError()
        parsed = json.loads(base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True))
        if not isinstance(parsed, list) or len(parsed) != 3 or parsed[0] != 1 or parsed[1] != kind or not isinstance(parsed[2], list):
            raise ValueError()
        return parsed[2]
    except (ValueError, TypeError, UnicodeError):
        raise APIError(422, 'VALIDATION_ERROR', 'The pagination cursor is invalid for this request.') from None
