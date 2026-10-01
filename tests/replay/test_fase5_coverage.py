"""Lo que la fase 5 le pide al replay, probado sin red con objetos falsos.

M5 extendió el replay en dos puntos: ``yfinance.screen`` (V5MK), que no pasa por ``requests`` sino
por la sesión curl_cffi de yfinance, y ``Ticker.funds_data`` (V5PF), que es un objeto perezoso y no
un dato. Aquí se graba y se reproduce TODO lo que usarán los streams: el calendario, los estimados,
la tenencia, las acciones en circulación, los splits, el interior de un fondo y las velas en 5m,
1h, 1wk y 1mo, y se revisa que al reproducir nunca se llame a la fuente.
"""

from __future__ import annotations

import datetime as _dt
import json

import numpy as np
import pandas as pd
import pytest
import requests

from tests.replay import ReplayMiss, recording, replaying
from tests.replay.keys import screen_key
from tests.replay.store import FixtureStore

CALLS: list[str] = []


class FakeNoFundData(Exception):
    """Como el YFDataException que lanza yfinance cuando el símbolo no es un fondo."""


def _bars(interval: str, n: int = 4) -> pd.DataFrame:
    freq = {"5m": "5min", "1h": "1h", "1wk": "7D", "1mo": "30D"}[interval]
    start = "2026-09-29 08:30" if interval in ("5m", "1h") else "2026-06-01"
    idx = pd.date_range(start, periods=n, freq=freq, tz="America/Mexico_City", name="Datetime")
    idx = pd.DatetimeIndex(list(idx), name="Datetime" if interval in ("5m", "1h") else "Date")
    return pd.DataFrame(
        {
            "Open": np.linspace(60.0, 61.5, n),
            "High": np.linspace(60.5, 62.0, n),
            "Low": np.linspace(59.5, 61.0, n),
            "Close": np.linspace(60.2, 61.7, n),
            "Volume": np.array([0, 1200, 3400, 560], dtype=np.int64)[:n],
            "Dividends": np.zeros(n),
            "Stock Splits": np.zeros(n),
        },
        index=idx,
    )


class FakeFundsData:
    def __init__(self, symbol: str):
        self.symbol = symbol

    def _check(self, what: str) -> None:
        CALLS.append(f"{self.symbol}.funds_data.{what}")
        if self.symbol != "SPY":
            raise FakeNoFundData(f"No Fund data found for {self.symbol}")

    def quote_type(self) -> str:
        self._check("quote_type")
        return "ETF"

    @property
    def description(self) -> str:
        self._check("description")
        return "Fondo que replica el S&P 500"

    @property
    def top_holdings(self) -> pd.DataFrame:
        self._check("top_holdings")
        return pd.DataFrame(
            {"Name": ["NVIDIA Corp", "Apple Inc", "Microsoft Corp"], "Holding Percent": [0.0808, 0.0703, 0.0569]},
            index=pd.Index(["NVDA", "AAPL", "MSFT"], name="Symbol"),
        )

    @property
    def sector_weightings(self) -> dict:
        self._check("sector_weightings")
        return {"technology": 0.3869, "financial_services": 0.1301, "healthcare": 0.0901}

    @property
    def asset_classes(self) -> dict:
        self._check("asset_classes")
        return {"cashPosition": 0.0011, "stockPosition": 0.9989, "bondPosition": 0.0, "otherPosition": 0.0}

    @property
    def fund_overview(self) -> dict:
        self._check("fund_overview")
        return {"categoryName": "Large Blend", "family": "State Street Investment Management", "legalType": "Exchange Traded Fund"}

    @property
    def fund_operations(self) -> pd.DataFrame:
        self._check("fund_operations")
        return pd.DataFrame(
            {"SPY": [0.000945, 0.03, 6.7e11], "Category Average": [0.0086, 0.48, 6.7e11]},
            index=pd.Index(["Annual Report Expense Ratio", "Annual Holdings Turnover", "Total Net Assets"], name="Attributes"),
        )

    @property
    def equity_holdings(self) -> pd.DataFrame:
        self._check("equity_holdings")
        return pd.DataFrame({"SPY": [0.04035, 0.2]}, index=pd.Index(["Price/Earnings", "Price/Book"], name="Average"))


class FakeTicker:
    def __init__(self, ticker, session=None):
        self.ticker = ticker.upper()
        self.session = session

    def _log(self, what: str) -> None:
        CALLS.append(f"{self.ticker}.{what}")

    @property
    def calendar(self) -> dict:
        self._log("calendar")
        return {
            "Dividend Date": _dt.date(2026, 11, 13),
            "Ex-Dividend Date": _dt.date(2026, 11, 10),
            "Earnings Date": [_dt.date(2026, 10, 29)],
            "Earnings High": 1.75,
            "Earnings Low": 1.5,
            "Earnings Average": 1.6,
            "Revenue Average": 1.02e11,
        }

    @property
    def earnings_history(self) -> pd.DataFrame:
        self._log("earnings_history")
        idx = pd.DatetimeIndex(pd.to_datetime(["2025-12-31", "2026-03-31", "2026-06-30"]), name="quarter")
        return pd.DataFrame(
            {"epsActual": [2.4, 1.65, 2.02], "epsEstimate": [2.35, 1.62, 1.89], "surprisePercent": [0.0213, 0.0185, 0.0688]},
            index=idx,
        )

    def _period_frame(self, what: str, cols: dict) -> pd.DataFrame:
        self._log(what)
        return pd.DataFrame(cols, index=pd.Index(["0q", "+1q", "0y", "+1y"], name="period"))

    @property
    def earnings_estimate(self) -> pd.DataFrame:
        return self._period_frame("earnings_estimate", {"avg": [1.6, 2.5, 7.3, 8.1], "numberOfAnalysts": [28, 25, 40, 38]})

    @property
    def revenue_estimate(self) -> pd.DataFrame:
        return self._period_frame("revenue_estimate", {"avg": [1.02e11, 1.3e11, 4.1e11, 4.4e11], "growth": [0.06, 0.07, 0.05, 0.07]})

    @property
    def eps_trend(self) -> pd.DataFrame:
        return self._period_frame("eps_trend", {"current": [1.6, 2.5, 7.3, 8.1], "7daysAgo": [1.59, 2.5, 7.3, 8.0]})

    @property
    def eps_revisions(self) -> pd.DataFrame:
        return self._period_frame("eps_revisions", {"upLast7days": [3, 1, 2, 1], "downLast30days": [0, 1, 0, 2]})

    def get_earnings_dates(self, limit=12, offset=0) -> pd.DataFrame:
        self._log(f"get_earnings_dates({limit})")
        idx = pd.DatetimeIndex(
            pd.to_datetime(["2026-10-29 16:30", "2026-07-30 16:30"]).tz_localize("America/New_York"), name="Earnings Date"
        )
        return pd.DataFrame(
            {"EPS Estimate": [1.6, 1.89], "Reported EPS": [np.nan, 2.02], "Surprise(%)": [np.nan, 6.74]}, index=idx
        ).head(limit)

    @property
    def major_holders(self) -> pd.DataFrame:
        self._log("major_holders")
        return pd.DataFrame(
            {"Value": [0.0171, 0.6241, 0.6349, 6345.0]},
            index=pd.Index(["insidersPercentHeld", "institutionsPercentHeld", "institutionsFloatPercentHeld", "institutionsCount"], name="Breakdown"),
        )

    def _holders(self, what: str) -> pd.DataFrame:
        self._log(what)
        return pd.DataFrame(
            {
                "Date Reported": pd.to_datetime(["2026-06-30", "2026-06-30"]),
                "Holder": ["Vanguard Group Inc", "Blackrock Inc."],
                "pctHeld": [0.0943, 0.0758],
                "Shares": [1.4e9, 1.1e9],
                "Value": [3.2e11, 2.6e11],
                "pctChange": [0.012, -0.004],
            }
        )

    @property
    def institutional_holders(self) -> pd.DataFrame:
        return self._holders("institutional_holders")

    @property
    def mutualfund_holders(self) -> pd.DataFrame:
        return self._holders("mutualfund_holders")

    def get_shares_full(self, start=None, end=None) -> pd.Series:
        self._log(f"get_shares_full({start})")
        idx = pd.DatetimeIndex(
            pd.to_datetime(["2023-10-02", "2024-10-01", "2026-09-29"]).tz_localize("America/New_York"), name="Date"
        )
        return pd.Series([16_526_300_160, 15_200_000_000, 14_594_180_000], index=idx, dtype=np.int64)

    @property
    def splits(self) -> pd.Series:
        self._log("splits")
        idx = pd.DatetimeIndex(pd.to_datetime(["2014-06-09", "2020-08-31"]).tz_localize("America/New_York"), name="Date")
        return pd.Series([7.0, 4.0], index=idx, name="Stock Splits")

    @property
    def funds_data(self) -> FakeFundsData:
        return FakeFundsData(self.ticker)

    def get_funds_data(self, proxy=None) -> FakeFundsData:
        return FakeFundsData(self.ticker)

    def history(self, period="1mo", interval="1d", **kwargs) -> pd.DataFrame:
        self._log(f"history({period},{interval})")
        return _bars(interval)


def fake_screen(query, offset=None, size=None, count=None, sortField=None, sortAsc=None, userId=None, userIdType=None, session=None):  # noqa: N803 - firma de yfinance
    label = query if isinstance(query, str) else json.dumps(query.to_dict(), sort_keys=True)
    CALLS.append(f"screen({label},{size or count})")
    n = size or count or 25
    quotes = [
        {"symbol": "WALMEX.MX", "regularMarketChangePercent": 1.60, "regularMarketVolume": 2.1e7},
        {"symbol": "AMXB.MX", "regularMarketChangePercent": -0.27, "regularMarketVolume": 3.4e7},
        {"symbol": "GFNORTEO.MX", "regularMarketChangePercent": 1.38, "regularMarketVolume": 9.0e6},
    ][:n]
    return {"count": len(quotes), "quotes": quotes, "start": offset or 0, "total": 3}


@pytest.fixture
def fase5_upstreams(monkeypatch):
    import yfinance

    CALLS.clear()
    monkeypatch.setattr(yfinance, "Ticker", FakeTicker)
    monkeypatch.setattr(yfinance, "screen", fake_screen)
    monkeypatch.setattr(requests.Session, "request", lambda *a, **kw: pytest.fail("no se esperaba HTTP"))
    yield
    FixtureStore.forget()


def _mx_query():
    from yfinance import EquityQuery

    return EquityQuery("and", [EquityQuery("eq", ["region", "mx"]), EquityQuery("gt", ["dayvolume", 10000])])


def _everything(yf) -> dict:
    """Cada llamada que hará la fase 5, en el orden en que la harían los proveedores."""
    aapl, spy, walmex = yf.Ticker("aapl"), yf.Ticker("SPY"), yf.Ticker("WALMEX.MX")
    fd = spy.funds_data
    out = {
        "calendar": aapl.calendar,
        "earnings_history": aapl.earnings_history,
        "earnings_estimate": aapl.earnings_estimate,
        "revenue_estimate": aapl.revenue_estimate,
        "eps_trend": aapl.eps_trend,
        "eps_revisions": aapl.eps_revisions,
        "earnings_dates": aapl.get_earnings_dates(limit=8),
        "major_holders": aapl.major_holders,
        "institutional_holders": aapl.institutional_holders,
        "mutualfund_holders": aapl.mutualfund_holders,
        "shares_full": aapl.get_shares_full(start="2023-10-01"),
        "splits": aapl.splits,
        "fd.quote_type": fd.quote_type(),
        "fd.description": fd.description,
        "fd.top_holdings": fd.top_holdings,
        "fd.sector_weightings": fd.sector_weightings,
        "fd.asset_classes": fd.asset_classes,
        "fd.fund_overview": fd.fund_overview,
        "fd.fund_operations": fd.fund_operations,
        "fd.equity_holdings": fd.equity_holdings,
        "fd.via_method": spy.get_funds_data().top_holdings,
        "screen.day_gainers": yf.screen("day_gainers", count=25),
        "screen.mx": yf.screen(_mx_query(), size=50, sortField="percentchange", sortAsc=False),
    }
    for interval, period in (("5m", "5d"), ("1h", "1mo"), ("1wk", "5y"), ("1mo", "max")):
        out[f"history.{interval}"] = walmex.history(period=period, interval=interval, auto_adjust=False)
    return out


def _same(a, b) -> None:
    if isinstance(a, pd.DataFrame):
        pd.testing.assert_frame_equal(a, b, check_exact=True)
        assert str(a.index.dtype) == str(b.index.dtype)
    elif isinstance(a, pd.Series):
        pd.testing.assert_series_equal(a, b, check_exact=True)
        assert str(a.index.dtype) == str(b.index.dtype)
    else:
        assert a == b


def test_everything_phase5_uses_records_and_replays_offline(tmp_path, fase5_upstreams):
    import yfinance as yf

    with recording("fase5", root=tmp_path, throttle=0) as rec:
        live = _everything(yf)
    assert not rec.failures, rec.failures
    entries = json.loads((tmp_path / "fase5" / "index.json").read_text())["entries"]
    for key in (
        "yf:AAPL:calendar",
        "yf:AAPL:get_earnings_dates?limit=8",
        "yf:AAPL:get_shares_full?start=2023-10-01",
        "yf:SPY:funds_data.top_holdings",
        "yf:SPY:funds_data.sector_weightings",
        "yf:SPY:funds_data.quote_type",
        "yf.screen:day_gainers?count=25",
        "yf:WALMEX.MX:history?auto_adjust=false&interval=5m&period=5d",
        "yf:WALMEX.MX:history?auto_adjust=false&interval=1mo&period=max",
    ):
        assert key in entries, f"{key} no quedó grabada"
    assert any(k.startswith('yf.screen:EquityQuery{"operands":') for k in entries)

    CALLS.clear()
    with replaying("fase5", root=tmp_path) as rp:
        replayed = _everything(yf)
    assert CALLS == [], f"el replay llamó a la fuente: {CALLS}"
    assert not rp.misses
    assert set(replayed) == set(live)
    for name in live:
        _same(live[name], replayed[name])
    # lo que los streams leen de esas piezas sobrevive tal cual
    assert replayed["calendar"]["Earnings Date"] == [_dt.date(2026, 10, 29)]
    assert str(replayed["history.5m"].index.tz) == "America/Mexico_City"
    assert list(replayed["history.5m"].columns[:5]) == ["Open", "High", "Low", "Close", "Volume"]
    assert replayed["history.5m"]["Volume"].iloc[0] == 0
    assert str(replayed["shares_full"].index.tz) == "America/New_York"
    assert replayed["splits"].index[1].strftime("%Y-%m-%d") == "2020-08-31"
    assert replayed["fd.top_holdings"].loc["NVDA", "Holding Percent"] == 0.0808
    assert [q["symbol"] for q in replayed["screen.mx"]["quotes"]] == ["WALMEX.MX", "AMXB.MX", "GFNORTEO.MX"]


def test_a_symbol_without_fund_data_replays_the_same_error(tmp_path, fase5_upstreams):
    import yfinance as yf

    with recording("sinfondo", root=tmp_path, throttle=0) as rec:
        with pytest.raises(FakeNoFundData):
            _ = yf.Ticker("NAFTRAC.MX").funds_data.top_holdings
    assert "yf:NAFTRAC.MX:funds_data.top_holdings" in rec.failures

    CALLS.clear()
    with replaying("sinfondo", root=tmp_path):
        with pytest.raises(FakeNoFundData, match="No Fund data found for NAFTRAC.MX"):
            _ = yf.Ticker("NAFTRAC.MX").funds_data.top_holdings
        with pytest.raises(AttributeError):
            _ = yf.Ticker("NAFTRAC.MX").funds_data.no_existe
    assert CALLS == []


def test_an_unrecorded_screen_is_a_miss_and_never_reaches_yahoo(tmp_path, fase5_upstreams):
    import yfinance as yf

    with recording("screens", root=tmp_path, throttle=0):
        yf.screen("day_gainers", count=25)
    CALLS.clear()
    with replaying("screens", root=tmp_path) as rp:
        assert yf.screen("day_gainers", count=25)["count"] == 3
        with pytest.raises(ReplayMiss):
            yf.screen("day_losers", count=25)
        with pytest.raises(ReplayMiss):
            yf.screen(_mx_query(), size=50)
    assert CALLS == []
    assert rp.misses[0] == "yf.screen:day_losers?count=25"


def test_screen_keys_are_readable_and_ignore_the_session():
    from yfinance import EquityQuery

    assert screen_key("day_gainers", {"count": 25}) == "yf.screen:day_gainers?count=25"
    q1 = EquityQuery("and", [EquityQuery("eq", ["region", "mx"]), EquityQuery("gt", ["dayvolume", 10000])])
    q2 = EquityQuery("and", [EquityQuery("eq", ["region", "mx"]), EquityQuery("gt", ["dayvolume", 10000])])
    q3 = EquityQuery("and", [EquityQuery("eq", ["region", "mx"]), EquityQuery("gt", ["dayvolume", 50000])])
    assert screen_key(q1, {"size": 50}) == screen_key(q2, {"size": 50})
    assert screen_key(q1, {"size": 50}) != screen_key(q3, {"size": 50})
    assert screen_key(q1, {}).startswith('yf.screen:EquityQuery{"operands":[{"operands":["region","mx"],"operator":"EQ"}')


def test_screen_is_restored_after_the_session(tmp_path, fase5_upstreams):
    import yfinance as yf

    before = yf.screen
    with recording("restore", root=tmp_path, throttle=0):
        assert yf.screen is not before
    assert yf.screen is before
