"""Agenda de reportes y dividendos: pruebas de respuesta conocida de la spec, una por una.

La proyección de ingresos por dividendos se calcula en el navegador
(``src/features/agenda/lib/projection.js``, con sus pruebas de Vitest); aquí se prueba que lo que
manda el API (``dividendSummary``) alcanza para llegar a las cifras de la spec, con la misma
aritmética, y todo lo que decide el servidor.
"""

from __future__ import annotations

import datetime as _dt
import re

import pandas as pd
import pytest

from kaizen_api import schemas
from kaizen_api.domain import earnings_season as season_mod
from kaizen_api.domain import events as events_mod
from kaizen_api.routers import events as events_router
from tests.unit.v5pf.conftest import keys, strings

TODAY = _dt.date(2026, 10, 1)
FORBIDDEN = re.compile(r"(firm|tograde|fromgrade|^action$|rating|target)", re.IGNORECASE)


def series(points: list[tuple[str, float]], tz: str = "America/Mexico_City") -> pd.Series:
    index = pd.DatetimeIndex([pd.Timestamp(d, tz=tz) for d, _ in points], name="Date")
    return pd.Series([v for _, v in points], index=index, name="Dividends")


def quarterly(amount: float) -> pd.Series:
    return series([(f"{y}-{m:02d}-15", amount) for y in (2024, 2025, 2026) for m in (1, 4, 7, 10) if f"{y}-{m:02d}-15" <= "2026-09-30"])


def projected_year(quantity: float, row: dict, fx: float = 1.0, withholding: float = 0.10) -> tuple[float, float]:
    """La misma cuenta que hace el navegador: cantidad por último pagado por pago al año."""
    if row["lastPaidAmount"] is None:
        return 0.0, 0.0
    gross = quantity * row["lastPaidAmount"] * fx * len(row["paidMonths"])
    return round(gross, 2), round(gross * (1 - withholding), 2)


# ─── pruebas de la spec ──────────────────────────────────────────────────────


def test_100_titles_quarterly_050_project_200_gross_and_180_net():
    row = events_mod.summarize_dividends("ABC.MX", quarterly(0.50), "MXN", 1.0, TODAY)
    assert row["lastPaidAmount"] == 0.50 and row["frequency"] == "trimestral"
    gross, net = projected_year(100, row)
    assert (gross, net) == (200.0, 180.0)
    assert len(row["paidMonths"]) == 4  # 4 pagos de 50


def test_jan_apr_jul_oct_for_two_years_is_quarterly_in_those_months():
    dates = [_dt.date(y, m, 10) for y in (2024, 2025) for m in (1, 4, 7, 10)] + [_dt.date(2026, 1, 10), _dt.date(2026, 4, 10), _dt.date(2026, 7, 10)]
    frequency, months = events_mod.classify_frequency(dates, TODAY)
    assert frequency == "trimestral"
    assert months == [1, 4, 7, 10]


def test_a_company_without_dividends_shows_in_reports_with_zero_and_no_data(replay_v5pf, monkeypatch):
    monkeypatch.setattr(events_mod._yahoo, "get_dividends", lambda symbol: None)
    (row,) = events_mod.dividend_summary(["WALMEX.MX"], TODAY)
    assert row == {"symbol": "WALMEX.MX", "currency": "MXN", "lastPaidAmount": None, "lastPaidDate": None, "frequency": None, "paidMonths": []}
    assert projected_year(300, row) == (0.0, 0.0)
    # sigue apareciendo con su reporte
    reports = [i for i in events_mod.get_events(["WALMEX.MX"])["items"] if i["type"] == "earnings"]
    assert reports


def test_walmex_report_with_a_new_york_generic_hour_is_published_as_a_date_only(replay_v5pf, monkeypatch):
    stamp = pd.Timestamp("2026-10-27 00:00", tz="America/New_York")
    assert events_mod._as_date(stamp) == "2026-10-27"
    monkeypatch.setattr(events_mod._yahoo, "get_calendar", lambda symbol: {"Earnings Date": [stamp], "Earnings Average": 0.7129})
    upcoming = [i for i in events_mod.get_events(["WALMEX.MX"])["items"] if i["type"] == "earnings" and i["date"] >= "2026-09-22"]
    (item,) = upcoming
    assert item["date"] == "2026-10-27"
    assert len(item["date"]) == 10


def test_season_lists_the_one_that_failed_with_its_reason_and_sorts_the_rest(replay_v5pf, monkeypatch):
    real = season_mod._season_calendar
    monkeypatch.setattr(season_mod, "_season_calendar", lambda s: None if s == "AMXB.MX" else real(s))
    data = season_mod.get_season("mx", 90, _dt.date(2026, 9, 22))
    assert data["universeSize"] == 23
    failed = [m for m in data["missing"] if m["symbol"] == "AMXB.MX"]
    assert failed == [{"symbol": "AMXB.MX", "reason": season_mod.PROVIDER_ERROR}]
    assert all(m["reason"] for m in data["missing"])
    dates = [(e["date"], e["symbol"]) for e in data["events"]]
    assert dates == sorted(dates) and dates
    assert "AMXB.MX" not in {e["symbol"] for e in data["events"]}


def test_a_sic_dividend_of_025_usd_at_a_test_fix_of_18_is_450_mxn_per_title_per_payment():
    row = events_mod.summarize_dividends("AAPL.MX", quarterly(0.25), "USD", 1.0, TODAY)
    assert row["currency"] == "USD"
    per_payment = round(1 * row["lastPaidAmount"] * 18.00, 2)
    assert per_payment == 4.50


# ─── lo demás que decide el servidor ─────────────────────────────────────────


def test_events_add_the_estimate_range_and_keep_amount_null(client):
    r = client.get("/v2/events?symbols=NAFTRAC.MX,WALMEX.MX,FEMSAUBD.MX")
    assert r.status_code == 200
    body = schemas.EventsResponse.model_validate(r.json())
    walmex = [i for i in body.items if i.symbol == "WALMEX.MX" and i.type == "earnings" and i.date >= "2026-09-22"]
    assert walmex and walmex[0].estimate == 0.7129
    assert (walmex[0].estimateLow, walmex[0].estimateHigh) == (0.7, 0.734)
    assert all(i.amount is None for i in body.items)
    assert all(i.estimateLow is None and i.estimateHigh is None for i in body.items if i.type != "earnings")


def test_events_bring_a_dividend_summary_per_symbol_and_say_the_amount_is_the_last_paid(client):
    body = client.get("/v2/events?symbols=NAFTRAC.MX,WALMEX.MX,FEMSAUBD.MX").json()
    summary = {row["symbol"]: row for row in body["dividendSummary"]}
    assert set(summary) == {"NAFTRAC.MX", "WALMEX.MX", "FEMSAUBD.MX"}
    assert summary["FEMSAUBD.MX"]["frequency"] == "trimestral"
    assert summary["FEMSAUBD.MX"]["paidMonths"] == [1, 4, 7, 10]
    assert summary["WALMEX.MX"]["lastPaidDate"] <= "2026-09-22"
    assert events_mod.FUTURE_AMOUNT_NOTE in body["meta"]["notes"]
    assert events_mod.YAHOO_PERSONAL_USE in body["meta"]["notes"]


def test_season_response_is_a_curated_sample_with_its_size_and_the_yahoo_note(client):
    r = client.get("/v2/events/season?universe=mx&days=90")
    assert r.status_code == 200
    body = schemas.EventsSeasonResponse.model_validate(r.json())
    assert body.universe == "mx" and body.universeSize == 23
    assert any("Muestra curada de 23 emisoras" in n for n in body.meta.notes)
    assert events_mod.YAHOO_PERSONAL_USE in body.meta.notes
    assert all(e.kind == "earnings" and "2026-09-22" <= e.date <= "2026-12-21" for e in body.events)
    assert [m.symbol for m in body.missing] == ["FEMSAUBD.MX", "KOFUBL.MX"]
    for e in body.events:
        if e.estimateLow is not None and e.estimateHigh is not None:
            assert e.estimateLow <= e.estimateHigh


def test_season_window_cuts_the_events(client):
    wide = client.get("/v2/events/season?universe=us&days=90").json()
    narrow = client.get("/v2/events/season?universe=us&days=30").json()
    assert wide["universeSize"] == narrow["universeSize"] == 38
    assert len(narrow["events"]) < len(wide["events"])
    assert all(e["date"] <= "2026-10-22" for e in narrow["events"])


def test_season_calendar_is_cached_twelve_hours_per_symbol(replay_v5pf, monkeypatch):
    calls: list[str] = []
    real = events_mod._yahoo.get_calendar
    monkeypatch.setattr(season_mod._yahoo, "get_calendar", lambda s: calls.append(s) or real(s))
    season_mod.get_season("mx", 90, _dt.date(2026, 9, 22))
    season_mod.get_season("mx", 30, _dt.date(2026, 9, 22))
    assert len(calls) == 23
    assert season_mod.SEASON_TTL == 12 * 3600


@pytest.mark.parametrize(
    "url", ["/v2/events?symbols=NAFTRAC.MX,WALMEX.MX,FEMSAUBD.MX", "/v2/events/season?universe=mx&days=90", "/v2/events/season?universe=us&days=90"]
)
def test_no_analyst_rating_or_target_reaches_these_responses(client, url):
    body = client.get(url).json()
    assert not [k for k in keys(body) if FORBIDDEN.search(k)]
    assert not [t for t in strings(body) if "—" in t or "–" in t]


def test_the_router_announces_dividends_and_season():
    assert {"events", "events.dividends", "events.season"} <= set(events_router.CAPABILITIES)
    assert set(events_router.CAPABILITIES) <= set(schemas.KNOWN_CAPABILITIES)


def test_a_symbol_in_pence_scales_the_last_paid_amount():
    row = events_mod.summarize_dividends("LON.L", quarterly(55.0), "GBP", 100.0, TODAY)
    assert row["lastPaidAmount"] == pytest.approx(0.55)


@pytest.mark.parametrize(
    "months_per_year,expected",
    [((1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), "mensual"), ((5, 11), "semestral"), ((6,), "anual"), ((11, 12), "irregular")],
)
def test_frequency_classes(months_per_year, expected):
    dates = [_dt.date(y, m, 5) for y in (2024, 2025) for m in months_per_year if _dt.date(y, m, 5) > _dt.date(2024, 10, 1)]
    dates += [_dt.date(2026, m, 5) for m in months_per_year if m <= 9]
    frequency, _ = events_mod.classify_frequency(dates, TODAY)
    assert frequency == expected
