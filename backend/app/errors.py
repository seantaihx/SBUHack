from .schemas import ErrorInfo


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        self.status = status
        self.error = ErrorInfo(code=code, message=message, details=details or {})
