"""scripts/run_replay_backend.py serves the legacy Handler from fixtures with the network blocked."""

from __future__ import annotations

import importlib.util
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from tests.replay import GOLDENS_DIR, compare, golden_name, load_golden, reset_backend_state

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "run_replay_backend.py"
ROUTES = {
    "/health": None,
    "/stock/AAPL": golden_name("get_stock", ["AAPL"], {}),
    "/chart/WALMEX.MX?period=1y&ccy=MXN": golden_name("get_chart", ["WALMEX.MX"], {"period": "1y", "ccy": "MXN"}),
    "/market": golden_name("get_market", [], {}),
}


def _load_script():
    spec = importlib.util.spec_from_file_location("run_replay_backend", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _get(url: str) -> tuple[int, dict]:
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read())


@pytest.fixture
def replay_server(replay_set):
    runner = _load_script()
    session, module = runner.start("backend", replay_set)
    try:
        reset_backend_state(module)
        server = runner.make_http_server(module, "127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        yield f"http://127.0.0.1:{server.server_address[1]}", session
        server.shutdown()
        server.server_close()
    finally:
        session.uninstall()


def test_replay_server_serves_sample_routes(replay_server):
    base, session = replay_server
    for route, golden_file in ROUTES.items():
        status, body = _get(base + route)
        assert status == 200, (route, body)
        if golden_file is None:
            assert body == {"status": "ok"}
            continue
        golden = load_golden(GOLDENS_DIR / golden_file)
        diffs = compare(body, golden["output"], volatile=golden["volatile_paths"])
        assert not diffs, (route, diffs)
    assert session.misses == []


def test_replay_server_reports_unrecorded_calls(replay_server):
    base, session = replay_server
    status, body = _get(base + "/stock/NOTRECORDED1")
    assert status == 500
    assert body["error"] == "ReplayMiss" and body["key"].startswith("yf:NOTRECORDED1:")
    session.misses.clear()
