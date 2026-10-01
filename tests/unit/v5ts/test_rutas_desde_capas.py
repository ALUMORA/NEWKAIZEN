"""Las cuatro rutas del centro de tasas se reproducen completas desde las capas grabadas.

Capas: el set base, la compartida ``2026-10-01-banxico`` y la de V5TS (FRED de los plazos que el
base no tenía, la SOFR y los CSV del Tesoro). El reloj es el del set base: 2026-09-22.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from kaizen_api import schemas
from kaizen_api.settings import Settings, configure
from tests.replay import load_module, replaying, reset_backend_state

SETS = "2026-09-22,2026-10-01-banxico,2026-10-01-v5ts"
URLS = {
    "/v2/curves?country=mx&compare=1m,1y": schemas.CurvesResponse,
    "/v2/curves?country=us&compare=1m,1y": schemas.CurvesResponse,
    "/v2/curves/spreads?history=1y": schemas.CurveSpreadsResponse,
    "/v2/curves/spreads?history=5y": schemas.CurveSpreadsResponse,
    "/v2/money-market": schemas.MoneyMarketResponse,
    "/v2/expectations": schemas.ExpectationsResponse,
}


def _client(token: str | None) -> TestClient:
    from kaizen_api.main import create_app

    env = {"BANXICO_TOKEN": token} if token else {}
    settings = Settings.from_env(env)
    configure(settings)
    return TestClient(create_app(settings))


@pytest.fixture
def con_token() -> Iterator[TestClient]:
    package = load_module("kaizen_api")
    with replaying(SETS) as session:
        reset_backend_state(package)
        yield _client("token-falso-de-replay")
    configure(None)
    reset_backend_state(package)
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"


@pytest.fixture
def sin_token() -> Iterator[TestClient]:
    package = load_module("kaizen_api")
    with replaying(SETS) as session:
        reset_backend_state(package)
        yield _client(None)
    configure(None)
    reset_backend_state(package)
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"


@pytest.mark.parametrize("url", list(URLS))
def test_cada_ruta_responde_con_su_contrato(con_token, url):
    resp = con_token.get(url)
    assert resp.status_code == 200, resp.text
    body = URLS[url].model_validate(resp.json())
    assert body.meta.fallback is False
    assert body.meta.asOf is not None and body.meta.asOf <= "2026-09-22"


def test_curva_de_mexico_con_fechas_por_nodo_y_sin_ceros(con_token):
    body = con_token.get("/v2/curves?country=mx&compare=1m,1y").json()
    assert [n["tenorDays"] for n in body["nodes"]] == [28, 91, 182, 364, 1095, 1825, 3650, 7300, 10950]
    assert all(n["value"] and 0.01 < n["value"] < 0.2 for n in body["nodes"])
    assert len({n["asOf"] for n in body["nodes"]}) > 1, "en México cada plazo trae la fecha de su subasta"
    assert set(body["compare"]) == {"1m", "1y"}
    veinte = next(b for b in body["breakeven"] if b["tenorDays"] == 7300)
    assert veinte["value"] == pytest.approx(0.048083, abs=1e-6) and veinte["simpleBp"] == 503
    assert body["meta"]["source"] == "banxico"


def test_curva_de_eeuu_mezcla_fred_y_tesoro_y_trae_la_real(con_token):
    body = con_token.get("/v2/curves?country=us").json()
    ids = [n["seriesId"] for n in body["nodes"]]
    assert {"TSY-PAR-3Y", "TSY-PAR-7Y", "TSY-PAR-20Y", "DGS10"} <= set(ids)
    assert body["compare"] == {}
    assert [r["tenorDays"] for r in body["real"]] == [1825, 2555, 3650, 7300, 10950]
    for b in body["breakeven"]:
        assert b["dateGapDays"] == 0 and 0 < b["value"] < 0.05
    assert body["meta"]["source"] == "fred,treasury"


def test_diferenciales_marcan_fechas_distintas(con_token):
    body = con_token.get("/v2/curves/spreads?history=5y").json()
    for row in body["rows"]:
        assert row["asOfMismatch"] == (row["dateGapDays"] > 7)
        assert row["spreadBp"] == pytest.approx((row["mx"] - row["us"]) * 10_000, abs=0.01)
    assert len(body["history10y"]["dates"]) > 20


def test_mercado_de_dinero_no_repite_lo_de_rates_mx(con_token):
    body = con_token.get("/v2/money-market").json()
    assert [r["id"] for r in body["rows"]] == ["tiie91", "tiie182", "dff", "sofr", "ust1m", "ust3m", "ust6m", "ust1y"]
    assert all(r["value"] is not None for r in body["rows"])
    assert {c["id"] for c in body["mxChanges"]} <= set(schemas.MxRateId.__args__)
    assert any("New York" in n for n in body["meta"]["notes"]), "la SOFR exige la cita del NY Fed"


def test_expectativas_de_la_encuesta_de_septiembre(con_token):
    body = con_token.get("/v2/expectations").json()
    assert body["survey"]["surveyDate"] == "2026-09-01" and body["survey"]["yearT"] == 2026
    assert all(i["verified"] and i["median"] is not None for i in body["survey"]["items"])
    real = body["realRates"]
    assert real["exPost"] == pytest.approx((1 + real["cetes28"]) / (1 + real["observedInflation"]) - 1, abs=1e-6)
    assert [f["toDays"] for f in body["impliedForwards"]["mx"]] == [28, 91, 182, 364]


def test_health_anuncia_las_tres_capacidades(con_token):
    caps = set(con_token.get("/health").json()["capabilities"])
    assert {"curves", "moneyMarket", "expectations"} <= caps


def test_sin_token_mexico_queda_s_d_salvo_el_bono_10a_de_fred_como_respaldo(sin_token):
    body = sin_token.get("/v2/curves?country=mx").json()
    con_dato = [n for n in body["nodes"] if n["value"] is not None]
    assert [n["seriesId"] for n in con_dato] == ["IRLTLT01MXM156N"]
    assert body["meta"]["fallback"] is True and body["meta"]["source"] == "fred"
    assert all(r["value"] is None for r in body["real"])


def test_sin_token_el_mercado_de_dinero_deja_la_tiie_en_s_d(sin_token):
    body = sin_token.get("/v2/money-market").json()
    tiie = [r for r in body["rows"] if r["country"] == "MX"]
    assert all(r["value"] is None for r in tiie)
    assert body["mxChanges"] == []
    assert any("token de Banxico" in n for n in body["meta"]["notes"])


def test_cada_proveedor_con_su_user_agent(monkeypatch):
    """El Tesoro con 'Mozilla/5.0' y timeout de 30 s; FRED con el User-Agent de fábrica de requests."""
    from kaizen_api import reset_state
    from kaizen_api.providers import fred, treasury

    vistos: list[tuple[str, dict, float]] = []

    class _Resp:
        status_code = 200
        text = 'Date,"10 Yr"\n09/22/2026,5.01\n'

    def _get(url, params=None, headers=None, timeout=None):
        vistos.append((url, headers or {}, timeout))
        return _Resp()

    reset_state()
    monkeypatch.setattr(treasury.requests, "get", _get)
    treasury.fetch_year("par", 2026)
    monkeypatch.setattr(fred.requests, "get", _get)
    fred.fetch_series("DGS10")
    reset_state()
    (t_url, t_headers, t_timeout), (_, f_headers, _) = vistos
    assert "home.treasury.gov" in t_url and t_headers["User-Agent"] == "Mozilla/5.0" and t_timeout == 30
    assert "User-Agent" not in f_headers
