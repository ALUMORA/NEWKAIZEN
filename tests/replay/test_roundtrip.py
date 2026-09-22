"""Round-trip and mechanics tests for the replay package. Fully offline."""

from __future__ import annotations

import json
import math
import socket
import types

import numpy as np
import pandas as pd
import pytest
import requests

from tests.replay import (
    NetworkBlocked,
    ReplayMiss,
    compare,
    decode,
    encode,
    find_volatile_paths,
    normalize,
    ordered_as_completed,
    recording,
    replaying,
)
from tests.replay.keys import download_key, http_key, normalize_call, yf_key
from tests.replay.proxies import decode_response, encode_response
from tests.replay.session import exception_from_record, exception_to_record
from tests.replay.store import FixtureStore


def rt(obj):
    """encode → strict JSON text → decode, exactly as fixtures are stored."""
    text = json.dumps(encode(obj), allow_nan=False)
    return decode(json.loads(text))


def assert_frame_identical(a: pd.DataFrame, b: pd.DataFrame) -> None:
    pd.testing.assert_frame_equal(a, b, check_exact=True, check_freq=True, check_flags=True)
    assert type(a.index) is type(b.index)
    assert type(a.columns) is type(b.columns)
    assert a.index.dtype == b.index.dtype
    assert a.columns.dtype == b.columns.dtype
    assert list(a.dtypes.astype(str)) == list(b.dtypes.astype(str))
    assert a.index.names == b.index.names
    assert a.columns.names == b.columns.names


# ─── pandas shapes the backend receives ──────────────────────────────────────


def _history(tz: str, unit: str = "ns", n: int = 6) -> pd.DataFrame:
    idx = pd.date_range("2026-08-03", periods=n, freq="7D", tz=tz, name="Date").as_unit(unit)
    idx = pd.DatetimeIndex(list(idx), name="Date")  # freq None, like yfinance output
    return pd.DataFrame(
        {
            "Open": np.linspace(100.1, 105.7, n),
            "High": np.linspace(101.3, 106.2, n),
            "Low": np.linspace(99.2, 104.4, n),
            "Close": [100.123456789, np.nan, 102.5, 103.25, 1e-12, 105.0][:n],
            "Volume": np.arange(n, dtype=np.int64) * 1_000_000,
            "Dividends": np.zeros(n),
            "Stock Splits": np.zeros(n),
        },
        index=idx,
    )


@pytest.mark.parametrize(
    ("tz", "unit"),
    [("America/New_York", "ns"), ("America/Mexico_City", "ns"), ("America/Mexico_City", "s"), ("UTC", "us")],
)
def test_history_frame_tz_aware(tz, unit):
    df = _history(tz, unit)
    out = rt(df)
    assert_frame_identical(df, out)
    assert str(out.index.tz) == tz
    assert out.index.unit == unit
    assert math.isnan(out["Close"].iloc[1])
    assert out["Close"].iloc[0] == 100.123456789  # exact float repr
    # the exact operation the legacy beta/FX code does
    naive = out["Close"].dropna().index.tz_localize(None).normalize()
    assert list(naive) == list(df["Close"].dropna().index.tz_localize(None).normalize())


def test_download_multiindex_columns():
    idx = pd.DatetimeIndex(pd.to_datetime(["2026-09-15", "2026-09-16", "2026-09-17"]), name="Date")
    cols = pd.MultiIndex.from_product([["Close", "High", "Volume"], ["^GSPC", "USDMXN=X"]], names=["Price", "Ticker"])
    data = np.array(
        [[6600.5, 18.41, 6610.0, 18.5, 3e9, 0.0], [np.nan, 18.39, np.nan, 18.45, np.nan, 0.0], [6650.25, np.nan, 6660, np.nan, 3.1e9, np.nan]]
    )
    df = pd.DataFrame(data, index=idx, columns=cols)
    out = rt(df)
    assert_frame_identical(df, out)
    # legacy access patterns
    assert "Close" in out.columns.get_level_values(0)
    pd.testing.assert_series_equal(out["Close"]["^GSPC"], df["Close"]["^GSPC"], check_exact=True)
    flat = out.copy()
    flat.columns = flat.columns.get_level_values(0)
    assert list(flat.columns) == list(df.columns.get_level_values(0))


def test_download_multiindex_unused_levels_preserved():
    cols = pd.MultiIndex.from_tuples([("Close", "A"), ("Close", "B"), ("Open", "A")], names=["Price", "Ticker"])
    df = pd.DataFrame([[1.0, 2.0, 3.0]], columns=cols)[[("Close", "A"), ("Close", "B")]]
    out = rt(df)
    assert_frame_identical(df, out)
    assert [list(level) for level in out.columns.levels] == [list(level) for level in df.columns.levels]


def test_financial_statement_frame():
    cols = pd.DatetimeIndex(pd.to_datetime(["2025-09-30", "2024-09-30", "2023-09-30", "2022-09-30"]))
    idx = pd.Index(["Total Revenue", "Net Income", "EBITDA", "Total Debt"])
    df = pd.DataFrame(
        [[4.16e11, 3.91e11, 3.83e11, np.nan], [1.12e11, 9.37e10, 9.7e10, 9.98e10], [np.nan] * 4, [None, 1.0, 2.0, 3.0]],
        index=idx,
        columns=cols,
    )
    out = rt(df)
    assert_frame_identical(df, out)
    assert out.loc["Total Revenue"].iloc[0] == 4.16e11
    assert "EBITDA" in out.index


def test_object_frame_with_mixed_values():
    df = pd.DataFrame(
        {
            "a": pd.Series([1, "x", None, 2.5, np.nan, pd.Timestamp("2026-01-01", tz="UTC")], dtype=object),
            "b": pd.Series(["s", None, "t", "u", "v", "w"], dtype="str"),
            "c": pd.Series([1, None, 3, 4, 5, 6], dtype="Int64"),
            "d": pd.Categorical(["x", "y", "x", "x", "y", "y"]),
            "e": [True, False, True, True, False, False],
            "f": pd.to_datetime(["2026-01-01", None, "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"]),
        }
    )
    out = rt(df)
    assert_frame_identical(df, out)
    assert out["a"].iloc[2] is None
    assert isinstance(out["a"].iloc[4], float) and math.isnan(out["a"].iloc[4])
    assert out["f"].isna().iloc[1]


def test_insider_like_frame_row_get():
    df = pd.DataFrame(
        {
            "Shares": np.array([1000, 2500], dtype=np.int64),
            "Value": [np.nan, 1.5e6],
            "Text": pd.Series(["Sale at price 230.00 per share.", "Stock Award(Grant)"], dtype="str"),
            "Insider": pd.Series(["COOK TIMOTHY D", "O'BRIEN DEIRDRE"], dtype="str"),
            "Start Date": pd.to_datetime(["2026-09-01", "2026-08-15"]),
        }
    )
    out = rt(df)
    assert_frame_identical(df, out)
    row = next(out.head(15).iterrows())[1]
    assert str(row.get("Start Date"))[:10] == "2026-09-01"
    assert (row.get("Value") or 0) != 0  # NaN is truthy, like upstream


def test_series_with_tz_index_and_name():
    s = _history("America/Mexico_City")["Close"]
    out = rt(s)
    pd.testing.assert_series_equal(s, out, check_exact=True, check_freq=True)
    assert out.name == "Close"
    assert out.index.dtype == s.index.dtype


@pytest.mark.parametrize(
    "df",
    [
        pd.DataFrame(),
        pd.DataFrame(columns=["Open", "Close"]),
        pd.DataFrame({"Close": pd.Series([], dtype="float64")}, index=pd.DatetimeIndex([], tz="America/New_York", name="Date")),
        pd.DataFrame(index=pd.Index(["a", "b"])),
    ],
    ids=["empty", "empty-with-columns", "empty-tz-index", "index-no-columns"],
)
def test_empty_frames(df):
    out = rt(df)
    assert_frame_identical(df, out)
    assert out.empty == df.empty


def test_range_index_and_datetime_freq():
    df = pd.DataFrame({"x": [1.0, 2.0, 3.0]})
    assert_frame_identical(df, rt(df))
    s = pd.Series([1.0, 2.0], index=pd.date_range("2026-01-01", periods=2, freq="D"))
    out = rt(s)
    pd.testing.assert_series_equal(s, out, check_freq=True)
    assert out.index.freqstr == "D"


def test_dict_with_numpy_scalars_and_specials():
    info = {
        "currentPrice": np.float64(245.5),
        "sharesOutstanding": np.int64(14_840_390_000),
        "isEsgPopulated": np.bool_(False),
        "trailingPE": float("nan"),
        "beta": float("inf"),
        "negInf": float("-inf"),
        "plain": 1.25,
        "big": 10**20,
        "none": None,
        "nested": {"list": [1, 2.5, "x", None], "tuple": (1, "a")},
        "ts": pd.Timestamp("2026-09-22 09:30", tz="America/New_York").as_unit("s"),
        "nat": pd.NaT,
        "np_dt": np.datetime64("2026-09-22T00:00:00", "s"),
    }
    out = rt(info)
    assert list(out) == list(info)  # key order preserved
    assert type(out["currentPrice"]) is np.float64 and out["currentPrice"] == 245.5
    assert type(out["sharesOutstanding"]) is np.int64 and out["sharesOutstanding"] == 14_840_390_000
    assert type(out["isEsgPopulated"]) is np.bool_
    assert math.isnan(out["trailingPE"]) and out["beta"] == math.inf and out["negInf"] == -math.inf
    assert out["big"] == 10**20 and out["none"] is None
    assert out["nested"] == {"list": [1, 2.5, "x", None], "tuple": (1, "a")}
    assert out["ts"] == info["ts"] and str(out["ts"].tz) == "America/New_York" and out["ts"].unit == "s"
    assert out["nat"] is pd.NaT
    assert out["np_dt"] == info["np_dt"] and out["np_dt"].dtype == info["np_dt"].dtype


def test_dict_with_non_string_keys():
    d = {pd.Timestamp("2025-09-30"): 1.0, 2: "b", ("a", 1): None}
    out = rt(d)
    assert out == d
    assert list(out) == list(d)


def test_news_list_roundtrip():
    news = [
        {
            "id": "abc",
            "content": {
                "title": "Apple beats estimates",
                "summary": "Record quarter",
                "pubDate": "2026-09-21T13:05:00Z",
                "canonicalUrl": {"url": "https://example.com/a"},
                "provider": {"displayName": "Reuters"},
                "thumbnail": None,
            },
        },
        {"title": "Old format", "link": "https://example.com/b", "providerPublishTime": 1790000000},
    ]
    assert rt(news) == news


def test_strict_json_output():
    text = json.dumps(encode({"x": float("nan"), "df": _history("UTC")}), allow_nan=False)
    assert "NaN" not in text


def test_decode_returns_fresh_objects():
    payload = json.loads(json.dumps(encode(_history("America/New_York"))))
    a = decode(payload)
    a.columns = [c.upper() for c in a.columns]
    a.iloc[0, 0] = -1
    b = decode(payload)
    assert "Close" in b.columns and b.iloc[0, 0] != -1


# ─── HTTP responses and exceptions ───────────────────────────────────────────


def _response(content: bytes, content_type: str, status: int = 200) -> requests.Response:
    r = requests.Response()
    r.status_code = status
    r.reason = "OK" if status == 200 else "Not Found"
    r.url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"
    r.headers["Content-Type"] = content_type
    r.headers["Content-Encoding"] = "gzip"
    r.headers["Set-Cookie"] = "secret=1"
    r._content = content
    r.encoding = requests.utils.get_encoding_from_headers(r.headers)
    return r


def test_response_text_roundtrip():
    body = b"observation_date,DGS10\n2026-09-18,4.12\n2026-09-19,.\n"
    r = _response(body, "text/csv; charset=utf-8")
    out = decode_response(json.loads(json.dumps(encode_response(r))))
    assert out.content == body and out.text == r.text and out.status_code == 200
    assert out.encoding == r.encoding and out.url == r.url
    assert "Content-Encoding" not in out.headers and "Set-Cookie" not in out.headers


def test_response_binary_and_json_and_errors():
    raw = bytes(range(256))
    out = decode_response(json.loads(json.dumps(encode_response(_response(raw, "application/octet-stream")))))
    assert out.content == raw
    js = decode_response(encode_response(_response(b'{"0": {"cik_str": 320193, "ticker": "AAPL"}}', "application/json")))
    assert js.json()["0"]["ticker"] == "AAPL"
    nf = decode_response(encode_response(_response(b"missing", "text/plain", 404)))
    assert nf.status_code == 404
    with pytest.raises(requests.HTTPError):
        nf.raise_for_status()


@pytest.mark.parametrize(
    "exc",
    [
        KeyError("Close"),
        ValueError("empty"),
        IndexError("single positional indexer is out-of-bounds"),
        requests.exceptions.ConnectionError("Max retries exceeded"),
        requests.exceptions.ReadTimeout("read timed out"),
    ],
)
def test_exception_roundtrip(exc):
    rebuilt = exception_from_record(json.loads(json.dumps(exception_to_record(exc))))
    assert isinstance(rebuilt, type(exc))
    assert str(rebuilt) == str(exc)


def test_exception_with_unimportable_class():
    rec = {"type": "nowhere.Missing", "args": ["x"], "str": "boom"}
    rebuilt = exception_from_record(rec)
    assert isinstance(rebuilt, Exception) and str(rebuilt) == "boom"


def test_yfinance_exception_roundtrip():
    from yfinance.exceptions import YFRateLimitError

    exc = YFRateLimitError()
    rebuilt = exception_from_record(exception_to_record(exc))
    assert isinstance(rebuilt, YFRateLimitError) and str(rebuilt) == str(exc)


# ─── keys ────────────────────────────────────────────────────────────────────


def test_history_key_drops_defaults_and_timeouts():
    from yfinance.scrapers.history import PriceHistory

    a = normalize_call(PriceHistory.history, (), {"period": "5d"}, skip_first=True)
    b = normalize_call(PriceHistory.history, (), {"period": "5d", "interval": "1d", "timeout": 30}, skip_first=True)
    c = normalize_call(PriceHistory.history, ("5d", "1wk"), {}, skip_first=True)
    assert yf_key("aapl", "history", a) == yf_key("AAPL", "history", b) == "yf:AAPL:history?period=5d"
    assert yf_key("AAPL", "history", c) == "yf:AAPL:history?interval=1wk&period=5d"


def test_download_key():
    import yfinance

    norm = normalize_call(
        yfinance.multi.download, (["^GSPC", "usdmxn=x"],), {"period": "5d", "interval": "1d", "progress": False, "auto_adjust": True}
    )
    norm.pop("tickers")
    assert download_key(["^GSPC", "usdmxn=x"], norm) == "yf.download:[^GSPC,USDMXN=X]?period=5d"
    assert download_key("SPY", {"period": "1y"}) == "yf.download:SPY?period=1y"


def test_http_key_sorts_and_drops_volatile_params():
    k1 = http_key("get", "https://Feeds.Finance.Yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US&_=123")
    k2 = http_key("GET", "https://feeds.finance.yahoo.com/rss/2.0/headline", params={"lang": "en-US", "s": "^GSPC", "region": "US"})
    assert k1 == k2 == "http:GET https://feeds.finance.yahoo.com/rss/2.0/headline?lang=en-US&region=US&s=%5EGSPC"
    assert http_key("POST", "https://x.test/a", body=b"{}").startswith("http:POST https://x.test/a #body=")


# ─── record → replay loop with fake upstreams (no network) ───────────────────


class _FakeFastInfo:
    last_price = 245.5
    market_cap = 3.6e12

    @property
    def shares(self):
        raise KeyError("shares")


class _FakeTicker:
    calls: list[str] = []

    def __init__(self, ticker, session=None):
        self.ticker = ticker.upper()
        self.session = session

    @property
    def info(self):
        _FakeTicker.calls.append(f"{self.ticker}.info")
        if self.ticker == "BAD":
            raise KeyError("currentTradingPeriod")
        return {"currentPrice": 245.5, "currency": "USD", "financialCurrency": "USD", "sector": "Technology"}

    @property
    def fast_info(self):
        return _FakeFastInfo()

    @property
    def news(self):
        return []

    def history(self, period="1mo", interval="1d", **kwargs):
        _FakeTicker.calls.append(f"{self.ticker}.history({period},{interval})")
        return _history("America/New_York")


def _fake_download(tickers, period="1mo", interval="1d", progress=True, auto_adjust=True):
    cols = pd.MultiIndex.from_product([["Close"], [tickers] if isinstance(tickers, str) else tickers], names=["Price", "Ticker"])
    return pd.DataFrame([[1.0] * len(cols)], columns=cols, index=pd.DatetimeIndex(["2026-09-21"], name="Date"))


def _fake_request(self, method, url, params=None, **kwargs):
    return _response(b"a,b\n1,2\n", "text/csv")


@pytest.fixture
def fake_upstreams(monkeypatch):
    import yfinance

    _FakeTicker.calls = []
    monkeypatch.setattr(yfinance, "Ticker", _FakeTicker)
    monkeypatch.setattr(yfinance, "download", _fake_download)
    monkeypatch.setattr(requests.Session, "request", _fake_request)
    yield
    FixtureStore.forget()


def test_record_then_replay_cycle(tmp_path, fake_upstreams):
    import yfinance as yf

    with recording("unit", root=tmp_path, throttle=0) as rec:
        t = yf.Ticker("aapl")
        live_hist = t.history(period="1y", interval="1wk")
        info = t.info
        fi = t.fast_info
        assert fi.last_price == 245.5 and fi["lastPrice"] == 245.5 and fi.get("marketCap") == 3.6e12
        assert getattr(fi, "regularMarketPrice", None) is None  # not a FastInfo property
        assert getattr(fi, "name", "default") == "default"
        with pytest.raises(KeyError):
            _ = fi.shares
        with pytest.raises(KeyError):
            _ = yf.Ticker("BAD").info
        assert yf.Ticker("BAD").news == []
        dl = yf.download(["SPY", "EWW"], period="5d", interval="1d", progress=False, auto_adjust=True)
        resp = requests.get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10", timeout=8)
        assert resp.text == "a,b\n1,2\n"
        # served from disk the second time: the fake is not called again
        n = len(_FakeTicker.calls)
        yf.Ticker("AAPL").history(period="1y", interval="1wk", timeout=99)
        assert len(_FakeTicker.calls) == n
    assert rec.stats["live"] >= 8
    assert "yf:BAD:info" in rec.failures and rec.failures["yf:BAD:news"] == "respuesta vacía"
    index = json.loads((tmp_path / "unit" / "index.json").read_text())
    assert index["frozen_at"] and "yf:AAPL:history?interval=1wk&period=1y" in index["entries"]

    _FakeTicker.calls = []
    with replaying("unit", root=tmp_path) as rp:
        t = yf.Ticker("AAPL")
        assert_frame_identical(t.history(period="1y", interval="1wk"), live_hist)
        assert t.info == info
        assert t.fast_info["lastPrice"] == 245.5
        with pytest.raises(KeyError):
            _ = yf.Ticker("BAD").info
        dl2 = yf.download(["SPY", "EWW"], period="5d", progress=False)
        assert_frame_identical(dl, dl2)
        assert requests.get("https://fred.stlouisfed.org/graph/fredgraph.csv", params={"id": "DGS10"}).text == "a,b\n1,2\n"
        with pytest.raises(ReplayMiss) as miss:
            _ = yf.Ticker("MSFT").info
        assert "yf:MSFT:info" in str(miss.value)
        # ReplayMiss is not an Exception: the backend's "except Exception" cannot swallow it
        with pytest.raises(ReplayMiss):
            try:
                yf.Ticker("MSFT").history(period="1d")
            except Exception:
                pytest.fail("ReplayMiss fue atrapado por except Exception")
    assert _FakeTicker.calls == []  # replay never touched the upstream
    assert rp.misses == ["yf:MSFT:info", "yf:MSFT:history?period=1d"]


def test_replay_freezes_time(tmp_path, fake_upstreams):
    import time

    import yfinance as yf

    with recording("clock", root=tmp_path, throttle=0):
        _ = yf.Ticker("AAPL").info
    frozen = json.loads((tmp_path / "clock" / "index.json").read_text())["frozen_at"]
    with replaying("clock", root=tmp_path):
        import datetime as dt

        assert dt.datetime.fromtimestamp(time.time(), dt.UTC).isoformat() == frozen
        t0 = time.time()
        time.sleep(5)  # skipped in replay
        assert time.time() == t0


def test_ordered_as_completed_is_submission_order():
    import concurrent.futures as cf
    import time

    def work(delay, tag):
        time.sleep(delay)
        return tag

    with cf.ThreadPoolExecutor(4) as ex:
        futs = {ex.submit(work, d, i): i for i, d in enumerate([0.2, 0.0, 0.1, 0.0])}
        assert [f.result() for f in ordered_as_completed(futs, timeout=5)] == [0, 1, 2, 3]
        slow = ex.submit(work, 1.0, "slow")
        with pytest.raises(cf.TimeoutError):
            list(ordered_as_completed([slow], timeout=0.05))


# ─── network guard ───────────────────────────────────────────────────────────


def test_network_guard_blocks_sockets_dns_and_curl(no_network):
    with pytest.raises(NetworkBlocked):
        socket.create_connection(("example.com", 80), timeout=1)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        with pytest.raises(NetworkBlocked):
            s.connect(("93.184.216.34", 80))
    finally:
        s.close()
    from curl_cffi import requests as curl_requests

    with pytest.raises(NetworkBlocked):
        curl_requests.get("https://query1.finance.yahoo.com/")
    del no_network[:]  # these violations were intentional


def test_network_guard_allows_loopback(no_network):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    try:
        c = socket.create_connection(srv.getsockname(), timeout=1)
        c.close()
    finally:
        srv.close()


# ─── golden helpers ──────────────────────────────────────────────────────────


def test_normalize_and_compare_with_volatile_paths():
    out = normalize({"news": [{"title": "a", "time": 1}, {"title": "b", "time": 2}], "rate": 0.1, "nan": float("nan")})
    assert out["nan"] == {"__nonfinite__": "nan"}
    # Nada es volátil por defecto: el replay congela reloj y datos.
    assert find_volatile_paths(out) == []
    other = {"news": [{"title": "a", "time": 9}, {"title": "b", "time": 8}], "rate": 0.1 * (1 + 1e-12), "nan": {"__nonfinite__": "nan"}}
    assert compare(other, out, volatile=["news[*].time"]) == []
    assert compare(other, out) != []
    assert compare({"rate": 0.1000001}, {"rate": 0.1})
    assert compare({"x": 1}, {"x": 1, "y": 2}) == ["y: falta en el resultado"]
    assert compare({"x": True}, {"x": 1}) != []
    # Un campo volátil que se vuelve null sí se reporta.
    assert compare({"news": [{"time": None}]}, {"news": [{"time": 1}]}, volatile=["news[*].time"]) != []


def test_unknown_types_fail_loudly():
    with pytest.raises(TypeError):
        encode(types.SimpleNamespace(a=1))
