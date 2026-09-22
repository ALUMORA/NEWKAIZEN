"""Configuración: USERS validado al arrancar, orígenes CORS y la compuerta de las rutas v1.

La regla de fondo es la misma en los tres casos: una configuración que en producción sería un
agujero (un hash que nadie puede usar, un origen de más, las rutas viejas abiertas) tiene que doler
al arrancar, no cuando alguien intenta entrar.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from kaizen_api.main import create_app
from kaizen_api.security.auth import authenticate, hash_password, parse_hash
from kaizen_api.settings import DEFAULT_ORIGIN_REGEX, Settings, SettingsError

from .conftest import PASSWORD, SECRET

PROD = {"KAIZEN_ENV": "production", "SECRET_KEY": SECRET}


# ─── USERS ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "value,why",
    [
        ("scrypt$", "hash scrypt"),
        ("scrypt$16384$8$1$nohex$00", "hash scrypt"),
        ("scrypt$3$8$1$aa$" + "00" * 32, "hash scrypt"),  # n no es potencia de dos
        ("scrypt$1048576$8$1$aa$" + "00" * 32, "hash scrypt"),  # n arriba del tope
        ("scrypt$16384$8$1$aa$00", "hash scrypt"),  # hash demasiado corto
    ],
)
def test_malformed_scrypt_entries_are_rejected_in_production(value, why):
    # S1 los aceptaba en silencio y ese usuario no podía entrar nunca: un servicio "arriba" con
    # nadie adentro. Cada valor de arriba es uno que verify_password rechaza.
    assert parse_hash(value) is None
    with pytest.raises(SettingsError, match=why):
        Settings.from_env({**PROD, "USERS": json.dumps({"ana": value})})
    dev = Settings.from_env({"USERS": json.dumps({"ana": value})})
    assert "ana" not in dev.users and any(why in w for w in dev.warnings)
    assert not any(value in w for w in dev.warnings), "el hash no se imprime en los avisos"


def test_a_good_hash_passes_and_still_logs_in(ana_hash):
    settings = Settings.from_env({**PROD, "USERS": json.dumps({"Ana": ana_hash})})
    assert settings.users == {"ana": ana_hash}
    assert authenticate("ana", PASSWORD, settings) == "ana"


def test_non_string_and_empty_entries(ana_hash):
    for users in ('{"ana": 123}', '{"ana": null}', '{"ana": {"clave": "x"}}', '{"ana": ""}'):
        with pytest.raises(SettingsError, match="no es una cadena"):
            Settings.from_env({**PROD, "USERS": users})
        dev = Settings.from_env({"USERS": users})
        assert dev.users == {} and any("no es una cadena" in w for w in dev.warnings)
    with pytest.raises(SettingsError, match="usuario vacío"):
        Settings.from_env({**PROD, "USERS": json.dumps({"   ": ana_hash})})


def test_one_bad_entry_does_not_hide_the_good_ones(ana_hash):
    dev = Settings.from_env({"USERS": json.dumps({"ana": ana_hash, "beto": 7})})
    assert list(dev.users) == ["ana"]


def test_hash_from_the_script_is_accepted():
    # El camino completo: lo que imprime scripts/hash_password.py entra tal cual en USERS.
    encoded = hash_password("otra-clave-larga")
    settings = Settings.from_env({**PROD, "USERS": json.dumps({"beto": encoded})})
    assert authenticate("beto", "otra-clave-larga", settings) == "beto"


# ─── orígenes CORS ───────────────────────────────────────────────────────────


def test_team_slug_narrows_the_preview_regex():
    s = Settings.from_env({**PROD, "VERCEL_TEAM_SLUG": "alumora", "ALLOWED_ORIGINS": "https://newkaizen.vercel.app"})
    assert s.allowed_origin_regex != DEFAULT_ORIGIN_REGEX
    client = TestClient(create_app(s))
    ours = client.get("/health", headers={"Origin": "https://newkaizen-git-rama-alumora.vercel.app"})
    assert ours.headers["access-control-allow-origin"] == "https://newkaizen-git-rama-alumora.vercel.app"
    # El caso que abría la regex default: otro proyecto de Vercel que empieza igual.
    theirs = client.get("/health", headers={"Origin": "https://newkaizen-atacante.vercel.app"})
    assert "access-control-allow-origin" not in theirs.headers
    # El dominio de producción va en ALLOWED_ORIGINS, que es exacto.
    prod = client.get("/health", headers={"Origin": "https://newkaizen.vercel.app"})
    assert prod.headers["access-control-allow-origin"] == "https://newkaizen.vercel.app"


def test_team_slug_is_validated_and_yields_to_an_explicit_regex():
    with pytest.raises(SettingsError, match="VERCEL_TEAM_SLUG"):
        Settings.from_env({"VERCEL_TEAM_SLUG": "equipo malo|.*"})
    explicit = Settings.from_env({"ALLOWED_ORIGIN_REGEX": r"^https://kaizen\.mx$", "VERCEL_TEAM_SLUG": "alumora"})
    assert explicit.allowed_origin_regex == r"^https://kaizen\.mx$"
    assert any("VERCEL_TEAM_SLUG se ignora" in w for w in explicit.warnings)


def test_production_warns_when_the_wide_default_regex_is_in_use():
    wide = Settings.from_env(PROD)
    assert any("newkaizen-" in w for w in wide.warnings)
    quiet = Settings.from_env({**PROD, "VERCEL_TEAM_SLUG": "alumora"})
    assert not any("newkaizen-" in w for w in quiet.warnings)


# ─── rutas v1 ────────────────────────────────────────────────────────────────


def _client(**env):
    return TestClient(create_app(Settings.from_env(env)), raise_server_exceptions=False)


def test_legacy_routes_are_off_in_production_unless_asked_explicitly():
    off = _client(**PROD)
    assert off.get("/rf").status_code == 404
    assert off.get("/stock/AAPL").status_code == 404
    assert off.post("/login", json={"username": "ana", "password": "x"}).status_code == 404
    assert "legacy.v1" not in off.get("/health").json()["capabilities"]

    on = _client(**PROD, KAIZEN_LEGACY_ROUTES="1")
    assert "legacy.v1" in on.get("/health").json()["capabilities"]
    assert on.get("/stock/AAPL%20X").status_code == 200  # ticker inválido: respuesta v1, no 404
    assert any("KAIZEN_LEGACY_ROUTES=1 en producción" in w for w in Settings.from_env({**PROD, "KAIZEN_LEGACY_ROUTES": "1"}).warnings)


def test_legacy_routes_are_on_by_default_outside_production():
    dev = Settings.from_env({})
    assert dev.legacy_routes and not any("KAIZEN_LEGACY_ROUTES" in w for w in dev.warnings)
    assert "legacy.v1" in _client().get("/health").json()["capabilities"]
