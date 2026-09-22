"""Revisión de seguridad de la superficie de B1: JWT, comparaciones, bitácora, errores y CORS.

Cada prueba de aquí corresponde a una afirmación que el handoff hace por escrito. Si alguna deja de
ser cierta, la afirmación también.
"""

from __future__ import annotations

import datetime as dt
import logging
import time
import warnings

import jwt
import pytest

from kaizen_api.errors import MESSAGES
from kaizen_api.security import auth as auth_mod
from kaizen_api.security.auth import (
    JWT_ALGORITHM,
    JWT_REQUIRED_CLAIMS,
    create_token,
    verify_token,
)
from kaizen_api.settings import DEV_SECRET_KEY

from .conftest import PASSWORD, SECRET

T0 = dt.datetime(2026, 9, 22, 12, 0, tzinfo=dt.UTC)


def claims(**extra) -> dict:
    now = int(time.time())
    base = {"sub": "ana", "iat": now, "exp": now + 3600, "ver": 1}
    base.update(extra)
    return base


# ─── JWT ─────────────────────────────────────────────────────────────────────


def test_algorithm_is_pinned_to_hs256(settings_for):
    settings = settings_for()
    assert JWT_ALGORITHM == "HS256"
    # alg=none: el truco clásico. PyJWT lo rechaza porque solo aceptamos HS256.
    sin_firma = jwt.encode(claims(), key="", algorithm="none")
    # Misma llave, otro algoritmo: también fuera, para que nadie confunda al validador.
    with warnings.catch_warnings():  # PyJWT avisa que la llave es corta para SHA512; es a propósito
        warnings.simplefilter("ignore")
        otro_alg = jwt.encode(claims(), SECRET, algorithm="HS512")
    for token in (sin_firma, otro_alg):
        with pytest.raises(Exception) as err:
            verify_token(token, settings)
        assert err.value.status == 401 and err.value.details == {"reason": "token_invalid"}


def test_every_required_claim_is_required(settings_for):
    settings = settings_for()
    assert set(JWT_REQUIRED_CLAIMS) == {"sub", "iat", "exp", "ver"}
    for falta in JWT_REQUIRED_CLAIMS:
        incompleto = {k: v for k, v in claims().items() if k != falta}
        token = jwt.encode(incompleto, SECRET, algorithm=JWT_ALGORITHM)
        with pytest.raises(Exception) as err:
            verify_token(token, settings)
        assert err.value.status == 401, falta


def test_a_token_signed_with_the_public_dev_key_is_rejected(settings_for):
    settings = settings_for()
    forjado = jwt.encode(claims(), DEV_SECRET_KEY, algorithm=JWT_ALGORITHM)
    with pytest.raises(Exception) as err:
        verify_token(forjado, settings)
    assert err.value.details == {"reason": "token_invalid"}


def test_the_token_carries_nothing_private(settings_for):
    token, _ = create_token("ana", settings_for(), now=T0)
    cuerpo = jwt.decode(token, SECRET, algorithms=[JWT_ALGORITHM], options={"verify_exp": False})
    assert set(cuerpo) == {"sub", "iat", "exp", "ver"}  # ni hash, ni correo, ni permisos
    assert PASSWORD not in token


# ─── comparaciones y usuarios inexistentes ───────────────────────────────────


def test_unknown_user_costs_the_same_work_as_a_wrong_password(settings_for, monkeypatch):
    """Sin el hash de relleno, un usuario inexistente contesta más rápido y eso enumera usuarios."""
    llamadas: list[str] = []
    original = auth_mod.verify_password

    def contar(password, encoded):
        llamadas.append(encoded)
        return original(password, encoded)

    monkeypatch.setattr(auth_mod, "verify_password", contar)
    settings = settings_for()
    assert auth_mod.authenticate("nadie", PASSWORD, settings) is None
    assert auth_mod.authenticate("ana", "mala", settings) is None
    assert len(llamadas) == 2, "el usuario inexistente también pasa por scrypt"
    assert llamadas[0] == auth_mod._DUMMY_HASH and llamadas[0] != llamadas[1]


def test_password_comparison_is_constant_time():
    import inspect

    fuente = inspect.getsource(auth_mod.verify_password) + inspect.getsource(auth_mod.authenticate)
    assert "compare_digest" in fuente
    assert "== password" not in fuente and "password ==" not in fuente


# ─── bitácora ────────────────────────────────────────────────────────────────


def test_the_log_line_has_no_secrets(client_for, caplog):
    client = client_for()
    with caplog.at_level(logging.INFO, logger="kaizen_api"):
        client.post(
            "/auth/login?token=en-la-query",
            json={"username": "ana", "password": PASSWORD},
            headers={"Authorization": "Bearer un-token-de-sesion", "X-Request-ID": "rid-1"},
        )
        client.post("/auth/login", json={"username": "ana", "password": "una-clave-malisima"})
    texto = caplog.text
    for secreto in (PASSWORD, "una-clave-malisima", "en-la-query", "un-token-de-sesion", "scrypt$"):
        assert secreto not in texto, secreto
    linea = next(r.getMessage() for r in caplog.records if "rid-1" in r.getMessage())
    assert linea.startswith("POST /auth/login 200 ") and "?" not in linea


def test_startup_warnings_do_not_print_credentials(caplog):
    from kaizen_api.main import create_app
    from kaizen_api.settings import Settings

    with caplog.at_level(logging.WARNING, logger="kaizen_api"):
        create_app(Settings.from_env({"USERS": '{"ana": "clave-en-texto-plano"}'}))
    assert "clave-en-texto-plano" not in caplog.text
    assert "texto plano" in caplog.text and "ana" in caplog.text


# ─── errores ─────────────────────────────────────────────────────────────────


def test_error_bodies_never_echo_what_the_client_sent(client_for):
    client = client_for()
    r = client.post("/auth/login", json={"username": "ana", "password": 12345})
    assert r.status_code == 422
    assert "12345" not in r.text and "ana" not in r.text
    assert r.json()["error"]["message"] == MESSAGES["VALIDATION_ERROR"]
    largo = client.post("/auth/login", json={"username": "a" * 500, "password": "x"})
    assert largo.status_code == 422 and "aaaa" not in largo.text


def test_the_401_says_the_same_thing_for_a_user_that_exists_and_one_that_does_not(client_for):
    client = client_for()
    esperado = {"error": {"code": "UNAUTHORIZED", "message": "Usuario o contraseña incorrectos."}}
    assert client.post("/auth/login", json={"username": "ana", "password": "mala"}).json() == esperado
    assert client.post("/auth/login", json={"username": "nadie", "password": "mala"}).json() == esperado


# ─── CORS y compresión ───────────────────────────────────────────────────────


def test_cors_allowlist_rejects_lookalike_origins(client_for):
    client = client_for()
    for origen in (
        "https://newkaizen.vercel.app.atacante.mx",
        "http://newkaizen.vercel.app",  # sin TLS
        "https://evil.example",
        "null",
    ):
        r = client.get("/health", headers={"Origin": origen})
        assert "access-control-allow-origin" not in r.headers, origen


def test_no_credentials_mode(client_for):
    r = client_for().get("/health", headers={"Origin": "https://newkaizen.vercel.app"})
    # Sin allow-credentials el token no puede viajar en cookie: va en Authorization y punto.
    assert "access-control-allow-credentials" not in r.headers
    assert r.headers["access-control-allow-origin"] == "https://newkaizen.vercel.app"


def test_gzip_compresses_big_answers_but_not_the_small_ones(client_for):
    client = client_for()
    grande = client.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert grande.headers["content-encoding"] == "gzip"
    chico = client.get("/health", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in chico.headers
