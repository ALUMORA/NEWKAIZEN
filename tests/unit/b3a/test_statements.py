"""Estados financieros: renglones reales, sin trimestres fabricados y con los signos correctos."""

from __future__ import annotations

import pandas as pd
import pytest

from kaizen_api.domain import statements as mod


def _row(payload: dict, row_id: str) -> list:
    for row in payload["rows"]:
        if row["id"] == row_id:
            return row["values"]
    raise AssertionError(f"falta el renglón {row_id}: {[r['id'] for r in payload['rows']]}")


def test_us_filer_comes_from_the_sec(replay_b3a):
    payload = mod.get_statements("AAPL", "annual")
    assert payload["source"] == "sec"
    assert payload["currency"] == "USD"
    assert [p["end"] for p in payload["periods"]][-1] == "2025-09-27"
    assert all(p["form"] == "10-K" for p in payload["periods"])
    assert all(p["fiscalQuarter"] is None for p in payload["periods"])
    # Cifras del 10-K de Apple del ejercicio 2025, tal como las publica su XBRL.
    assert _row(payload, "revenue")[-1] == 416_161_000_000
    assert _row(payload, "netIncome")[-1] == 112_010_000_000
    assert _row(payload, "eps")[-1] == 7.46


def test_cash_outflows_are_negative_and_free_cash_flow_is_the_difference(replay_b3a):
    payload = mod.get_statements("AAPL", "annual")
    ocf = _row(payload, "operatingCashFlow")
    capex = _row(payload, "capex")
    fcf = _row(payload, "freeCashFlow")
    dividends = _row(payload, "dividendsPaid")
    assert all(value < 0 for value in capex), "el capex es una salida de efectivo"
    assert all(value < 0 for value in dividends)
    for i, value in enumerate(fcf):
        assert value == pytest.approx(ocf[i] + capex[i], rel=1e-9)
    assert any("flujo operativo menos inversión" in note for note in payload["notes"])


def test_total_debt_adds_up_its_parts(replay_b3a):
    payload = mod.get_statements("AAPL", "annual")
    assert _row(payload, "totalDebt")[-1] == 98_657_000_000
    assert any("papel comercial" in note for note in payload["notes"])


def test_quarters_are_never_invented(replay_b3a):
    """El cierre anual de Apple (septiembre) NO puede aparecer como trimestre: no lo reporta."""
    quarterly = mod.get_statements("AAPL", "quarterly")
    ends = [p["end"] for p in quarterly["periods"]]
    annual_ends = {p["end"] for p in mod.get_statements("AAPL", "annual")["periods"]}
    assert ends, "sí hay trimestres reales"
    assert not (set(ends) & annual_ends), "un cierre anual no es un trimestre reportado"
    assert all(p["fiscalQuarter"] in (1, 2, 3) for p in quarterly["periods"])
    assert all(p["form"] == "10-Q" for p in quarterly["periods"])


def test_quarterly_cash_flow_gaps_are_left_empty_and_explained(replay_b3a):
    payload = mod.get_statements("AAPL", "quarterly")
    ocf = _row(payload, "operatingCashFlow")
    assert any(value is None for value in ocf), "en EE. UU. el flujo va acumulado en el año"
    assert any(value is not None for value in ocf)
    assert any("acumulado en el año" in note for note in payload["notes"])


def test_quarterly_values_are_real_quarters_not_the_year_over_four(replay_b3a):
    annual = mod.get_statements("AAPL", "annual")
    quarterly = mod.get_statements("AAPL", "quarterly")
    year = _row(annual, "revenue")[-1]
    quarters = [v for v in _row(quarterly, "revenue") if v is not None]
    assert not any(value == pytest.approx(year / 4, rel=1e-6) for value in quarters)
    assert max(quarters) > year / 4 * 1.2, "el trimestre navideño de Apple es muy superior al promedio"


def test_bmv_issuer_comes_from_yahoo(replay_b3a):
    payload = mod.get_statements("WALMEX.MX", "annual")
    assert payload["source"] == "yahoo"
    assert payload["currency"] == "MXN"
    assert _row(payload, "revenue")[-1] == 1_010_803_706_000
    assert all(p["form"] is None for p in payload["periods"])


def test_every_row_has_one_value_per_period(replay_b3a):
    for symbol, freq in (("AAPL", "annual"), ("AAPL", "quarterly"), ("WALMEX.MX", "annual"), ("FUNO11.MX", "quarterly")):
        payload = mod.get_statements(symbol, freq)
        for row in payload["rows"]:
            assert len(row["values"]) == len(payload["periods"]), f"{symbol} {freq} {row['id']}"
            assert any(value is not None for value in row["values"]), f"{symbol} {freq} {row['id']} vacío"


def test_an_etf_has_no_statements_and_says_so(replay_b3a):
    payload = mod.get_statements("SPY", "annual")
    assert payload["periods"] == []
    assert payload["rows"] == []
    assert payload["notes"] == ["No hay estados financieros publicados para este símbolo."]


def test_yahoo_statements_scale_minor_units(monkeypatch):
    """Una emisora de Londres reporta en peniques: los montos se dividen entre 100, la UPA no."""
    columns = [pd.Timestamp("2024-12-31"), pd.Timestamp("2025-12-31")]
    income = pd.DataFrame(
        [[1_000_000.0, 1_200_000.0], [55.0, 60.0]],
        index=["Total Revenue", "Diluted EPS"],
        columns=columns,
    )
    monkeypatch.setattr(mod, "get_companyfacts", lambda symbol: None)
    monkeypatch.setattr(
        mod.yahoo_fundamentals,
        "get_statement",
        lambda symbol, kind, freq="annual": income if kind == "income" else None,
    )
    payload = mod.get_statements("LON.L", "annual", financial_currency="GBp")
    assert payload["currency"] == "GBP"
    assert _row(payload, "revenue") == [10_000.0, 12_000.0]
    assert _row(payload, "eps") == [55.0, 60.0], "la UPA ya viene por acción en la unidad de cotización"


def test_periods_without_a_single_value_are_dropped(monkeypatch):
    columns = [pd.Timestamp("2023-12-31"), pd.Timestamp("2024-12-31")]
    income = pd.DataFrame([[None, 500.0]], index=["Total Revenue"], columns=columns)
    monkeypatch.setattr(
        mod.yahoo_fundamentals,
        "get_statement",
        lambda symbol, kind, freq="annual": income if kind == "income" else None,
    )
    payload = mod.get_statements("X.MX", "annual", financial_currency="MXN")
    assert [p["end"] for p in payload["periods"]] == ["2024-12-31"]
    assert _row(payload, "revenue") == [500.0]


def test_fiscal_year_of_an_early_january_close_is_the_previous_year():
    assert mod._period_fiscal_year("2026-01-03") == 2025
    assert mod._period_fiscal_year("2026-01-31") == 2026
    assert mod._period_fiscal_year("2025-09-27") == 2025
