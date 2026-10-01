"""Las validaciones que M5 dejó en los routers de la fase 5, probadas como funciones.

Las pruebas de contrato las cubren por HTTP; aquí van los bordes que dependen de "hoy" (con la
fecha explícita, como pide la spec) y las tablas que los streams heredan.
"""

from __future__ import annotations

import datetime as _dt
from typing import get_args

import pytest

from kaizen_api import schemas
from kaizen_api.errors import ApiError
from kaizen_api.routers import business, company, curves, economy, events, fxdesk, ohlc

TODAY = _dt.date(2026, 10, 1)


def _status(exc: ApiError) -> tuple[int, str]:
    return exc.status, exc.code


def test_forward_tenors_default_dedupe_and_sort():
    assert fxdesk.check_forward_params(None, None, today=TODAY) == [30, 91, 182, 365]
    assert fxdesk.check_forward_params("365,30,30,1", None, today=TODAY) == [1, 30, 365]


@pytest.mark.parametrize("days", ["0", "366", "30,0", "9999"])
def test_forward_tenor_out_of_range_is_400(days):
    with pytest.raises(ApiError) as err:
        fxdesk.check_forward_params(days, None, today=TODAY)
    assert _status(err.value) == (400, "INVALID_PARAM")
    assert err.value.details == {"fields": [{"field": "query.days", "type": "out_of_range"}]}


def test_forward_date_becomes_days_from_today():
    assert fxdesk.check_forward_params(None, "2026-12-30", today=TODAY) == [90]
    assert fxdesk.check_forward_params(None, "2026-10-02", today=TODAY) == [1]
    assert fxdesk.check_forward_params(None, "2027-10-01", today=TODAY) == [365]


@pytest.mark.parametrize("date", ["2026-10-01", "2026-09-30", "2027-10-02"])
def test_forward_date_out_of_range_is_400(date):
    with pytest.raises(ApiError) as err:
        fxdesk.check_forward_params(None, date, today=TODAY)
    assert _status(err.value) == (400, "INVALID_PARAM")


def test_forward_days_and_date_together_is_422():
    with pytest.raises(ApiError) as err:
        fxdesk.check_forward_params("30", "2026-12-30", today=TODAY)
    assert _status(err.value) == (422, "VALIDATION_ERROR")


def test_fix_table_allows_three_years_and_not_more():
    fxdesk.check_fix_table_params("2023-10-01", "2026-09-30")
    with pytest.raises(ApiError) as err:
        fxdesk.check_fix_table_params("2023-01-01", "2026-09-30")
    assert _status(err.value) == (400, "INVALID_PARAM")


def test_calendar_allows_ninety_days_and_not_more():
    assert economy.check_calendar_params("2026-10-01", "2026-12-30", "us,mx") == ["mx", "us"]
    with pytest.raises(ApiError) as err:
        economy.check_calendar_params("2026-10-01", "2026-12-31", "mx")
    assert _status(err.value) == (400, "INVALID_PARAM")


def test_every_ohlc_interval_has_its_ranges_and_only_known_ones():
    assert set(ohlc.VALID_RANGES) == set(get_args(schemas.OhlcInterval))
    for ranges in ohlc.VALID_RANGES.values():
        assert ranges <= set(get_args(schemas.OhlcRange))
    ohlc.check_ohlc_params("5d", "5m")
    ohlc.check_ohlc_params("1y", "1h")
    with pytest.raises(ApiError) as err:
        ohlc.check_ohlc_params("1y", "5m")
    assert _status(err.value) == (400, "INVALID_PARAM")
    assert "1d, 5d, 1mo" in err.value.message


def test_compare_and_forms_are_normalized():
    assert curves.parse_compare("1y,1w,1y") == ["1w", "1y"]
    assert curves.parse_compare(None) == []
    assert company.parse_forms("10-k, 8-K,sc  13d") == ["10-K", "8-K", "SC 13D"]
    with pytest.raises(ApiError):
        company.parse_forms("S-1")


def test_messages_have_no_long_dashes():
    for module in (fxdesk, economy, company, ohlc, curves, business, events):
        source = open(module.__file__, encoding="utf-8").read()
        assert "—" not in source and "–" not in source, module.__name__


def test_shares_start_takes_today_explicitly():
    assert company.check_shares_start("2026-10-01", today=TODAY) == TODAY
    assert company.check_shares_start(None, today=TODAY) is None
    with pytest.raises(ApiError) as err:
        company.check_shares_start("2026-10-02", today=TODAY)
    assert _status(err.value) == (400, "INVALID_PARAM")
    assert err.value.details == {"fields": [{"field": "query.start", "type": "out_of_range"}]}


def test_fix_date_before_first_fix_is_400_and_bad_dates_are_422():
    assert fxdesk.check_fix_date("1991-11-12") == _dt.date(1991, 11, 12)
    with pytest.raises(ApiError) as err:
        fxdesk.check_fix_date("1991-11-11")
    assert _status(err.value) == (400, "INVALID_PARAM")
    with pytest.raises(ApiError) as err:
        fxdesk.check_fix_date("2026-02-30")
    assert _status(err.value) == (422, "VALIDATION_ERROR")
    with pytest.raises(ApiError) as err:
        fxdesk.check_fix_table_params("2026-09-30", "2026-09-01")
    assert _status(err.value) == (422, "VALIDATION_ERROR")


def test_monitor_years_only_known_values():
    for years in fxdesk.MONITOR_YEARS:
        fxdesk.check_monitor_params(years)
    with pytest.raises(ApiError) as err:
        fxdesk.check_monitor_params(2)
    assert _status(err.value) == (422, "VALIDATION_ERROR")


def test_calendar_dates_out_of_order_are_422_and_countries_dedupe():
    with pytest.raises(ApiError) as err:
        economy.check_calendar_params("2026-10-31", "2026-10-01", "mx")
    assert _status(err.value) == (422, "VALIDATION_ERROR")
    assert economy.check_calendar_params(None, None, "mx,mx") == ["mx"]


def test_world_countries_and_indicators_are_normalized():
    assert economy.parse_world("mex,usa,MEX", "debt,gdpUsd") == (["MEX", "USA"], ["gdpUsd", "debt"])


def test_update_factor_months_in_order_and_credit_years():
    business.check_update_factor_params("2025-01", "2026-08")
    business.check_update_factor_params("2026-08", "2026-08")
    with pytest.raises(ApiError) as err:
        business.check_update_factor_params("2026-09", "2026-08")
    assert _status(err.value) == (422, "VALIDATION_ERROR")
    business.check_credit_years(3)
    business.check_credit_years(5)
    with pytest.raises(ApiError):
        business.check_credit_years(4)


def test_season_days_only_known_values():
    for days in (30, 60, 90):
        events.check_season_days(days)
    with pytest.raises(ApiError) as err:
        events.check_season_days(45)
    assert _status(err.value) == (422, "VALIDATION_ERROR")
