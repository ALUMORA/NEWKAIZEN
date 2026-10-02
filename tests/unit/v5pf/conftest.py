"""Piezas compartidas de las pruebas de V5PF (agenda, temporada de reportes y ETF por dentro).

Las rutas de V5PF necesitan llamadas que el set base no tiene (``funds_data``, el calendario de
las 61 emisoras de las muestras y los dividendos del portafolio de ejemplo), y esas viven en la
capa ``2026-10-01-v5pf``. Se abre el replay con las dos capas para que ``pytest`` a secas corra
sin red.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from tests.replay import ReplaySession, replaying

V5PF_SET = "2026-09-22,2026-10-01-v5pf"
"""Set base primero (manda) y encima la capa de V5PF, que solo agrega llamadas."""


@pytest.fixture
def replay_v5pf() -> Iterator[ReplaySession]:
    import kaizen_api

    kaizen_api.reset_state()
    with replaying(V5PF_SET) as session:
        yield session
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"
    kaizen_api.reset_state()


@pytest.fixture
def client(replay_v5pf: ReplaySession) -> TestClient:
    from kaizen_api.main import create_app
    from kaizen_api.settings import Settings

    return TestClient(create_app(Settings.from_env({})), raise_server_exceptions=False)


def keys(value) -> list[str]:
    """Todas las llaves de una respuesta, a cualquier profundidad."""
    out: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            out.append(str(key))
            out.extend(keys(item))
    elif isinstance(value, list):
        for item in value:
            out.extend(keys(item))
    return out


def strings(value) -> list[str]:
    """Todos los textos de una respuesta, para revisar el estilo."""
    out: list[str] = []
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, dict):
        for key, item in value.items():
            out.append(str(key))
            out.extend(strings(item))
    elif isinstance(value, list):
        for item in value:
            out.extend(strings(item))
    return out
