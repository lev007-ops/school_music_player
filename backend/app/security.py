import hashlib
import secrets
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"


def hash_secret(value: str) -> str:
    # Пароли и токены случайные и длинные, поэтому соль не нужна,
    # а детерминированный хеш позволяет искать событие по паролю.
    return hashlib.sha256(value.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def new_password() -> str:
    return "".join(secrets.choice(PASSWORD_ALPHABET) for _ in range(16))


def new_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


def get_token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.query_params.get("t") or None


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class RateLimiter:
    """Ограничение числа неудачных попыток (подбор кода/пароля) с одного IP."""

    def __init__(self, max_attempts: int, window_seconds: float) -> None:
        self.max_attempts = max_attempts
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str) -> deque[float]:
        hits = self._hits[key]
        border = time.monotonic() - self.window
        while hits and hits[0] < border:
            hits.popleft()
        return hits

    def check(self, key: str) -> None:
        if len(self._prune(key)) >= self.max_attempts:
            raise HTTPException(429, "Слишком много попыток. Попробуйте через несколько минут.")

    def hit(self, key: str) -> None:
        self._prune(key).append(time.monotonic())


join_limiter = RateLimiter(10, 300)
login_limiter = RateLimiter(10, 300)
create_limiter = RateLimiter(30, 3600)
