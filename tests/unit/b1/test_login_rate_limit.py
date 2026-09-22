"""Límite de tasa del login: con qué IP se limita y por qué la cubeta por usuario cuenta fallas.

Los dos defectos que arregla este archivo venían de la revisión de S1:

1. la llave por IP era el PRIMER salto de ``X-Forwarded-For``, que lo escribe el cliente, así que el
   límite por IP se esquivaba cambiando la cabecera en cada intento;
2. la cubeta por usuario gastaba una ficha por intento, bueno o malo, así que cualquiera que supiera
   un nombre de usuario podía dejar a esa persona fuera de su cuenta durante una hora.
"""

from __future__ import annotations

import pytest

from kaizen_api.security.ratelimit import LoginRateLimiter, TokenBucket, client_ip
from kaizen_api.settings import (
    DEFAULT_LOGIN_IP_PER_MINUTE,
    DEFAULT_LOGIN_USER_PER_HOUR,
    Settings,
    SettingsError,
)

from .conftest import PASSWORD


class Headers(dict):
    """Cabeceras insensibles a mayúsculas, como las de Starlette."""

    def get(self, key, default=None):  # noqa: D102
        return super().get(key.lower(), default)


def xff(value: str | None) -> Headers:
    return Headers({"x-forwarded-for": value} if value is not None else {})


# ─── con qué IP se limita ────────────────────────────────────────────────────


def test_right_most_untrusted_hop_is_the_key_with_one_proxy():
    # Render pone un balanceador enfrente: él AGREGA la IP real al final de la cadena, así que lo
    # que el cliente haya escrito queda a la izquierda y no se usa.
    headers = xff("evil-spoof, 203.0.113.9")
    assert client_ip(headers, "10.0.0.1", trusted_hops=1) == "203.0.113.9"
    # Un atacante que cambia su parte en cada intento cae siempre en la misma cubeta.
    keys = {client_ip(xff(f"{i}.{i}.{i}.{i}, 203.0.113.9"), "10.0.0.1", trusted_hops=1) for i in range(5)}
    assert keys == {"203.0.113.9"}


def test_first_hop_is_never_the_key():
    """El comportamiento viejo (tomar el primer salto) daba una llave distinta por intento."""
    headers = xff("1.2.3.4, 203.0.113.9")
    assert client_ip(headers, None, trusted_hops=1) != "1.2.3.4"


@pytest.mark.parametrize(
    "chain,hops,expected",
    [
        ("203.0.113.9", 1, "203.0.113.9"),  # sin proxies intermedios
        ("cliente, proxy-a, 203.0.113.9", 2, "proxy-a"),  # dos saltos nuestros
        ("203.0.113.9", 2, "10.0.0.1"),  # cadena más corta que lo declarado: no se confía
        ("203.0.113.9", 0, "10.0.0.1"),  # sin proxies: la cabecera se ignora por completo
        ("  ,  , 203.0.113.9  ", 1, "203.0.113.9"),  # entradas vacías y espacios
        (None, 1, "10.0.0.1"),  # sin cabecera
    ],
)
def test_client_ip_by_hops(chain, hops, expected):
    assert client_ip(xff(chain), "10.0.0.1", trusted_hops=hops) == expected


def test_client_ip_without_socket_or_header():
    assert client_ip(xff(None), None, trusted_hops=1) == "desconocido"
    assert len(client_ip(xff("x" * 500), None, trusted_hops=1)) == 64


def test_trusted_hops_setting_reaches_the_request(client_for):
    """Con TRUSTED_PROXY_HOPS=0 la cabecera no sirve para cambiarse de cubeta."""
    client = client_for(TRUSTED_PROXY_HOPS="0")
    codes = [
        client.post(
            "/auth/login", json={"username": f"u{i}", "password": "x"}, headers={"X-Forwarded-For": f"9.9.9.{i}"}
        ).status_code
        for i in range(DEFAULT_LOGIN_IP_PER_MINUTE + 1)
    ]
    assert codes == [401] * DEFAULT_LOGIN_IP_PER_MINUTE + [429]


def test_spoofed_forwarded_for_does_not_dodge_the_ip_limit(client_for):
    client = client_for()
    codes = [
        client.post(
            "/auth/login",
            json={"username": f"u{i}", "password": "x"},
            headers={"X-Forwarded-For": f"10.{i}.{i}.{i}, 203.0.113.9"},  # el atacante solo escribe lo de la izquierda
        ).status_code
        for i in range(DEFAULT_LOGIN_IP_PER_MINUTE + 1)
    ]
    assert codes == [401] * DEFAULT_LOGIN_IP_PER_MINUTE + [429]


# ─── la cubeta por usuario cuenta fallas ─────────────────────────────────────


def test_refund_returns_the_attempt_on_success():
    now = [0.0]
    limiter = LoginRateLimiter(per_user=(3, 3600.0), clock=lambda: now[0])
    assert limiter.check("1.1.1.1", "ana") is None
    assert limiter.by_user.peek("user:ana") == pytest.approx(2.0)
    limiter.refund_user("ana")
    assert limiter.by_user.peek("user:ana") == pytest.approx(3.0)
    # La cubeta nunca pasa de su capacidad, ni con refunds de más.
    for _ in range(5):
        limiter.refund_user("ana")
    assert limiter.by_user.peek("user:ana") == pytest.approx(3.0)
    # Y la llave normaliza igual que check().
    assert limiter.check("1.1.1.1", "  ANA ") is None
    limiter.refund_user("ANA")
    assert limiter.by_user.peek("user:ana") == pytest.approx(3.0)


def test_bucket_refund_ignores_unknown_keys():
    bucket = TokenBucket.per_period(2, 60)
    bucket.refund("nunca-vista")  # no crea la llave ni truena
    assert bucket._buckets == {}


def test_a_person_can_log_in_more_times_than_the_hourly_bucket(client_for):
    """Antes, entrar 11 veces bien en una hora te dejaba fuera. Ahora solo cuentan las fallas."""
    client = client_for()
    codes = []
    for i in range(DEFAULT_LOGIN_USER_PER_HOUR + 4):
        # IPs distintas: el límite por IP (5 por minuto) es otro asunto y no es lo que se prueba aquí.
        r = client.post(
            "/auth/login",
            json={"username": "ana", "password": PASSWORD},
            headers={"X-Forwarded-For": f"198.51.100.{i}"},
        )
        codes.append(r.status_code)
    assert codes == [200] * (DEFAULT_LOGIN_USER_PER_HOUR + 4)


def test_failed_attempts_still_fill_the_hourly_bucket(client_for):
    client = client_for()
    codes = [
        client.post(
            "/auth/login", json={"username": "ana", "password": "mala"}, headers={"X-Forwarded-For": f"192.0.2.{i}"}
        ).status_code
        for i in range(DEFAULT_LOGIN_USER_PER_HOUR + 1)
    ]
    assert codes == [401] * DEFAULT_LOGIN_USER_PER_HOUR + [429]


def test_a_good_login_in_the_middle_does_not_burn_the_bucket(client_for):
    """Nueve fallas, un acierto, y la décima falla todavía cabe: el acierto devolvió su ficha."""
    client = client_for()
    for i in range(DEFAULT_LOGIN_USER_PER_HOUR - 1):
        r = client.post(
            "/auth/login", json={"username": "ana", "password": "mala"}, headers={"X-Forwarded-For": f"203.0.113.{i}"}
        )
        assert r.status_code == 401
    ok = client.post(
        "/auth/login", json={"username": "ana", "password": PASSWORD}, headers={"X-Forwarded-For": "203.0.113.200"}
    )
    assert ok.status_code == 200
    again = client.post(
        "/auth/login", json={"username": "ana", "password": "mala"}, headers={"X-Forwarded-For": "203.0.113.201"}
    )
    assert again.status_code == 401


# ─── los límites son configurables, pero no en producción ────────────────────


def test_limits_come_from_settings(client_for):
    client = client_for(LOGIN_RATE_LIMIT_IP_PER_MINUTE="2")
    codes = [client.post("/auth/login", json={"username": "ana", "password": "mala"}).status_code for _ in range(3)]
    assert codes == [401, 401, 429]


def test_relaxing_is_only_allowed_outside_production():
    relaxed = {"LOGIN_RATE_LIMIT_IP_PER_MINUTE": "100", "LOGIN_RATE_LIMIT_USER_PER_HOUR": "500"}
    dev = Settings.from_env(relaxed)
    assert (dev.login_ip_per_minute, dev.login_user_per_hour) == (100, 500)
    assert any("límites del login" in w for w in dev.warnings)
    for name in relaxed:
        with pytest.raises(SettingsError, match=name):
            Settings.from_env({"KAIZEN_ENV": "production", "SECRET_KEY": "x" * 40, name: relaxed[name]})
    # Apretarlos sí se puede en producción, y armar Settings a mano tampoco se salta la regla.
    strict = Settings.from_env({"KAIZEN_ENV": "production", "SECRET_KEY": "x" * 40, "LOGIN_RATE_LIMIT_IP_PER_MINUTE": "2"})
    assert strict.login_ip_per_minute == 2
    with pytest.raises(SettingsError, match="LOGIN_RATE_LIMIT_USER_PER_HOUR"):
        Settings(env="production", secret_key="x" * 40, login_user_per_hour=99)


def test_defaults_are_the_ones_in_the_spec():
    s = Settings.from_env({})
    assert (s.login_ip_per_minute, s.login_user_per_hour) == (5, 10)
    assert (DEFAULT_LOGIN_IP_PER_MINUTE, DEFAULT_LOGIN_USER_PER_HOUR) == (5, 10)
    assert s.trusted_proxy_hops == 1  # Render


def test_limiter_is_built_from_settings(client_for):
    client = client_for(LOGIN_RATE_LIMIT_USER_PER_HOUR="3")
    limiter = client.app.state.login_limiter
    assert (limiter.by_ip.capacity, limiter.by_user.capacity) == (5.0, 3.0)
    assert limiter.by_user.rate == pytest.approx(3 / 3600.0)
