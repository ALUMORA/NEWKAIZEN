"""Piezas compartidas de las pruebas de B2b (Banxico, FRED, tasas, macro, noticias y tono).

Todas corren sin red: las rutas se sirven desde las capas de fixtures ``2026-09-22`` más
``2026-09-22-b2b`` y lo de Banxico se simula con ``responses``, porque todavía no hay token.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from kaizen_api.main import create_app
from kaizen_api.settings import Settings, configure
from tests.replay import load_module, replaying, reset_backend_state

B2B_SETS = "2026-09-22,2026-09-22-b2b"
"""El set base primero y encima la capa de B2b, como dice docs/OWNERSHIP.md."""


def build_app(**env: str):
    """La app v2 sin sesión obligatoria, con el entorno que pida cada prueba."""
    base = {"KAIZEN_ENV": "development", "AUTH_REQUIRED": "false", "KAIZEN_LEGACY_ROUTES": "0"}
    base.update(env)
    return create_app(Settings.from_env(base))


@pytest.fixture
def b2b_replay() -> Iterator[object]:
    """Sesión de replay sobre las dos capas, con los cachés del proceso limpios."""
    package = load_module("kaizen_api")
    with replaying(B2B_SETS) as session:
        reset_backend_state(package)
        yield session
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"
    configure(None)
    reset_backend_state(package)


@pytest.fixture
def client(b2b_replay) -> Iterator[TestClient]:
    """Cliente contra la app v2 en replay (sin token de Banxico: es el caso de hoy)."""
    with TestClient(build_app(), raise_server_exceptions=False) as http:
        yield http
    configure(None)


@pytest.fixture
def clean_state() -> Iterator[None]:
    """Cachés del proceso limpios antes y después, para las pruebas que no usan replay."""
    package = load_module("kaizen_api")
    reset_backend_state(package)
    yield
    configure(None)
    reset_backend_state(package)
