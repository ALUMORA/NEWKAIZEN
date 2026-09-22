"""Dividendos (suma de 12 meses y rendimiento) y calendario de eventos."""

from __future__ import annotations

import datetime as _dt

import pandas as pd
import pytest

from kaizen_api.domain import events as events_mod
from kaizen_api.domain import fundamentals as mod
from kaizen_api.errors import ApiError

AAPL_PRICE = 314.0  # cierre grabado, solo para leer el rendimiento con los ojos
FUNO_PRICE = 29.49


def test_ttm_is_the_sum_of_the_last_twelve_months(replay_b3a):
    data = mod.get_dividends("AAPL")
    assert data["currency"] == "USD"
    cutoff = (_dt.date(2026, 9, 22) - _dt.timedelta(days=365)).isoformat()
    recent = [row["amount"] for row in data["history"] if row["date"] > cutoff]
    assert data["ttm"] == pytest.approx(sum(recent), abs=1e-6)
    assert len(recent) == 4, "Apple paga trimestralmente"


def test_yield_is_ttm_over_price_as_a_fraction(replay_b3a):
    data = mod.get_dividends("AAPL")
    assert 0.0 < data["yield"] < 0.05
    info = mod._yahoo.get_info("AAPL")
    assert data["yield"] == pytest.approx(data["ttm"] / info["regularMarketPrice"], rel=1e-4)


def test_a_fibra_pays_in_pesos_and_yields_a_lot_more(replay_b3a):
    data = mod.get_dividends("FUNO11.MX")
    assert data["currency"] == "MXN"
    assert data["yield"] > 0.05
    assert data["history"][-1]["date"] <= "2026-09-22"
    assert all(row["amount"] > 0 for row in data["history"])


def test_history_is_sorted_and_capped(replay_b3a):
    data = mod.get_dividends("SPY")
    dates = [row["date"] for row in data["history"]]
    assert dates == sorted(dates)
    assert len(dates) <= 60
    assert data["as_of"] == dates[-1]


def test_without_history_nothing_is_invented(replay_b3a, monkeypatch):
    monkeypatch.setattr(mod._yahoo, "get_dividends", lambda symbol: None)
    data = mod.get_dividends("WALMEX.MX")
    assert data["history"] == []
    assert data["ttm"] is None
    assert data["yield"] is None
    assert data["notes"] == ["Yahoo no publica historia de dividendos para este símbolo."]


def test_a_company_that_stopped_paying_shows_zero_not_null(replay_b3a, monkeypatch):
    old = pd.Series(
        [1.5, 1.6],
        index=pd.to_datetime(["2015-03-02", "2015-09-01"]),
    )
    monkeypatch.setattr(mod._yahoo, "get_dividends", lambda symbol: old)
    data = mod.get_dividends("WALMEX.MX")
    assert data["ttm"] == 0.0
    assert data["yield"] == 0.0
    assert data["notes"] == ["No hubo pagos en los últimos 12 meses."]


def test_dividends_of_an_unknown_symbol_are_a_404(replay_b3a):
    with pytest.raises(ApiError) as excinfo:
        mod.get_dividends("ZZZNOTREAL")
    assert excinfo.value.status == 404


def test_events_carry_dates_types_and_currency(replay_b3a):
    data = events_mod.get_events(["AAPL", "WALMEX.MX", "FUNO11.MX"])
    kinds = {item["type"] for item in data["items"]}
    assert kinds <= {"earnings", "exDividend", "dividendPay"}
    assert "earnings" in kinds
    dates = [item["date"] for item in data["items"]]
    assert dates == sorted(dates)
    for item in data["items"]:
        assert item["amount"] is None, "Yahoo no publica el monto del dividendo que viene"
        if item["type"] == "earnings":
            assert item["currency"] is None
        else:
            assert item["currency"] in ("MXN", "USD")
    assert data["as_of"] == "2026-09-22", "el calendario vale al momento de leerlo"


def test_the_eps_estimate_only_hangs_from_a_future_report(replay_b3a):
    data = events_mod.get_events(["AAPL", "WALMEX.MX"])
    for item in data["items"]:
        if item["type"] != "earnings":
            continue
        if item["date"] < "2026-09-22":
            assert item["estimate"] is None, "el consenso es para el reporte que viene"
        else:
            assert item["estimate"] is not None and item["estimate"] > 0


def test_a_symbol_without_a_calendar_is_reported_not_faked(replay_b3a, monkeypatch):
    monkeypatch.setattr(events_mod._yahoo, "get_calendar", lambda symbol: {})
    monkeypatch.setattr(events_mod._yahoo, "get_info", lambda symbol: {"currency": "MXN"})
    data = events_mod.get_events(["WALMEX.MX"])
    assert data["items"] == []
    assert data["missing"] == ["WALMEX.MX"]
    assert data["notes"] == ["Sin fechas publicadas para: WALMEX.MX."]


@pytest.mark.parametrize(
    "raw,expected",
    [
        (_dt.date(2026, 10, 29), "2026-10-29"),
        (_dt.datetime(2026, 10, 29, 20, 30), "2026-10-29"),
        (1790000000, "2026-09-21"),
        (0, None),
        (None, None),
        ("no es fecha", None),
        ("2026-10-29T12:00:00Z", "2026-10-29"),
    ],
)
def test_calendar_dates_are_normalised(raw, expected):
    assert events_mod._as_date(raw) == expected
