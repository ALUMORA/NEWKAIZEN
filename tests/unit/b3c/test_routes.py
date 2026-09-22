"""Las tres rutas de screeners: contrato, unidades, procedencia honesta y errores en español."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from kaizen_api import cache
from kaizen_api.domain.screeners import factors as F
from kaizen_api.domain.screeners import fibras as FB
from kaizen_api.domain.screeners import magic as M
from kaizen_api.main import create_app
from kaizen_api.routers import screeners
from kaizen_api.settings import Settings
from tests.unit.b3c import fakes
from tests.unit.b3c.test_fibras import fibra
from tests.unit.b3c.test_magic import emisora

SIN_GUION_LARGO = ("—", "–")


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.reset_state()
    yield
    cache.reset_state()


@pytest.fixture
def client():
    app = create_app(Settings.from_env({"KAIZEN_ENV": "development", "AUTH_REQUIRED": "false"}))
    return TestClient(app, raise_server_exceptions=False)


def _rico(sym, sector="Technology", **over):
    base = dict(
        sector=sector, trailingEps=5.0, currentPrice=50.0, bookValue=20.0,
        enterpriseToEbitda=10.0, freeCashflow=5e7, marketCap=1e10,
        returnOnEquity=0.2, returnOnAssets=0.1, operatingMargins=0.15,
        debtToEquity=50.0, revenueGrowth=0.08, earningsGrowth=0.12,
    )
    base.update(over)
    return fakes.symbol(sym, **base)


def sin_guiones(texto: str) -> bool:
    return not any(g in texto for g in SIN_GUION_LARGO)


# ─── /v2/screeners/factors ───────────────────────────────────────────────────


def test_factors_universo_propio_cumple_el_contrato(client, monkeypatch):
    monkeypatch.setattr(F, "fetch_symbols", lambda syms, **kw: ({s: _rico(s) for s in syms}, []))
    monkeypatch.setattr(F, "fetch_closes", lambda syms, **kw: {})
    r = client.get("/v2/screeners/factors?universe=custom&symbols=aapl,msft")
    assert r.status_code == 200
    body = r.json()
    assert body["universe"] == {"id": "custom", "name": "Lista propia", "size": 2}
    assert [f["symbol"] for f in body["rows"]] == ["AAPL", "MSFT"]
    fila = body["rows"][0]
    assert set(fila["scores"]) == {"value", "quality", "momentum", "lowVol", "growth", "composite"}
    assert 0.0 <= fila["coverage"] <= 1.0
    assert all("pass" in c for c in fila["checks"])
    assert body["meta"]["source"] == "yahoo,computed"
    assert body["meta"]["fallback"] is False
    assert body["meta"]["delayMinutes"] == 15
    assert r.headers["Cache-Control"] == "private, max-age=43200"
    assert sin_guiones(r.text)


def test_factors_universo_mx_usa_la_lista_curada(client, monkeypatch):
    vistos = {}

    def fake(syms, **kw):
        vistos["syms"] = syms
        return {s: _rico(s) for s in syms}, []

    monkeypatch.setattr(F, "fetch_symbols", fake)
    monkeypatch.setattr(F, "fetch_closes", lambda syms, **kw: {})
    r = client.get("/v2/screeners/factors?universe=mx")
    assert r.status_code == 200
    body = r.json()
    assert body["universe"]["id"] == "mx"
    assert body["universe"]["size"] == len(vistos["syms"]) >= 20
    assert "WALMEX.MX" in vistos["syms"]
    assert all(s.endswith(".MX") for s in vistos["syms"])


def test_factors_custom_sin_symbols_es_422(client):
    r = client.get("/v2/screeners/factors?universe=custom")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "símbolos" in r.json()["error"]["message"]


def test_factors_con_symbols_y_universo_curado_es_422(client):
    r = client.get("/v2/screeners/factors?universe=mx&symbols=AAPL")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_factors_con_simbolo_invalido_es_400(client):
    r = client.get("/v2/screeners/factors?universe=custom&symbols=AAPL,$$$$$$$$$$$$$$$$$$$$$")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_SYMBOL"


def test_factors_universo_desconocido_es_422(client):
    r = client.get("/v2/screeners/factors?universe=eu")
    assert r.status_code == 422


def test_factors_sin_datos_de_nadie_es_503(client, monkeypatch):
    monkeypatch.setattr(F, "fetch_symbols", lambda syms, **kw: ({s: fakes.symbol(s, error="caída") for s in syms}, []))
    monkeypatch.setattr(F, "fetch_closes", lambda syms, **kw: {})
    r = client.get("/v2/screeners/factors?universe=custom&symbols=AAPL,MSFT")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"
    assert r.headers["Cache-Control"] == "no-store"
    assert sin_guiones(r.text)


# ─── /v2/screeners/magic ─────────────────────────────────────────────────────


def test_magic_cumple_el_contrato_y_publica_fracciones(client, monkeypatch):
    monkeypatch.setattr(M, "fetch_symbols", lambda syms, **kw: ({s: emisora(s, cap=1e10) for s in syms}, []))
    r = client.get("/v2/screeners/magic?universe=us")
    assert r.status_code == 200
    body = r.json()
    assert body["universe"]["id"] == "us"
    assert body["partial"] is False
    fila = body["rows"][0]
    assert 0 < fila["earningsYield"] < 1
    assert 0 < fila["returnOnCapital"] < 1
    assert fila["currency"] == "USD"
    assert fila["rank"] == fila["rankEY"] + fila["rankROC"]
    assert body["meta"]["fallback"] is False
    assert r.headers["Cache-Control"] == "private, max-age=43200"
    assert sin_guiones(r.text)
    texto = r.text.lower()
    for prohibida in ("comprar", "vender", "recomendación de compra"):
        assert prohibida not in texto


def test_magic_universo_mx_excluye_financieras(client, monkeypatch):
    mxn = {"currency": "MXN", "financialCurrency": "MXN"}
    monkeypatch.setattr(M, "fetch_symbols", lambda syms, **kw: ({s: emisora(s, cap=1e11, info=mxn) for s in syms}, []))
    r = client.get("/v2/screeners/magic?universe=mx")
    assert r.status_code == 200
    body = r.json()
    fuera = {e["symbol"] for e in body["excluded"]}
    assert "GFNORTEO.MX" in fuera
    assert all(f["currency"] == "MXN" for f in body["rows"])
    assert "WALMEX.MX" in {f["symbol"] for f in body["rows"]}


def test_magic_universo_invalido_es_422(client):
    r = client.get("/v2/screeners/magic?universe=eu")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_magic_sin_datos_de_nadie_es_503(client, monkeypatch):
    monkeypatch.setattr(M, "fetch_symbols", lambda syms, **kw: ({s: fakes.symbol(s, error="caída") for s in syms}, []))
    r = client.get("/v2/screeners/magic?universe=us")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


# ─── /v2/screeners/fibras ────────────────────────────────────────────────────


def test_fibras_cumple_el_contrato(client, monkeypatch):
    monkeypatch.setattr(FB, "fetch_symbols", lambda syms, **kw: ({s: fibra(s) for s in syms}, []))
    r = client.get("/v2/screeners/fibras")
    assert r.status_code == 200
    body = r.json()
    assert len(body["rows"]) == 10
    fila = body["rows"][0]
    assert fila["currency"] == "MXN"
    assert fila["ltv"] == pytest.approx(0.35)
    assert fila["debtToMarketCap"] == pytest.approx(0.70)
    assert fila["cashFlowBasis"] in ("ocf", "fcf", "ffo_approx", None)
    assert fila["signal"] in ("descuento", "en_linea", "prima", "sin_datos")
    assert fila["type"] in ("propiedades", "hipotecaria", "energia", "otro")
    assert {f["symbol"] for f in body["rows"]} >= {"FUNO11.MX", "FHIPO14.MX"}
    assert next(f for f in body["rows"] if f["symbol"] == "FHIPO14.MX")["type"] == "hipotecaria"
    assert r.headers["Cache-Control"] == "private, max-age=43200"
    assert sin_guiones(r.text)


def test_fibras_sin_tasa_deja_el_diferencial_en_nulo(client, monkeypatch):
    monkeypatch.setattr(FB, "fetch_symbols", lambda syms, **kw: ({s: fibra(s) for s in syms}, []))
    r = client.get("/v2/screeners/fibras")
    body = r.json()
    assert body["cetes28"] is None
    assert all(f["spreadVsCetes"] is None for f in body["rows"])
    assert any("CETES 28" in n for n in body["meta"]["notes"])
    assert body["meta"]["source"] == "yahoo,computed"


def test_fibras_con_tasa_sustituta_marca_fallback(client, monkeypatch):
    from kaizen_api.domain import rates

    monkeypatch.setattr(FB, "fetch_symbols", lambda syms, **kw: ({s: fibra(s) for s in syms}, []))
    monkeypatch.setattr(rates, "get_cetes28",
                        lambda: {"rate": 0.0975, "asOf": "2026-09-18", "source": "fred", "fallback": True},
                        raising=False)
    r = client.get("/v2/screeners/fibras")
    body = r.json()
    assert body["cetes28"] == pytest.approx(0.0975)
    assert body["meta"]["fallback"] is True
    assert body["meta"]["source"] == "yahoo,computed,fred"
    assert body["rows"][0]["spreadVsCetes"] is not None


def test_fibras_extra_invalido_es_400(client):
    r = client.get("/v2/screeners/fibras?extra=FUNO11.MX,$$$$$$$$$$$$$$$$$$$$$")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_SYMBOL"


def test_fibras_extra_se_suma_a_la_lista(client, monkeypatch):
    vistos = {}

    def fake(syms, **kw):
        vistos["syms"] = list(syms)
        return {s: fibra(s) for s in syms}, []

    monkeypatch.setattr(FB, "fetch_symbols", fake)
    r = client.get("/v2/screeners/fibras?extra=vesta")
    assert r.status_code == 200
    assert "VESTA.MX" in vistos["syms"]
    assert len(r.json()["rows"]) == 11


def test_fibras_sin_datos_de_nadie_es_503(client, monkeypatch):
    monkeypatch.setattr(FB, "fetch_symbols", lambda syms, **kw: ({s: fakes.symbol(s, error="caída") for s in syms}, []))
    r = client.get("/v2/screeners/fibras")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


# ─── capacidades ─────────────────────────────────────────────────────────────


def test_health_anuncia_las_tres_capacidades(client):
    caps = client.get("/health").json()["capabilities"]
    assert {"screeners.factors", "screeners.magic", "screeners.fibras"} <= set(caps)
    assert screeners.CAPABILITIES == ["screeners.factors", "screeners.magic", "screeners.fibras"]
