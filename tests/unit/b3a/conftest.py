"""Piezas compartidas de las pruebas de B3a.

Las rutas de B3a necesitan llamadas que el set base no tiene (dividendos, calendario y las Formas
4 de la SEC), y esas viven en la capa ``2026-09-22-b3a``. Por eso aquí se abre una sesión de
replay con las DOS capas en vez de usar la del ``conftest`` de arriba, que solo toma
``KAIZEN_REPLAY_SET`` o el set base: así ``pytest`` a secas, sin variables de entorno, corre estas
pruebas sin red igual que las demás.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from tests.replay import ReplaySession, replaying

B3A_SET = "2026-09-22,2026-09-22-b3a"
"""Set base primero (manda) y encima la capa de B3a, que solo AGREGA llamadas."""


@pytest.fixture
def replay_b3a() -> Iterator[ReplaySession]:
    """Replay con las dos capas, reloj congelado y caches limpias entre pruebas."""
    import kaizen_api

    kaizen_api.reset_state()
    with replaying(B3A_SET) as session:
        yield session
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"
    kaizen_api.reset_state()


@pytest.fixture
def client(replay_b3a: ReplaySession) -> TestClient:
    """Cliente del API con el replay ya instalado."""
    from kaizen_api.main import create_app
    from kaizen_api.settings import Settings

    return TestClient(create_app(Settings.from_env({})), raise_server_exceptions=False)


def strings(value) -> list[str]:
    """Todos los textos de una respuesta, para revisar el estilo (nada de guiones largos)."""
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
