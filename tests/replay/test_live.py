"""Canary against the real providers (skipped unless KAIZEN_LIVE=1).

Records a tiny set into a temp dir and replays it, to notice early when a yfinance upgrade
changes the shapes the recorder has to round-trip.
"""

from __future__ import annotations

import pandas as pd
import pytest
import requests

from tests.replay import recording, replaying
from tests.replay.store import FixtureStore


@pytest.mark.live
def test_live_record_then_replay(tmp_path):
    import yfinance as yf

    with recording("live", root=tmp_path, throttle=1.0) as rec:
        hist = yf.Ticker("WALMEX.MX").history(period="5d")
        info = yf.Ticker("AAPL").info
        dl = yf.download(["SPY", "EWW"], period="5d", interval="1d", progress=False, auto_adjust=True)
        csv = requests.get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10", timeout=8).text
    assert rec.stats["live"] == 4, rec.failures
    FixtureStore.forget()
    with replaying("live", root=tmp_path):
        pd.testing.assert_frame_equal(yf.Ticker("WALMEX.MX").history(period="5d"), hist, check_exact=True)
        assert yf.Ticker("AAPL").info == info
        pd.testing.assert_frame_equal(yf.download(["SPY", "EWW"], period="5d", progress=False), dl, check_exact=True)
        assert requests.get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10").text == csv
    assert str(hist.index.tz) == "America/Mexico_City"
    assert isinstance(dl.columns, pd.MultiIndex)
