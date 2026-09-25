"""``GET /v2/rates/mx/inpc``: nivel mensual del INPC general del SIE (pedido F1-3).

``isrOnGains`` sabe actualizar el costo por INPC, pero ningún endpoint publicaba la serie. Va en
ruta propia (``{"AAAA-MM": nivel}``), con el mismo candado del catálogo que las tasas: el SIE tiene
que confirmar título, periodicidad y unidad de ``SP1`` y el catálogo tiene que traerla revisada.
Los metadatos de ``sie_metadatos_inpc_2026-09-25.json`` son los reales de ese día, sin el token.
"""

from __future__ import annotations

import datetime as _dt
import json
import re
from pathlib import Path

import pytest
import responses
from fastapi.testclient import TestClient

from kaizen_api.domain import rates as rates_domain
from kaizen_api.providers import banxico
from kaizen_api.schemas import ErrorBody, InpcResponse

from .conftest import build_app

FIXTURE = Path(__file__).with_name("sie_metadatos_inpc_2026-09-25.json")
SIE_METADATOS_RE = re.compile(r"https://www\.banxico\.org\.mx/SieAPIRest/service/v1/series/[A-Z0-9,]+$")
SIE_DATOS_RE = re.compile(r"https://www\.banxico\.org\.mx/SieAPIRest/service/v1/series/SP1/datos/.+")

# Los datos reales del SIE del 25 de septiembre de 2026 (agosto 2026 contra agosto 2025 da 3.26 %,
# lo mismo que SP30578, la inflación anual de ese mes).
DATOS = [("01/08/2025", "140.867000000000"), ("01/09/2025", "141.197000000000"),
         ("01/07/2026", "145.169000000000"), ("01/08/2026", "145.462000000000")]


def _metadatos_reales() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _solo(sid: str) -> dict:
    crudo = _metadatos_reales()
    return {"bmx": {"series": [s for s in crudo["bmx"]["series"] if s["idSerie"] == sid]}}


@pytest.fixture
def sie(clean_state, monkeypatch):
    monkeypatch.setattr(rates_domain, "_today", lambda: _dt.date(2026, 9, 25))
    with responses.RequestsMock(assert_all_requests_are_fired=False) as mock:
        mock.add(responses.GET, SIE_METADATOS_RE, json=_solo("SP1"), status=200)
        mock.add(responses.GET, SIE_DATOS_RE, json={"bmx": {"series": [{
            "idSerie": "SP1", "titulo": "INPC", "datos": [{"fecha": f, "dato": d} for f, d in DATOS]}]}}, status=200)
        yield mock


def _cliente(**env) -> TestClient:
    return TestClient(build_app(**env), raise_server_exceptions=False)


def test_sp1_pasa_el_candado_con_sus_metadatos_reales_y_sus_vecinos_no():
    crudo = _metadatos_reales()["bmx"]["series"]
    meta = {s["idSerie"]: {"titulo": s["titulo"], "unidad": s["unidad"], "periodicidad": s["periodicidad"]} for s in crudo}
    entrada = banxico.index_catalog()["SP1"]
    assert banxico.mismatches(meta["SP1"], entrada) == []
    assert banxico.mismatches(meta["SP30577"], entrada), "la variación mensual no es el nivel del índice"
    assert banxico.mismatches(meta["SP74625"], entrada), "el subyacente no es el índice general"
    assert banxico.reviewed("SP1")
    assert "token" not in FIXTURE.read_text(encoding="utf-8").lower().replace("el token va en la cabecera", "")


def test_el_inpc_no_se_cuela_en_rates_mx():
    assert "SP1" not in banxico.catalog()
    assert all(item.get("rateId") for item in banxico.catalog().values())


def test_la_ruta_publica_aaaa_mm_con_su_nivel(sie):
    r = _cliente(BANXICO_TOKEN="token-de-prueba").get("/v2/rates/mx/inpc?start=2025-08-01")
    assert r.status_code == 200, r.text
    body = InpcResponse.model_validate(r.json())
    assert body.seriesId == "SP1"
    assert body.monthly == {"2025-08": 140.867, "2025-09": 141.197, "2026-07": 145.169, "2026-08": 145.462}
    assert list(body.monthly) == sorted(body.monthly)
    assert body.monthly["2026-08"] / body.monthly["2025-08"] - 1 == pytest.approx(0.0326, abs=5e-5)
    assert body.base and "2018" in body.base
    assert body.meta.source == "banxico" and body.meta.asOf == "2026-08-01"
    assert body.meta.stale is False and body.meta.fallback is False
    assert r.headers["cache-control"] == "private, max-age=3600"
    pedido = next(c.request.url for c in sie.calls if "/datos/" in c.request.url)
    assert pedido.endswith("/series/SP1/datos/2025-08-01/2026-09-25")
    assert "token-de-prueba" not in pedido, "el token va en la cabecera, nunca en la URL"


def test_sin_start_pide_desde_2000(sie):
    _cliente(BANXICO_TOKEN="token-de-prueba").get("/v2/rates/mx/inpc")
    pedido = next(c.request.url for c in sie.calls if "/datos/" in c.request.url)
    assert "/datos/2000-01-01/2026-09-25" in pedido


def test_un_mes_viejo_se_marca_stale(sie, monkeypatch):
    monkeypatch.setattr(rates_domain, "_today", lambda: _dt.date(2026, 12, 1))
    body = InpcResponse.model_validate(_cliente(BANXICO_TOKEN="t").get("/v2/rates/mx/inpc?end=2026-11-30").json())
    assert body.meta.stale is True
    assert any("atrasado" in n for n in body.meta.notes)


def test_sin_token_es_503_not_configured(clean_state):
    r = _cliente().get("/v2/rates/mx/inpc")
    assert r.status_code == 503
    assert ErrorBody.model_validate(r.json()).error.code == "NOT_CONFIGURED"


def test_si_el_sie_no_confirma_la_serie_no_se_publica(clean_state):
    otra = _solo("SP30577")
    otra["bmx"]["series"][0]["idSerie"] = "SP1"  # el id de siempre, pero con otro título
    with responses.RequestsMock(assert_all_requests_are_fired=False) as mock:
        mock.add(responses.GET, SIE_METADATOS_RE, json=otra, status=200)
        r = _cliente(BANXICO_TOKEN="t").get("/v2/rates/mx/inpc")
        assert not any("/datos/" in c.request.url for c in mock.calls), "sin candado no se piden datos"
    assert r.status_code == 503
    body = ErrorBody.model_validate(r.json())
    assert body.error.code == "UPSTREAM_UNAVAILABLE" and "SP1" in body.error.message


def test_fechas_invalidas_son_422(clean_state):
    r = _cliente(BANXICO_TOKEN="t").get("/v2/rates/mx/inpc?start=2026-02-30")
    assert r.status_code == 422


def test_el_contrato_rechaza_llaves_que_no_son_mes():
    with pytest.raises(ValueError):
        InpcResponse.model_validate({"seriesId": "SP1", "base": None, "monthly": {"2026-13": 1.0},
                                     "meta": {"asOf": None, "source": "banxico", "delayMinutes": None, "stale": False,
                                              "fallback": False, "generatedAt": "2026-09-25T00:00:00Z", "notes": []}})
