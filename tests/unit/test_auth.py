"""Contraseñas scrypt, JWT, límite de tasa del login y la compuerta AUTH_REQUIRED."""

from __future__ import annotations

import datetime as dt
import json

import pytest
import time_machine
from fastapi.testclient import TestClient

import kaizen_api
from kaizen_api.errors import ApiError
from kaizen_api.main import create_app
from kaizen_api.security.auth import (
    authenticate,
    create_token,
    hash_password,
    verify_password,
    verify_token,
)
from kaizen_api.security.ratelimit import LoginRateLimiter, TokenBucket
from kaizen_api.settings import DEV_SECRET_KEY, Settings, SettingsError
from tests.replay import GOLDENS_DIR, compare, load_golden, replaying

SECRET = "prueba-secreta-de-32-caracteres-o-mas-0123"
T0 = dt.datetime(2026, 9, 22, 12, 0, tzinfo=dt.UTC)


@pytest.fixture(scope="module")
def ana_hash() -> str:
    return hash_password("correcta-y-larga")


def make_settings(ana_hash: str, **env: str) -> Settings:
    base = {"SECRET_KEY": SECRET, "USERS": json.dumps({"Ana": ana_hash})}
    base.update(env)
    return Settings.from_env(base)


def client_for(settings: Settings) -> TestClient:
    return TestClient(create_app(settings), raise_server_exceptions=False)


# ─── contraseñas ─────────────────────────────────────────────────────────────


def test_hash_roundtrip_and_format(ana_hash):
    parts = ana_hash.split("$")
    assert parts[:4] == ["scrypt", str(2**14), "8", "1"]
    assert len(bytes.fromhex(parts[4])) == 16 and len(bytes.fromhex(parts[5])) == 32
    assert verify_password("correcta-y-larga", ana_hash)
    assert hash_password("correcta-y-larga") != ana_hash  # sal nueva cada vez


def test_wrong_password_and_malformed_hashes(ana_hash):
    assert not verify_password("incorrecta", ana_hash)
    assert not verify_password("", ana_hash)
    for bad in ("", "scrypt$", "bcrypt$16384$8$1$00$00", "scrypt$3$8$1$aa$bb", "scrypt$1048576$8$1$aa$" + "00" * 32):
        assert not verify_password("x", bad), bad


def test_authenticate_normalizes_username_and_rejects_unknown(ana_hash):
    settings = make_settings(ana_hash)
    assert authenticate("  ANA ", "correcta-y-larga", settings) == "ana"
    assert authenticate("ana", "mala", settings) is None
    assert authenticate("nadie", "correcta-y-larga", settings) is None
    assert authenticate("", "", settings) is None


def test_plaintext_users_only_outside_production(ana_hash):
    dev = Settings.from_env({"USERS": '{"luis": "texto-plano"}'})
    assert authenticate("luis", "texto-plano", dev) == "luis"
    assert any("texto plano" in w for w in dev.warnings)
    with pytest.raises(SettingsError, match="texto plano"):
        Settings.from_env({"KAIZEN_ENV": "production", "SECRET_KEY": SECRET, "USERS": '{"luis": "texto-plano"}'})


def test_production_refuses_to_start_without_secret_key():
    with pytest.raises(SettingsError, match="SECRET_KEY"):
        Settings.from_env({"KAIZEN_ENV": "production"})
    with pytest.raises(SettingsError, match="SECRET_KEY"):
        Settings.from_env({"KAIZEN_ENV": "production", "SECRET_KEY": "corta"})
    with pytest.raises(SettingsError, match="llave de desarrollo"):
        Settings.from_env({"KAIZEN_ENV": "production", "SECRET_KEY": DEV_SECRET_KEY})
    prod = Settings.from_env({"KAIZEN_ENV": "production", "SECRET_KEY": SECRET})
    assert prod.is_production and not prod.legacy_routes and "localhost" not in prod.cors_origin_regex


@pytest.mark.parametrize("kaizen_env", ["development", "production"])
@pytest.mark.parametrize("secret", [None, DEV_SECRET_KEY, "corta"], ids=["sin-llave", "llave-dev", "corta"])
def test_auth_required_needs_its_own_strong_secret_in_any_env(kaizen_env, secret):
    # DEV_SECRET_KEY está en el repo público: con ella cualquiera firma tokens válidos.
    env = {"KAIZEN_ENV": kaizen_env, "AUTH_REQUIRED": "true"}
    if secret is not None:
        env["SECRET_KEY"] = secret
    with pytest.raises(SettingsError, match="SECRET_KEY"):
        Settings.from_env(env)


def test_dev_key_only_without_auth_required_and_never_by_hand():
    dev = Settings.from_env({"SECRET_KEY": DEV_SECRET_KEY})
    assert dev.secret_key == DEV_SECRET_KEY and any("llave de desarrollo" in w for w in dev.warnings)
    assert Settings.from_env({}).secret_key == DEV_SECRET_KEY
    assert Settings.from_env({"AUTH_REQUIRED": "true", "SECRET_KEY": SECRET}).auth_required
    with pytest.raises(SettingsError, match="llave de desarrollo"):
        Settings(auth_required=True)
    with pytest.raises(SettingsError, match="llave de desarrollo"):
        Settings(env="production")


def test_token_forged_with_dev_key_is_rejected_when_auth_required(ana_hash):
    import time

    import jwt

    settings = make_settings(ana_hash, AUTH_REQUIRED="true", KAIZEN_LEGACY_ROUTES="1")
    now = int(time.time())
    forged = jwt.encode({"sub": "ana", "iat": now, "exp": now + 3600, "ver": 1}, DEV_SECRET_KEY, algorithm="HS256")
    client = client_for(settings)
    auth = {"Authorization": f"Bearer {forged}"}
    for path in ("/auth/me", "/stock/AAPL", "/v2/quotes?symbols=AAPL"):
        r = client.get(path, headers=auth)
        assert r.status_code == 401 and r.json()["error"]["details"] == {"reason": "token_invalid"}, path


# ─── tokens ──────────────────────────────────────────────────────────────────


def test_token_roundtrip_has_required_claims(ana_hash):
    import jwt

    settings = make_settings(ana_hash)
    token, expires = create_token("ana", settings, now=T0)
    claims = jwt.decode(token, SECRET, algorithms=["HS256"], options={"verify_exp": False})
    assert claims["sub"] == "ana" and claims["ver"] == 1
    assert claims["exp"] - claims["iat"] == 12 * 3600
    assert expires == T0 + dt.timedelta(hours=12)


def test_token_expires_after_ttl(ana_hash):
    settings = make_settings(ana_hash, TOKEN_TTL_HOURS="2")
    with time_machine.travel(T0, tick=False):
        token, _ = create_token("ana", settings)
        assert verify_token(token, settings).username == "ana"
    with time_machine.travel(T0 + dt.timedelta(hours=1, minutes=59), tick=False):
        assert verify_token(token, settings).username == "ana"
    with time_machine.travel(T0 + dt.timedelta(hours=2, seconds=1), tick=False):
        with pytest.raises(ApiError) as err:
            verify_token(token, settings)
    assert err.value.status == 401 and err.value.details == {"reason": "token_expired"}


def test_token_version_bump_revokes(ana_hash):
    v1 = make_settings(ana_hash)
    v2 = make_settings(ana_hash, TOKEN_VERSION="2")
    token, _ = create_token("ana", v1)
    assert verify_token(token, v1).username == "ana"
    with pytest.raises(ApiError) as err:
        verify_token(token, v2)
    assert err.value.details == {"reason": "token_revoked"}


def test_token_rejected_with_other_secret_or_removed_user(ana_hash):
    settings = make_settings(ana_hash)
    token, _ = create_token("ana", settings)
    other = make_settings(ana_hash, SECRET_KEY="otra-llave-secreta-de-32-caracteres-xx")
    with pytest.raises(ApiError):
        verify_token(token, other)
    without_ana = Settings.from_env({"SECRET_KEY": SECRET, "USERS": "{}"})
    with pytest.raises(ApiError) as err:
        verify_token(token, without_ana)
    assert err.value.details == {"reason": "user_unknown"}


# ─── endpoints ───────────────────────────────────────────────────────────────


def test_login_and_me(ana_hash):
    client = client_for(make_settings(ana_hash))
    r = client.post("/auth/login", json={"username": "Ana", "password": "correcta-y-larga"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"] == {"username": "ana", "displayName": "Ana"}
    assert body["expiresAt"].endswith("Z") and r.headers["cache-control"] == "no-store"
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200 and me.json() == {"user": body["user"], "expiresAt": body["expiresAt"]}
    assert client.get("/auth/me").status_code == 401


def test_login_wrong_password_is_401_without_details(ana_hash):
    client = client_for(make_settings(ana_hash))
    r = client.post("/auth/login", json={"username": "ana", "password": "mala"})
    assert r.status_code == 401
    assert r.json() == {"error": {"code": "UNAUTHORIZED", "message": "Usuario o contraseña incorrectos."}}
    bad = client.post("/auth/login", json={"username": "ana"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "input" not in json.dumps(bad.json())


def test_login_rate_limit_per_ip_returns_429_with_retry_after(ana_hash):
    client = client_for(make_settings(ana_hash))
    headers = {"X-Forwarded-For": "203.0.113.7, 10.0.0.1"}
    codes = [
        client.post("/auth/login", json={"username": f"u{i}", "password": "x"}, headers=headers).status_code
        for i in range(6)
    ]
    assert codes == [401] * 5 + [429]
    r = client.post("/auth/login", json={"username": "ana", "password": "correcta-y-larga"}, headers=headers)
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"
    assert 1 <= int(r.headers["retry-after"]) <= 60
    other_ip = client.post(
        "/auth/login", json={"username": "ana", "password": "correcta-y-larga"}, headers={"X-Forwarded-For": "198.51.100.1"}
    )
    assert other_ip.status_code == 200


def test_login_rate_limit_per_username_across_ips(ana_hash):
    client = client_for(make_settings(ana_hash))
    codes = [
        client.post(
            "/auth/login", json={"username": "ana", "password": "mala"}, headers={"X-Forwarded-For": f"192.0.2.{i}"}
        ).status_code
        for i in range(11)
    ]
    assert codes == [401] * 10 + [429]


def test_token_bucket_refills_with_clock():
    now = [0.0]
    bucket = TokenBucket.per_period(5, 60, clock=lambda: now[0])
    assert all(bucket.take("k")[0] for _ in range(5))
    allowed, wait = bucket.take("k")
    assert not allowed and wait == pytest.approx(12.0)
    now[0] = 12.0
    assert bucket.take("k")[0]
    limiter = LoginRateLimiter(clock=lambda: now[0])
    assert limiter.check("1.1.1.1", "Ana") is None


# ─── compuerta AUTH_REQUIRED ─────────────────────────────────────────────────


def test_auth_required_gates_v2_and_legacy_but_not_health(ana_hash):
    settings = make_settings(ana_hash, AUTH_REQUIRED="true", KAIZEN_LEGACY_ROUTES="1")
    client = client_for(settings)

    health = client.get("/health")
    assert health.status_code == 200 and health.json()["authRequired"] is True

    v2 = client.get("/v2/quotes?symbols=AAPL")
    assert v2.status_code == 401 and v2.json()["error"]["code"] == "UNAUTHORIZED"
    assert v2.headers["www-authenticate"] == "Bearer"
    assert client.get("/v2/quotes?symbols=AAPL", headers={"Authorization": "Bearer basura"}).status_code == 401
    legacy = client.get("/rf")
    assert legacy.status_code == 401 and legacy.json()["error"]["code"] == "UNAUTHORIZED"

    golden = load_golden(GOLDENS_DIR / "get_rf__noargs.json")
    with replaying(golden["fixture_set"]) as rp:  # reloj congelado: el token se emite dentro
        token = client.post("/auth/login", json={"username": "ana", "password": "correcta-y-larga"}).json()["token"]
        auth = {"Authorization": f"Bearer {token}"}
        # Símbolos inválidos a propósito: prueba que la sesión pasó sin ejecutar la ruta, que su
        # stream puede implementar cualquier día (y entonces saldría a los proveedores).
        authorized = client.get("/v2/quotes?symbols=,,,", headers=auth)
        assert authorized.status_code == 422 and authorized.json()["error"]["code"] == "VALIDATION_ERROR"
        kaizen_api.reset_state()
        r = client.get("/rf", headers=auth)
    assert rp.misses == [] and r.status_code == 200
    assert compare(r.json(), golden["output"]) == []


def test_auth_optional_when_not_required(ana_hash):
    client = client_for(make_settings(ana_hash))
    # Sin AUTH_REQUIRED la ruta se atiende con token o sin él: llega hasta la validación (422),
    # que es lo que se puede afirmar sin ejecutar la ruta ni salir a los proveedores.
    for headers in ({}, {"Authorization": "Bearer basura"}):
        r = client.get("/v2/quotes?symbols=,,,", headers=headers)
        assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_hash_password_script_prints_a_usable_hash(capsys):
    import importlib.util
    from pathlib import Path

    script = Path(__file__).resolve().parents[2] / "scripts" / "hash_password.py"
    spec = importlib.util.spec_from_file_location("hash_password_script", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.main(["--password", "una-clave-larga", "--user", "Ana"]) == 0
    out = capsys.readouterr().out.splitlines()
    encoded = out[0]
    assert verify_password("una-clave-larga", encoded)
    users = json.loads(out[-1])
    assert users == {"ana": encoded}
    settings = Settings.from_env({"KAIZEN_ENV": "production", "SECRET_KEY": SECRET, "USERS": out[-1]})
    assert authenticate("ana", "una-clave-larga", settings) == "ana"
    assert "una-clave-larga" not in "\n".join(out)


def test_rate_limit_keys_are_bounded():
    limiter = LoginRateLimiter()
    limiter.check("1.2.3.4", "x" * 5000)
    assert max(len(k) for k in limiter.by_user._buckets) <= len("user:") + 64
    for i in range(20):
        limiter.by_ip.max_keys = 10
        limiter.check(f"10.0.0.{i}", "ana")
    assert len(limiter.by_ip._buckets) <= 10
