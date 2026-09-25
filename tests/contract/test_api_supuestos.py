"""``GET /v2/assumptions`` (pedido F4): prima de mercado y riesgo país del archivo de Damodaran.

El optimizador copiaba ``DEFAULT_ERP = 0.0423`` de ``damodaran_2026.json``. Con esta ruta el cliente
lee la misma cifra que usa ``/v2/valuation`` por omisión, con su fuente y su fecha, así que las dos
pantallas no pueden separarse cuando cambie el vintage. La ruta no sale a la red.
"""

from __future__ import annotations

import datetime as _dt

import pytest
from fastapi.testclient import TestClient

from kaizen_api import schemas
from kaizen_api.domain.valuation import params
from kaizen_api.main import create_app
from kaizen_api.settings import Settings

SECRET = "prueba-secreta-de-32-caracteres-o-mas-0123"


@pytest.fixture(scope="module")
def client():
    return TestClient(create_app(Settings.from_env({"AUTH_REQUIRED": "false"})), raise_server_exceptions=False)


def test_supuestos_cumplen_el_contrato_y_salen_del_archivo(client):
    r = client.get("/v2/assumptions")
    assert r.status_code == 200, r.text
    body = schemas.AssumptionsResponse.model_validate(r.json())
    data = params.dataset()
    assert body.matureMarketErp == data["matureMarketErp"] == 0.0423
    assert body.crp == {"MX": data["countries"]["Mexico"]["crp"], "US": data["countries"]["United States"]["crp"]}
    assert body.vintage == data["vintage"] and body.asOf == data["dataUpdated"]
    assert body.sourceUrl == data["homepage"]
    assert "Damodaran" in body.source and "enero 2026" in body.source
    assert body.meta.source == "damodaran" and body.meta.asOf == body.asOf and body.meta.fallback is False
    assert r.headers["cache-control"] == "private, max-age=21600"
    assert "—" not in r.text and "–" not in r.text


def test_erp_es_la_misma_que_usa_la_valuacion_por_omision(client):
    body = client.get("/v2/assumptions").json()
    for country in ("Mexico", "United States"):
        risk = params.country_risk(country)
        assert body["erp"] == risk.mature_erp
        assert body["crp"][{"Mexico": "MX", "United States": "US"}[country]] == risk.crp


def test_el_archivo_viejo_se_marca_stale():
    assert params.assumptions(today=_dt.date(2026, 9, 25))["stale"] is False
    viejo = params.assumptions(today=_dt.date(2027, 3, 1))
    assert viejo["stale"] is True
    assert any("vintage más nuevo" in n for n in viejo["notes"])


def test_sin_sesion_no(client):
    app = create_app(Settings.from_env({"AUTH_REQUIRED": "true", "SECRET_KEY": SECRET, "USERS": "{}"}))
    r = TestClient(app, raise_server_exceptions=False).get("/v2/assumptions")
    assert r.status_code == 401
    assert schemas.ErrorBody.model_validate(r.json()).error.code == "UNAUTHORIZED"


def test_health_anuncia_la_capacidad(client):
    assert "assumptions" in client.get("/health").json()["capabilities"]
