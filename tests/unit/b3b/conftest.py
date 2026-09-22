"""Fixtures del stream B3b: la capa propia de grabaciones encima del set base.

Las llamadas mensuales (``history?interval=1mo``) y los estados de GFNORTEO.MX los grabó B3b en
``tests/fixtures/recorded/2026-09-22-b3b``. El ``replay`` compartido de ``tests/conftest.py`` solo
monta el set base, así que aquí se apila la capa sin pisar la variable de entorno de nadie.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from tests.replay import DEFAULT_SET, ReplaySession, format_sets, replaying

B3B_LAYER = "2026-09-22-b3b"


def b3b_set() -> str:
    base = os.environ.get("KAIZEN_REPLAY_SET") or DEFAULT_SET
    names = [n.strip() for n in base.split(",") if n.strip()]
    if B3B_LAYER not in names:
        names.append(B3B_LAYER)
    return format_sets(",".join(names))


@pytest.fixture
def replay_b3b() -> Iterator[ReplaySession]:
    """Replay con la capa de B3b encima del set base; falla si algo no estaba grabado."""
    import kaizen_api

    with replaying(b3b_set()) as session:
        kaizen_api.reset_state()
        yield session
        kaizen_api.reset_state()
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"


@pytest.fixture
def client(replay_b3b) -> Iterator[TestClient]:
    """La app v2 completa contra las grabaciones, sin sesión obligatoria."""
    from kaizen_api.main import create_app
    from kaizen_api.settings import Settings, configure

    app = create_app(Settings.from_env({"KAIZEN_ENV": "development", "AUTH_REQUIRED": "false"}))
    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        configure(None)
