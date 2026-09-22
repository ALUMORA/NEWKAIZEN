"""Fixtures del stream B2a: la app servida desde las capas de fixtures grabadas.

La capa ``2026-09-22-b2a`` trae las 7 llamadas a Yahoo que el set base no tenía (el histórico
diario de un año de AAPL, WALMEX.MX y NAFTRAC.MX, el ``MXN=X`` de 5 días y de un año, el ``info``
de NAFTRAC.MX y el histórico vacío del símbolo inexistente). Se pone encima del set base para que
``pytest`` sin variables de entorno también las encuentre.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from kaizen_api.cache import reset_state
from kaizen_api.main import create_app
from kaizen_api.settings import Settings
from tests.replay import ReplaySession, parse_sets, replaying

LAYER = "2026-09-22-b2a"


@pytest.fixture
def b2a_replay(replay_set: str) -> Iterator[ReplaySession]:
    """Replay con la capa de B2a encima del set base, sin red y con el reloj congelado."""
    names = parse_sets(replay_set)
    if LAYER not in names:
        names = [*names, LAYER]
    reset_state()
    with replaying(names) as session:
        yield session
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"
    reset_state()


@pytest.fixture
def client(b2a_replay: ReplaySession) -> TestClient:
    """Cliente HTTP contra la app v2 armada dentro del replay."""
    app = create_app(Settings.from_env({"KAIZEN_LEGACY_ROUTES": "0"}))
    return TestClient(app, raise_server_exceptions=False)
