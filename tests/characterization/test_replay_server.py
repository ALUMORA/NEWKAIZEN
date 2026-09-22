"""scripts/run_replay_backend.py sirve ``kaizen_api.main`` (ASGI, uvicorn real) desde fixtures, sin red."""

from __future__ import annotations

import importlib.util
import json
import urllib.error
import urllib.request
from pathlib import Path

import pytest

import kaizen_api
from kaizen_api.settings import configure
from tests.replay import GOLDENS_DIR, compare, golden_name, load_golden

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "run_replay_backend.py"
ROUTES = {
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
def replay_server(replay_set, monkeypatch):
    for var in ("KAIZEN_ENV", "AUTH_REQUIRED", "KAIZEN_LEGACY_ROUTES", "USERS", "SECRET_KEY"):
        monkeypatch.delenv(var, raising=False)
    configure(None)
    runner = _load_script()
    session, module = runner.start(runner.DEFAULT_MODULE, replay_set)
    try:
        kaizen_api.reset_state()
        module.__dict__.pop("app", None)  # una app nueva con el entorno limpio
        with runner.ServerThread(runner.asgi_app(module)) as base:
            yield base, session
    finally:
        session.uninstall()
        module.__dict__.pop("app", None)
        configure(None)


def test_replay_server_serves_sample_routes(replay_server):
    base, session = replay_server
    status, body = _get(base + "/health")
    assert status == 200 and body["status"] == "ok" and body["apiVersion"] == 2
    assert "legacy.v1" in body["capabilities"]
    for route, golden_file in ROUTES.items():
        status, body = _get(base + route)
        assert status == 200, (route, body)
        golden = load_golden(GOLDENS_DIR / golden_file)
        diffs = compare(body, golden["output"], volatile=golden["volatile_paths"])
        assert not diffs, (route, diffs)
    status, body = _get(base + "/v2/quotes?symbols=AAPL")
    assert status == 501 and body["error"]["code"] == "NOT_IMPLEMENTED"
    assert session.misses == []


def test_replay_server_reports_unrecorded_calls(replay_server):
    base, session = replay_server
    status, body = _get(base + "/stock/NOTRECORDED1")
    assert status == 500
    assert body["error"] == "ReplayMiss" and body["key"].startswith("yf:NOTRECORDED1:")
    session.misses.clear()
