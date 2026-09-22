"""Límite de tasa en memoria con cubetas de fichas (token bucket), seguro entre hilos.

Solo sirve con un proceso (``workers=1``, que es como corre el API): con varios procesos cada uno
tendría sus propias cubetas. El login usa dos a la vez (ver ``LoginRateLimiter``).
"""

from __future__ import annotations

import math
import threading
import time
from collections.abc import Callable


class TokenBucket:
    """Una cubeta por llave: ``capacity`` fichas que se rellenan a ``refill_per_second``.

    ``take(key)`` gasta una ficha y devuelve ``(permitido, segundos_para_reintentar)``.
    ``clock`` es inyectable para pruebas (por defecto ``time.monotonic``).
    """

    def __init__(
        self,
        capacity: float,
        refill_per_second: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 10_000,
    ):
        if capacity <= 0 or refill_per_second <= 0:
            raise ValueError("capacity y refill_per_second deben ser positivos")
        self.capacity = float(capacity)
        self.rate = float(refill_per_second)
        self.clock = clock
        self.max_keys = max_keys
        self._buckets: dict[str, tuple[float, float]] = {}  # key -> (fichas, último instante)
        self._lock = threading.Lock()

    @classmethod
    def per_period(cls, count: int, seconds: float, **kwargs) -> TokenBucket:
        """``count`` intentos por ``seconds`` segundos, con ráfaga de ``count``."""
        return cls(count, count / seconds, **kwargs)

    def _level(self, key: str, now: float) -> float:
        tokens, last = self._buckets.get(key, (self.capacity, now))
        return min(self.capacity, tokens + max(0.0, now - last) * self.rate)

    def take(self, key: str, tokens: float = 1.0) -> tuple[bool, float]:
        with self._lock:
            now = self.clock()
            level = self._level(key, now)
            if level >= tokens:
                self._buckets[key] = (level - tokens, now)
                self._prune(now)
                return True, 0.0
            self._buckets[key] = (level, now)
            return False, (tokens - level) / self.rate

    def peek(self, key: str) -> float:
        """Fichas disponibles ahora, sin gastar."""
        with self._lock:
            return self._level(key, self.clock())

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()

    def _prune(self, now: float) -> None:
        if len(self._buckets) <= self.max_keys:
            return
        full = [k for k in self._buckets if self._level(k, now) >= self.capacity]
        for k in full:
            del self._buckets[k]
        if len(self._buckets) > self.max_keys:
            oldest = sorted(self._buckets, key=lambda k: self._buckets[k][1])
            for k in oldest[: len(self._buckets) - self.max_keys]:
                del self._buckets[k]


def retry_after_header(seconds: float) -> str:
    """Valor de ``Retry-After``: segundos enteros, al menos 1."""
    return str(max(1, math.ceil(seconds)))


class LoginRateLimiter:
    """Límites del login: 5 por minuto por IP y 10 por hora por usuario (se cuentan todos los intentos)."""

    def __init__(
        self,
        *,
        per_ip: tuple[int, float] = (5, 60.0),
        per_user: tuple[int, float] = (10, 3600.0),
        clock: Callable[[], float] = time.monotonic,
    ):
        self.by_ip = TokenBucket.per_period(*per_ip, clock=clock)
        self.by_user = TokenBucket.per_period(*per_user, clock=clock)

    def check(self, ip: str, username: str) -> float | None:
        """Gasta un intento. Devuelve ``None`` si pasa o los segundos a esperar si no."""
        allowed, wait = self.by_ip.take(f"ip:{ip}")
        if not allowed:
            return wait
        # Acotado: el POST /login v1 acepta cuerpos de hasta 10 KB y cada llave vive en memoria.
        allowed, wait = self.by_user.take(f"user:{username.strip().lower()[:64]}")
        if not allowed:
            return wait
        return None

    def reset(self) -> None:
        self.by_ip.reset()
        self.by_user.reset()


def client_ip(headers, client_host: str | None) -> str:
    """IP del cliente: primer salto de ``X-Forwarded-For`` si existe, si no el host de la conexión.

    Ojo: el primer salto lo escribe el cliente y se puede falsificar; por eso el login también
    limita por usuario.
    """
    forwarded = headers.get("x-forwarded-for") if headers is not None else None
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first[:64]
    return client_host or "desconocido"
