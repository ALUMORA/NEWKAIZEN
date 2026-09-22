"""Paridad del paquete ``kaizen_api`` con el backend viejo, golden por golden.

1. Función por función: cada golden de ``tests/goldens_legacy`` se reproduce llamando a la
   implementación en ``kaizen_api`` (``LEGACY_FUNCTIONS``) con la red bloqueada, el reloj congelado
   y los cachés limpios. La salida debe ser igual y las llamadas a proveedores, las mismas.
2. Por HTTP: con las rutas v1 montadas, ``GET`` de las rutas viejas devuelve el mismo JSON que el
   golden, con status 200 y ``Content-Type: application/json`` como el ``Handler`` viejo.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

import kaizen_api
from kaizen_api.main import create_app
from kaizen_api.routers.legacy_v1 import LEGACY_FUNCTIONS
from kaizen_api.settings import Settings
from tests.replay import (
    GOLDENS_DIR,
    call_captured,
    compare,
    golden_name,
    list_goldens,
    load_golden,
    normalize,
    replaying,
)

GOLDENS = list_goldens()


def test_every_golden_function_has_an_implementation():
    functions = {load_golden(p)["function"] for p in GOLDENS}
    assert functions, "no hay goldens"
    assert sorted(functions - set(LEGACY_FUNCTIONS)) == []


@pytest.mark.parametrize("golden_path", GOLDENS, ids=[p.stem for p in GOLDENS])
def test_function_parity(golden_path):
    golden = load_golden(golden_path)
    fn = LEGACY_FUNCTIONS[golden["function"]]
    with replaying(golden["fixture_set"]) as rp:
        kaizen_api.reset_state()
        with rp.trace() as keys:
            result = call_captured(fn, golden["args"], golden["kwargs"])
    assert rp.misses == [], f"llamadas sin grabar: {rp.misses}"
    if "raises" in golden:
        assert result.get("raises") == golden["raises"], result
    else:
        assert "output" in result, f"lanzó {result.get('raises')}"
        diffs = compare(result["output"], golden["output"], volatile=golden["volatile_paths"])
        assert not diffs, "\n".join(diffs)
    assert sorted(keys) == golden["fixtures_used"], "otras llamadas a proveedores que el legado"


# ─── HTTP ────────────────────────────────────────────────────────────────────

HTTP_CASES = [
    ("/stock/AAPL", ("get_stock", ["AAPL"], {})),
    ("/stock/WALMEX.MX", ("get_stock", ["WALMEX.MX"], {})),
    ("/chart/WALMEX.MX?period=1y&ccy=MXN", ("get_chart", ["WALMEX.MX"], {"period": "1y", "ccy": "MXN"})),
    ("/chart/AAPL?period=5y&ccy=MXN", ("get_chart", ["AAPL"], {"period": "5y", "ccy": "MXN"})),
    ("/chart/SPY?period=1mo", ("get_chart", ["SPY"], {"period": "1mo", "ccy": ""})),
    ("/chart/%5EMXX?period=1y&ccy=MXN", ("get_chart", ["^MXX"], {"period": "1y", "ccy": "MXN"})),
    ("/rf", ("get_rf", [], {})),
    ("/fx", ("get_fx", [], {})),
    ("/macro", ("get_macro", [], {})),
    ("/market", ("get_market", [], {})),
    ("/worldmap", ("get_worldmap", [], {})),
    ("/news/market", ("get_market_news", [], {})),
    ("/news/FUNO11.MX", ("get_news", ["FUNO11.MX"], {})),
    ("/dcf/AAPL.MX", ("get_dcf", ["AAPL.MX"], {})),
    ("/edgar/AAPL", ("get_edgar_financials", ["AAPL"], {})),
    ("/fibras", ("get_fibras", [], {})),
    ("/fibras/FUNO11.MX", ("get_fibras", ["FUNO11.MX"], {})),
    ("/magic", ("get_magic_formula", [], {})),
    ("/magic_one/AAPL", ("get_magic_one", ["AAPL"], {})),
    ("/magic_one/WALMEX.MX", ("get_magic_one", ["WALMEX.MX"], {})),
    ("/insiders/AAPL", ("get_insiders", ["AAPL"], {})),
    ("/momentum/CEMEXCPO.MX", ("get_momentum", ["CEMEXCPO.MX"], {})),
    ("/returns/ZZZNOTREAL", ("get_returns", ["ZZZNOTREAL"], {})),
]


@pytest.fixture(scope="module")
def legacy_client():
    app = create_app(Settings.from_env({"KAIZEN_LEGACY_ROUTES": "1"}))
    with TestClient(app) as client:
        yield client


def test_http_cases_cover_every_legacy_function():
    assert {spec[0] for _, spec in HTTP_CASES} == set(LEGACY_FUNCTIONS)


@pytest.mark.parametrize("route,spec", HTTP_CASES, ids=[r for r, _ in HTTP_CASES])
def test_http_parity(legacy_client, route, spec):
    golden = load_golden(GOLDENS_DIR / golden_name(*spec))
    with replaying(golden["fixture_set"]) as rp:
        kaizen_api.reset_state()
        response = legacy_client.get(route)
    assert rp.misses == [], f"llamadas sin grabar: {rp.misses}"
    assert response.status_code == 200, response.text[:300]
    assert response.headers["content-type"] == "application/json"
    diffs = compare(response.json(), golden["output"], volatile=golden["volatile_paths"])
    assert not diffs, "\n".join(diffs)


def test_http_body_is_byte_identical_to_legacy_serialization(legacy_client):
    """El cuerpo es ``json.dumps(result, default=str)``, igual que el Handler viejo (ensure_ascii incluido)."""
    golden = load_golden(GOLDENS_DIR / golden_name("get_stock", ["WALMEX.MX"], {}))
    with replaying(golden["fixture_set"]):
        kaizen_api.reset_state()
        direct = LEGACY_FUNCTIONS["get_stock"]("WALMEX.MX")
        kaizen_api.reset_state()
        response = legacy_client.get("/stock/WALMEX.MX")
    assert response.content == json.dumps(direct, default=str).encode()
    assert normalize(direct) == response.json()
