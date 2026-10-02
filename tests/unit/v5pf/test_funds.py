"""ETF por dentro y rayos X: pruebas de respuesta conocida de la spec, una por una.

La exposición y el traslape se calculan en el navegador (``src/features/funds/lib/lookthrough.js``,
con sus pruebas de Vitest); aquí se prueba que los datos que manda ``/v2/funds`` llevan a las
cifras de la spec con la misma aritmética, y todo lo que decide el servidor.
"""

from __future__ import annotations

import re

import pandas as pd
import pytest

from kaizen_api import schemas
from kaizen_api.domain import funds as funds_mod
from kaizen_api.domain.events import YAHOO_PERSONAL_USE
from kaizen_api.providers.yahoo import funds as provider
from kaizen_api.routers import funds as funds_router
from tests.unit.v5pf.conftest import keys, strings

FORBIDDEN = re.compile(r"(firm|tograde|fromgrade|^action$|rating|target)", re.IGNORECASE)


def sector(body: dict, name: str) -> float:
    return next(row["weight"] for row in body["sectors"] if row["sector"] == name)


def top(body: dict) -> dict[str, float]:
    return {row["symbol"]: row["weight"] for row in body["topHoldings"]}


# ─── pruebas de la spec ──────────────────────────────────────────────────────


def test_half_spy_half_qqq_technology_exposure_is_04892(client):
    spy = client.get("/v2/funds/SPY").json()
    qqq = client.get("/v2/funds/QQQ").json()
    assert sector(spy, "Tecnología") == 0.3869
    assert sector(qqq, "Tecnología") == 0.5915
    assert round(0.5 * sector(spy, "Tecnología") + 0.5 * sector(qqq, "Tecnología"), 4) == 0.4892


def test_spy_qqq_overlap_on_the_top_ten_is_the_sum_of_minimums_and_at_least_02080(client):
    spy, qqq = top(client.get("/v2/funds/SPY").json()), top(client.get("/v2/funds/QQQ").json())
    for symbol in ("NVDA", "AAPL", "MSFT"):
        assert qqq[symbol] >= spy[symbol]
    overlap = sum(min(spy[s], qqq[s]) for s in spy if s in qqq)
    assert overlap >= 0.2080
    assert round(min(spy["NVDA"], qqq["NVDA"]) + min(spy["AAPL"], qqq["AAPL"]) + min(spy["MSFT"], qqq["MSFT"]), 4) == 0.2080


def test_aapl_direct_10_percent_plus_half_spy_is_013515():
    spy_aapl = 0.0703
    assert round(0.10 + 0.5 * spy_aapl, 5) == 0.13515


def test_aapl_direct_plus_half_spy_with_the_recorded_weight(client):
    spy = top(client.get("/v2/funds/SPY").json())
    assert round(spy["AAPL"], 4) == 0.0703
    assert round(0.10 + 0.5 * round(spy["AAPL"], 4), 5) == 0.13515


def test_yahoo_price_earnings_is_an_earnings_yield_so_pe_is_its_inverse(replay_v5pf):
    assert funds_mod.earnings_yield_to_pe(0.04035) == 24.78
    data = provider.get_fund_data("SPY")
    assert data["equity"]["Price/Earnings"] == 0.04035
    assert funds_mod.earnings_yield_to_pe(data["equity"]["Price/Earnings"]) == 24.78
    assert funds_mod.earnings_yield_to_pe(None) is None and funds_mod.earnings_yield_to_pe(0) is None


def test_the_category_average_copy_is_discarded_and_an_unverified_unit_is_null(replay_v5pf, monkeypatch):
    frame = pd.DataFrame(
        {"SPY": [0.000945, 0.03, 513975.7], "Category Average": [0.000945, 0.03, 513975.7]},
        index=pd.Index(["Annual Report Expense Ratio", "Annual Holdings Turnover", "Total Net Assets"], name="Attributes"),
    )
    ops = provider._operations(frame, "SPY")
    assert "categoryTotalNetAssets" not in ops and ops["totalNetAssets"] == 513975.7
    # unidad verificada: SPY cae en su AUM conocido como millones de dólares
    assert funds_mod.tna_divisor(513975.7) == 1.0
    assert funds_mod.tna_divisor(513_975_700_000.0) == 1_000_000.0
    # sin verificar: null
    assert funds_mod.tna_divisor(None) is None
    assert funds_mod.tna_divisor(42.0) is None
    assert funds_mod.total_net_assets(720847.44, None) is None
    real = provider.get_fund_data

    def spy_without_tna(symbol):
        data = real(symbol)
        if symbol == "SPY":
            data = {**data, "operations": {**data["operations"], "totalNetAssets": None}}
        return data

    monkeypatch.setattr(funds_mod._yahoo, "get_fund_data", spy_without_tna)
    body = funds_mod.get_fund("QQQ", "2026-09-22")
    assert body["totalNetAssets"] is None and body["totalNetAssetsUnit"] is None


# ─── lo demás que decide el servidor ─────────────────────────────────────────


def test_spy_fund_matches_the_contract_with_fractions_and_spanish_sectors(client):
    r = client.get("/v2/funds/SPY")
    assert r.status_code == 200
    body = schemas.FundResponse.model_validate(r.json())
    assert body.symbol == "SPY" and body.mappedFrom is None
    assert body.expenseRatio == 0.000945 and body.turnover == 0.03
    assert body.totalNetAssets == 513975.7 and body.totalNetAssetsUnit == "usdMillions"
    assert 0.99 < body.assetClasses.stock <= 1
    assert len(body.topHoldings) == 10
    assert body.coverage.topHoldingsWeight == pytest.approx(sum(h.weight for h in body.topHoldings), abs=1e-6)
    assert {s.sector for s in body.sectors} <= set(funds_mod.SECTORS_ES.values())
    assert [s.weight for s in body.sectors] == sorted((s.weight for s in body.sectors), reverse=True)
    assert YAHOO_PERSONAL_USE in body.meta.notes
    assert body.meta.source == "yahoo" and body.meta.fallback is False


def test_ivvpeso_is_mapped_to_ivv_and_says_where_the_mapping_comes_from(client):
    body = client.get("/v2/funds/IVVPESO.MX").json()
    assert body["symbol"] == "IVV" and body["mappedFrom"] == "IVVPESO.MX"
    assert any("IVVPESO.MX se muestra con la composición de IVV" in n for n in body["meta"]["notes"])


def test_naftrac_is_a_404_without_fund_data_and_no_provider_call(client, replay_v5pf):
    before = len(replay_v5pf.calls) if hasattr(replay_v5pf, "calls") else None
    r = client.get("/v2/funds/NAFTRAC.MX")
    assert r.status_code == 404
    err = r.json()["error"]
    assert err["code"] == "NOT_FOUND" and err["details"]["reason"] == "sin datos de fondo"
    if before is not None:
        assert len(replay_v5pf.calls) == before


def test_a_stock_is_not_a_fund(client, monkeypatch):
    monkeypatch.setattr(funds_mod._yahoo, "get_fund_data", lambda symbol: None)
    r = client.get("/v2/funds/WALMEX.MX")
    assert r.status_code == 404 and r.json()["error"]["details"]["reason"] == "sin datos de fondo"


def test_a_bad_symbol_is_400(client):
    assert client.get("/v2/funds/%3Cx%3E").status_code == 400


@pytest.mark.parametrize("url", ["/v2/funds/SPY", "/v2/funds/QQQ", "/v2/funds/IVVPESO.MX", "/v2/funds/VOO"])
def test_no_analyst_rating_or_target_reaches_fund_responses(client, url):
    body = client.get(url).json()
    assert not [k for k in keys(body) if FORBIDDEN.search(k)]
    assert not [t for t in strings(body) if "—" in t or "–" in t]


def test_the_provider_strips_rating_and_target_fields():
    frame = pd.DataFrame(
        {"Name": ["Apple Inc"], "Holding Percent": [0.07], "Firm": ["X"], "ToGrade": ["Buy"], "priceTarget": [300]},
        index=pd.Index(["AAPL"], name="Symbol"),
    )
    assert provider._holdings(frame) == [{"symbol": "AAPL", "name": "Apple Inc", "weight": 0.07}]
    assert provider._clean_dict({"technology": 0.3, "rating": "A", "Action": "up", "targetMean": 1}) == {"technology": 0.3}


def test_the_router_announces_funds():
    assert funds_router.CAPABILITIES == ["funds"]


def test_the_sic_map_has_source_and_date_for_every_entry():
    data = funds_mod.sic_map()
    assert data["map"]["IVVPESO.MX"]["target"] == "IVV"
    for entry in data["map"].values():
        assert entry["source"] and entry["asOf"] == "2026-10-01"
    assert "NAFTRAC.MX" in data["bmvWithoutData"]
