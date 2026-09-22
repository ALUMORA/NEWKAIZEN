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

    def refund(self, key: str, tokens: float = 1.0) -> None:
        """Devuelve fichas a ``key``, sin pasarse de ``capacity``. Una llave llena no cambia."""
        with self._lock:
            entry = self._buckets.get(key)
            if entry is None:
                return
            now = self.clock()
            level = min(self.capacity, self._level(key, now) + tokens)
            if level >= self.capacity:
                del self._buckets[key]  # llena otra vez: guardarla solo gasta memoria
            else:
                self._buckets[key] = (level, now)

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
    """Límites del login: por IP y por minuto, y por usuario y por hora **solo intentos fallidos**.

    Los defaults son los de la spec v2: 5 por minuto por IP y 10 por hora por usuario.

    La cubeta por usuario se gasta al empezar el intento y se **devuelve** con ``refund_user`` cuando
    las credenciales resultaron buenas. Así la cubeta cuenta fallas, no logins: nadie puede dejar a
    una persona fuera de su cuenta a punta de contraseñas malas mientras ella sí sabe la suya, y una
    suite e2e que entra muchas veces seguidas tampoco se auto bloquea.
    """

    def __init__(
        self,
        *,
        per_ip: tuple[int, float] = (5, 60.0),
        per_user: tuple[int, float] = (10, 3600.0),
        clock: Callable[[], float] = time.monotonic,
    ):
        self.by_ip = TokenBucket.per_period(*per_ip, clock=clock)
        self.by_user = TokenBucket.per_period(*per_user, clock=clock)

    @classmethod
    def from_settings(cls, settings, *, clock: Callable[[], float] = time.monotonic) -> LoginRateLimiter:
        """Arma el limitador con ``LOGIN_RATE_LIMIT_*`` de la configuración."""
        return cls(
            per_ip=(settings.login_ip_per_minute, 60.0),
            per_user=(settings.login_user_per_hour, 3600.0),
            clock=clock,
        )

    @staticmethod
    def user_key(username: str) -> str:
        # Acotado: el POST /login v1 acepta cuerpos de hasta 10 KB y cada llave vive en memoria.
        return f"user:{(username or '').strip().lower()[:64]}"

    def check(self, ip: str, username: str) -> float | None:
        """Gasta un intento. Devuelve ``None`` si pasa o los segundos a esperar si no."""
        allowed, wait = self.by_ip.take(f"ip:{ip}")
        if not allowed:
            return wait
        allowed, wait = self.by_user.take(self.user_key(username))
        if not allowed:
            return wait
        return None

    def refund_user(self, username: str) -> None:
        """Devuelve el intento de ``username``: se llama cuando el login SÍ fue correcto."""
        self.by_user.refund(self.user_key(username))

    def reset(self) -> None:
        self.by_ip.reset()
        self.by_user.reset()


def client_ip(headers, client_host: str | None, trusted_hops: int = 1) -> str:
    """Llave por IP del cliente, tomando ``X-Forwarded-For`` solo hasta donde es confiable.

    ``X-Forwarded-For`` se lee de derecha a izquierda: cada proxy le **agrega** la IP del par que le
    habló, así que los ``trusted_hops`` saltos finales los escribió infraestructura nuestra y todo
    lo que está a su izquierda lo escribió el cliente y se puede inventar. Con ``trusted_hops=1``
    (Render pone un balanceador enfrente) la IP real del cliente es el **último** elemento.

    Tomar el primero, como hacía S1, deja pasar ``X-Forwarded-For: <lo que sea>``: el atacante se
    cambia de llave en cada intento y el límite por IP no existe. Con 0 saltos la cabecera se ignora
    por completo y manda la IP del socket, que es lo correcto cuando el API se expone directo.
    """
    hops = max(0, int(trusted_hops))
    forwarded = headers.get("x-forwarded-for") if (headers is not None and hops) else None
    if forwarded:
        chain = [h.strip() for h in forwarded.split(",") if h.strip()]
        if len(chain) >= hops:
            return chain[-hops][:64]
        # Cadena más corta que los saltos configurados: no cuadra con la infraestructura declarada,
        # así que no se confía en ella y manda el socket.
    return client_host or "desconocido"
