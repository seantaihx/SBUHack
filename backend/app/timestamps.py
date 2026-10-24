from datetime import datetime, timezone


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
