"""Piezas compartidas de las pruebas de V5FX: la app sin sesión y el replay de las tres capas."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from kaizen_api.main import create_app
from kaizen_api.settings import Settings, configure
from tests.replay import load_module, replaying, reset_backend_state

V5FX_SETS = "2026-09-22,2026-10-01-banxico,2026-10-01-v5fx"


def build_app():
    env = {
        "KAIZEN_ENV": "development",
        "AUTH_REQUIRED": "false",
        "KAIZEN_LEGACY_ROUTES": "0",
        "BANXICO_TOKEN": "token-falso",
    }
    return create_app(Settings.from_env(env))


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(build_app()) as c:
        yield c
    configure(None)


@pytest.fixture
def replay_client() -> Iterator[TestClient]:
    """Cliente sobre el replay de las capas (red bloqueada, reloj del set base: 2026-09-22)."""
    package = load_module("kaizen_api")
    with replaying(V5FX_SETS) as session:
        reset_backend_state(package)
        with TestClient(build_app()) as c:
            yield c
    configure(None)
    reset_backend_state(package)
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"
