"""Revisión de seguridad de fase 4 (stream SEC): AUTH_REQUIRED cerrado por omisión en producción.

Cada prueba falla con el código anterior a su arreglo. El reporte está en
``docs/overhaul/notas/fase4-seguridad.md``.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from kaizen_api.main import create_app
from kaizen_api.settings import Settings

from .conftest import SECRET

PROD = {"KAIZEN_ENV": "production", "SECRET_KEY": SECRET}


# ─── AUTH_REQUIRED cerrado por omisión en producción ─────────────────────────


def test_production_requires_a_session_when_auth_required_is_not_set():
    """Antes: KAIZEN_ENV=production sin AUTH_REQUIRED dejaba TODO el API v2 abierto, en silencio.

    Basta con que alguien cree el servicio de Render a mano (o borre la variable) para que las
    rutas de datos contesten sin sesión mientras el frontend sigue pidiendo login.
    """
    settings = Settings.from_env(PROD)
    assert settings.auth_required is True
    client = TestClient(create_app(settings), raise_server_exceptions=False)
    assert client.get("/health").json()["authRequired"] is True
    r = client.get("/v2/quotes", params={"symbols": "AAPL"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"


def test_production_can_still_be_opened_on_purpose_and_it_warns():
    settings = Settings.from_env({**PROD, "AUTH_REQUIRED": "false"})
    assert settings.auth_required is False
    assert any("AUTH_REQUIRED=false en producción" in w for w in settings.warnings)


def test_development_default_is_unchanged():
    dev = Settings.from_env({})
    assert dev.auth_required is False
    assert not any("AUTH_REQUIRED" in w for w in dev.warnings)

