"""``GET /health``: honesto sobre los proveedores, público, y sin salir a la red nunca."""

from __future__ import annotations

import datetime as dt

import pytest
import time_machine

from kaizen_api import cache
from kaizen_api.routers import auth as auth_router
from kaizen_api.routers import health as health_router
from kaizen_api.routers import legacy_v1
from kaizen_api.schemas import KNOWN_CAPABILITIES, HealthResponse
from tests.replay import replaying

T0 = dt.datetime(2026, 9, 22, 18, 0, tzinfo=dt.UTC)


@pytest.fixture(autouse=True)
def _limpia_senales():
    cache.reset_state()
    yield
    cache.reset_state()


def test_providers_stay_null_until_somebody_actually_called_them(client_for):
    client = client_for()
    body = client.get("/health").json()
    assert body["providers"]["yahoo"] == {"ok": None}
    assert body["providers"]["sec"] == {"ok": None}
    # Sin señal, "no sé" es la respuesta honesta: decir ok=true sin haber llamado sería inventar.
    cache.record_provider_call("yahoo", True)
    cache.record_provider_call("sec", False)
    body = client.get("/health").json()
    assert body["providers"]["yahoo"] == {"ok": True}
    assert body["providers"]["sec"] == {"ok": False}


def test_the_signal_expires_and_volvemos_a_no_saber(client_for):
    client = client_for()
    with time_machine.travel(T0, tick=False):
        cache.record_provider_call("yahoo", True)
        assert client.get("/health").json()["providers"]["yahoo"]["ok"] is True
    with time_machine.travel(T0 + dt.timedelta(seconds=cache.PROVIDER_SIGNAL_TTL - 1), tick=False):
        assert client.get("/health").json()["providers"]["yahoo"]["ok"] is True
    with time_machine.travel(T0 + dt.timedelta(seconds=cache.PROVIDER_SIGNAL_TTL + 1), tick=False):
        assert client.get("/health").json()["providers"]["yahoo"]["ok"] is None


def test_health_never_calls_a_provider(client_for):
    """Render sondea /health seguido: una llamada por sondeo es la forma más tonta de que nos limiten."""
    client = client_for()
    with replaying("2026-09-22") as rp:
        for _ in range(3):
            assert client.get("/health").status_code == 200
    assert rp.misses == []
    assert cache.cache_stats()["providerSignals"] == 0  # ni siquiera dejó señal propia


def test_configured_providers_only_report_configuration(client_for):
    body = client_for(BANXICO_TOKEN="tok-secreto", FRED_API_KEY="llave", EODHD_API_TOKEN="x").get("/health").json()
    assert body["providers"]["banxico"] == {"configured": True}
    assert body["providers"]["fred"] == {"configured": True}
    assert body["providers"]["eodhd"] == {"configured": True}
    assert "tok-secreto" not in str(body) and "llave" not in str(body)


def test_version_commit_and_server_time(client_for):
    import kaizen_api

    por_defecto = client_for().get("/health").json()
    assert por_defecto["version"] == kaizen_api.__version__ and por_defecto["commit"] is None

    with time_machine.travel(T0, tick=False):
        body = client_for(KAIZEN_VERSION="2.1.0", RENDER_GIT_COMMIT="abc1234").get("/health").json()
    assert (body["version"], body["commit"]) == ("2.1.0", "abc1234")
    assert body["serverTime"] == "2026-09-22T18:00:00Z"
    HealthResponse.model_validate(body)


def test_capabilities_are_the_union_of_the_mounted_routers(client_for):
    client = client_for(KAIZEN_LEGACY_ROUTES="1")
    announced = client.get("/health").json()["capabilities"]
    esperadas: list[str] = []
    for module in (health_router, auth_router, legacy_v1):
        esperadas += [c for c in module.CAPABILITIES if c not in esperadas]
    assert set(esperadas) <= set(announced)
    assert set(announced) <= set(KNOWN_CAPABILITIES), "una capacidad que el contrato no conoce"
    assert len(announced) == len(set(announced)), "capacidades repetidas"
    # Un router que no se monta no anuncia nada.
    sin_legado = client_for(KAIZEN_LEGACY_ROUTES="0").get("/health").json()["capabilities"]
    assert "legacy.v1" not in sin_legado and "auth" in sin_legado


def test_health_is_public_and_not_cached_even_with_auth_required(client_for):
    client = client_for(AUTH_REQUIRED="true")
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["authRequired"] is True
    assert r.headers["cache-control"] == "no-store"
    # La misma app sí exige sesión en lo demás.
    assert client.get("/v2/quotes?symbols=AAPL").status_code == 401
    # Y con un token inválido /health sigue contestando: no depende de la sesión.
    assert client.get("/health", headers={"Authorization": "Bearer basura"}).status_code == 200


def test_health_shows_nothing_that_should_stay_inside(client_for):
    body = client_for(
        AUTH_REQUIRED="true",
        ALLOWED_ORIGINS="https://kaizen.mx",
        BANXICO_TOKEN="tok-secreto",
    ).get("/health").text
    for secreto in ("tok-secreto", "kaizen.mx", "ana", "scrypt$", "prueba-secreta"):
        assert secreto not in body


def test_health_is_the_same_app_object_state(client_for):
    """``capabilities`` sale del estado de la app, no de recorrer módulos en cada request."""
    client = client_for()
    assert client.app.state.capabilities == client.get("/health").json()["capabilities"]
