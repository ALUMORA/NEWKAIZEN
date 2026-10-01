"""Contrato v2: cada ruta del spec está registrada, valida sus parámetros, declara su modelo y,
mientras no esté implementada, responde 501 con el cuerpo de error del contrato.

Este archivo está congelado bajo O y se ajusta solo: en cuanto un stream de fase 2 implementa su
ruta (borra el ``@stub`` de su función), la prueba del 501 deja de exigírselo y pasa a exigir lo que
sí aplica, que su router anuncie LA capacidad de esa ruta, la de la quinta columna del spec. Así
nadie tiene que abrir un archivo que no es suyo el día que implementa algo, y la prueba nunca llama
a una ruta ya implementada, que saldría a los proveedores.
"""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

import pytest
from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient
from pydantic import ValidationError

from kaizen_api import routers as routers_pkg
from kaizen_api import schemas
from kaizen_api.main import create_app
from kaizen_api.provenance import meta
from kaizen_api.settings import Settings

DOCS = Path(__file__).resolve().parents[2] / "docs" / "api-v2.md"

# (método, ruta, modelo, una URL válida de ejemplo, capacidades que entrega esa ruta).
# La quinta columna es lo que el router tiene que anunciar en ``CAPABILITIES`` cuando la ruta deja de
# ser stub; con varias, basta una (una valuación puede llegar primero con múltiplos y después con DCF).
SPEC = [
    ("GET", "/health", schemas.HealthResponse, None, ()),
    ("POST", "/auth/login", schemas.LoginResponse, None, ("auth",)),
    ("GET", "/auth/me", schemas.MeResponse, None, ("auth",)),
    ("GET", "/v2/quotes", schemas.QuotesResponse, "/v2/quotes?symbols=WALMEX.MX,aapl", ("quotes",)),
    ("GET", "/v2/search", schemas.SearchResponse, "/v2/search?q=walmart&limit=5", ("search",)),
    (
        "GET",
        "/v2/history/{symbol}",
        schemas.HistoryResponse,
        "/v2/history/%5EMXX?range=5y&interval=1wk&ccy=MXN",
        ("history",),
    ),
    (
        "GET",
        "/v2/panel",
        schemas.PanelResponse,
        "/v2/panel?symbols=WALMEX.MX,AAPL&range=1y&interval=1d&ccy=MXN",
        ("panel",),
    ),
    ("GET", "/v2/fx", schemas.FxResponse, "/v2/fx?pair=USDMXN", ("fx",)),
    (
        "GET",
        "/v2/fx/history",
        schemas.FxHistoryResponse,
        "/v2/fx/history?pair=USDMXN&start=2026-01-02&end=2026-09-22",
        ("fx.history",),
    ),
    ("GET", "/v2/rates/mx", schemas.MxRatesResponse, "/v2/rates/mx", ("rates.mx",)),
    (
        "GET",
        "/v2/rates/rf",
        schemas.RfSeriesResponse,
        "/v2/rates/rf?start=2025-01-01&end=2026-09-22&tenorDays=28",
        ("rf.series",),
    ),
    ("GET", "/v2/rates/mx/inpc", schemas.InpcResponse, "/v2/rates/mx/inpc?start=2024-01-01", ("rates.inpc",)),
    ("GET", "/v2/macro/us", schemas.UsMacroResponse, "/v2/macro/us", ("macro.us",)),
    ("GET", "/v2/markets/overview", schemas.MarketsOverviewResponse, "/v2/markets/overview", ("markets.overview",)),
    ("GET", "/v2/markets/world", schemas.WorldResponse, "/v2/markets/world", ("markets.world",)),
    ("GET", "/v2/news", schemas.NewsResponse, "/v2/news?symbol=WALMEX.MX&lang=es&limit=10", ("news",)),
    ("GET", "/v2/events", schemas.EventsResponse, "/v2/events?symbols=AAPL,WALMEX.MX", ("events",)),
    ("GET", "/v2/instrument/{symbol}", schemas.InstrumentResponse, "/v2/instrument/AAPL.MX", ("instrument",)),
    (
        "GET",
        "/v2/instrument/{symbol}/statements",
        schemas.StatementsResponse,
        "/v2/instrument/AAPL/statements?freq=quarterly",
        ("statements.real",),
    ),
    (
        "GET",
        "/v2/instrument/{symbol}/dividends",
        schemas.DividendsResponse,
        "/v2/instrument/FUNO11.MX/dividends",
        ("dividends",),
    ),
    (
        "GET",
        "/v2/valuation/{symbol}",
        schemas.ValuationResponse,
        "/v2/valuation/WALMEX.MX?erp=0.055&crp=0.02&terminalGrowth=0.03&years=10&growth=0.08",
        ("valuation.multiples", "valuation.dcf"),
    ),
    ("GET", "/v2/momentum/{symbol}", schemas.MomentumResponse, "/v2/momentum/CEMEXCPO.MX", ("momentum",)),
    (
        "GET",
        "/v2/screeners/factors",
        schemas.FactorsResponse,
        "/v2/screeners/factors?universe=custom&symbols=AAPL,MSFT",
        ("screeners.factors",),
    ),
    ("GET", "/v2/screeners/magic", schemas.MagicResponse, "/v2/screeners/magic?universe=mx", ("screeners.magic",)),
    (
        "GET",
        "/v2/screeners/fibras",
        schemas.FibrasResponse,
        "/v2/screeners/fibras?extra=FMTY14.MX",
        ("screeners.fibras",),
    ),
    ("GET", "/v2/insiders/{symbol}", schemas.InsidersResponse, "/v2/insiders/AAPL", ("insiders",)),
    ("GET", "/v2/assumptions", schemas.AssumptionsResponse, "/v2/assumptions", ("assumptions",)),
    # fase 5 (M5): todas nacen en @stub; cada stream las implementa en su router
    ("GET", "/v2/curves", schemas.CurvesResponse, "/v2/curves?country=mx&compare=1m,1y", ("curves",)),
    ("GET", "/v2/curves/spreads", schemas.CurveSpreadsResponse, "/v2/curves/spreads?history=5y", ("curves",)),
    ("GET", "/v2/money-market", schemas.MoneyMarketResponse, "/v2/money-market", ("moneyMarket",)),
    ("GET", "/v2/expectations", schemas.ExpectationsResponse, "/v2/expectations", ("expectations",)),
    ("GET", "/v2/fxdesk/monitor", schemas.FxMonitorResponse, "/v2/fxdesk/monitor?years=5", ("fxdesk",)),
    ("GET", "/v2/fxdesk/crosses", schemas.FxCrossesResponse, "/v2/fxdesk/crosses", ("fxdesk.crosses",)),
    ("GET", "/v2/fxdesk/fix", schemas.FixLookupResponse, "/v2/fxdesk/fix?date=2026-09-30&rule=dof", ("fxdesk.fix",)),
    (
        "GET",
        "/v2/fxdesk/fix-table",
        schemas.FixTableResponse,
        "/v2/fxdesk/fix-table?start=2026-01-01&end=2026-09-30&rule=fecha&monthEnd=true",
        ("fxdesk.fix",),
    ),
    (
        "GET",
        "/v2/fxdesk/forward",
        schemas.FxForwardResponse,
        "/v2/fxdesk/forward?days=30,91,182,365&mxn=tiie&usd=ust",
        ("fxdesk.forward",),
    ),
    (
        "GET",
        "/v2/calendar/economic",
        schemas.EconomicCalendarResponse,
        "/v2/calendar/economic?start=2026-10-01&end=2026-10-31&country=mx,us",
        ("calendar.economic",),
    ),
    (
        "GET",
        "/v2/macro/indicators",
        schemas.MacroIndicatorsResponse,
        "/v2/macro/indicators?country=us&years=10",
        ("macro.indicators",),
    ),
    (
        "GET",
        "/v2/macro/world",
        schemas.MacroWorldResponse,
        "/v2/macro/world?countries=MEX,USA,BRA&indicators=gdpUsd,inflation",
        ("macro.world",),
    ),
    ("GET", "/v2/events/season", schemas.EventsSeasonResponse, "/v2/events/season?universe=mx&days=60", ("events.season",)),
    ("GET", "/v2/earnings/{symbol}", schemas.EarningsResponse, "/v2/earnings/AAPL", ("earnings",)),
    ("GET", "/v2/holders/{symbol}", schemas.HoldersResponse, "/v2/holders/WALMEX.MX", ("holders",)),
    ("GET", "/v2/shares/{symbol}", schemas.SharesResponse, "/v2/shares/AAPL?start=2023-10-01", ("shares",)),
    ("GET", "/v2/filings/{symbol}", schemas.FilingsResponse, "/v2/filings/AAPL?forms=10-K,8-K&limit=10", ("filings",)),
    ("GET", "/v2/ohlc/{symbol}", schemas.OhlcResponse, "/v2/ohlc/WALMEX.MX?range=5d&interval=5m&compare=%5EMXX", ("ohlc",)),
    ("GET", "/v2/movers", schemas.MoversResponse, "/v2/movers?market=us&kind=losers&limit=10", ("movers",)),
    ("GET", "/v2/breadth", schemas.BreadthResponse, "/v2/breadth?market=mx", ("breadth",)),
    ("GET", "/v2/sectors", schemas.SectorsResponse, "/v2/sectors?market=us", ("sectors",)),
    ("GET", "/v2/funds/{symbol}", schemas.FundResponse, "/v2/funds/SPY", ("funds",)),
    ("GET", "/v2/reference/mx", schemas.ReferenceMxResponse, "/v2/reference/mx", ("reference.mx",)),
    (
        "GET",
        "/v2/reference/mx/update-factor",
        schemas.UpdateFactorResponse,
        "/v2/reference/mx/update-factor?from=2025-01&to=2026-08",
        ("reference.mx",),
    ),
    ("GET", "/v2/business/industries", schemas.IndustriesResponse, "/v2/business/industries?market=EM", ("business.industries",)),
    ("GET", "/v2/credit-health/{symbol}", schemas.CreditHealthResponse, "/v2/credit-health/CEMEXCPO.MX?years=3", ("creditHealth",)),
]
STUBS = [row for row in SPEC if row[3]]

EXTRA_CAPABILITIES = {
    "legacy.v1",  # el router del backend viejo, que no está en el spec v2
    "panel.splits",  # refinamiento de /v2/panel: ?adjust=splits da cierres sin ajustar por dividendos
    "events.dividends",  # refinamiento de /v2/events: trae dividendSummary (fase 5)
    "ohlc.intraday",  # refinamiento de /v2/ohlc: sirve velas de 5m y 1h, no solo diarias (fase 5)
}
"""Capacidades de ``KNOWN_CAPABILITIES`` que no son "la" capacidad de ninguna ruta del spec."""


@pytest.fixture(scope="module")
def app():
    return create_app(Settings.from_env({"KAIZEN_LEGACY_ROUTES": "1"}))


@pytest.fixture(scope="module")
def client(app):
    return TestClient(app, raise_server_exceptions=False)


def router_module(rc) -> object:
    """El módulo de ``kaizen_api/routers/`` donde vive la función de la ruta."""
    return sys.modules[rc.endpoint.__module__]


def is_stub(rc) -> bool:
    """¿La ruta sigue siendo un stub? Lo dice la marca ``@stub`` de ``kaizen_api/routers/__init__.py``.

    Es un dato que pone el dueño de la ruta, no una heurística sobre el texto del código: una ruta
    ya implementada que conserva un ``not_implemented(...)`` para una rama que no soporta (por
    ejemplo un intervalo) no es un stub, y llamarla aquí saldría a los proveedores. Estas pruebas
    corren sin red.
    """
    return routers_pkg.is_stub(inspect.unwrap(rc.endpoint))


def v2_routes(app) -> dict[tuple[str, str], object]:
    routes = {}
    for rc in iter_route_contexts(app.routes):
        path = rc.path or ""
        if not getattr(rc, "include_in_schema", False):
            continue
        if path == "/health" or path.startswith(("/auth/", "/v2/")):
            for method in sorted(rc.methods or []):
                if method != "HEAD":
                    routes[(method, path)] = rc
    return routes


def test_registered_routes_match_the_spec_exactly(app):
    assert set(v2_routes(app)) == {(m, p) for m, p, _, _, _ in SPEC}


@pytest.mark.parametrize("method,path,model,_url,_caps", SPEC, ids=[f"{m} {p}" for m, p, _, _, _ in SPEC])
def test_every_route_declares_its_contract_model(app, method, path, model, _url, _caps):
    rc = v2_routes(app)[(method, path)]
    assert rc.response_model is model
    assert issubclass(model, schemas.ContractModel)


def test_every_response_model_is_in_the_registry():
    assert {model for _, _, model, _, _ in SPEC} == set(schemas.RESPONSE_MODELS)


def test_every_known_capability_belongs_to_a_route_or_is_a_declared_extra():
    """``KNOWN_CAPABILITIES`` y la quinta columna del spec no pueden irse por su lado."""
    of_routes = {cap for *_, caps in SPEC for cap in caps}
    assert of_routes | EXTRA_CAPABILITIES == set(schemas.KNOWN_CAPABILITIES)
    assert not (of_routes & EXTRA_CAPABILITIES)


def test_openapi_generates_with_error_body(app):
    spec = app.openapi()
    for method, path, _, _, _ in SPEC:
        assert method.lower() in spec["paths"][path], (method, path)
    assert "ErrorBody" in spec["components"]["schemas"]
    quotes = spec["paths"]["/v2/quotes"]["get"]
    assert quotes["responses"]["501"]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorBody")
    assert not [p for p in spec["paths"] if not (p == "/health" or p.startswith(("/auth/", "/v2/")))]


@pytest.mark.parametrize("method,path,model,url,caps", STUBS, ids=[p for _, p, _, _, _ in STUBS])
def test_stub_returns_501_error_body(app, client, method, path, model, url, caps):
    """Mientras la ruta sea stub, su 501 es el del contrato; ya implementada, anuncia SU capacidad.

    Las dos cosas se deciden por dato (la marca ``@stub`` y ``CAPABILITIES``), nunca llamando a una
    ruta implementada, que saldría a los proveedores.
    """
    rc = v2_routes(app)[(method, path)]
    module = rc.endpoint.__module__
    announced = set(getattr(router_module(rc), "CAPABILITIES", []))
    assert announced <= set(schemas.KNOWN_CAPABILITIES), sorted(announced - set(schemas.KNOWN_CAPABILITIES))
    mine = announced & set(caps)
    listed = " o ".join(repr(c) for c in caps)
    if not is_stub(rc):
        assert mine, (
            f"{method} {path} ya no lleva @stub pero su router no anuncia {listed}: "
            f"agrégala a CAPABILITIES de {module} (es lo que publica /health)"
        )
        return
    assert not mine, (
        f"{module} anuncia {sorted(mine)} pero {method} {path} todavía lleva @stub: si ya la "
        f"implementaste, quita esa línea (y su raise not_implemented); si no, quita la capacidad"
    )
    r = client.request(method, url)
    assert r.status_code == 501, r.text
    body = schemas.ErrorBody.model_validate(r.json())
    assert body.error.code == "NOT_IMPLEMENTED"
    assert body.error.message == "Esta función todavía no está disponible."
    assert body.error.details == {"endpoint": f"{method} {path}"}
    assert r.headers["cache-control"] == "no-store"


def test_health_announces_every_capability_that_the_routers_declare(app, client):
    """Lo que anuncia ``/health`` es exactamente lo que declaran los routers montados."""
    declared: set[str] = set()
    for rc in v2_routes(app).values():
        declared |= set(getattr(router_module(rc), "CAPABILITIES", []))
    announced = set(client.get("/health").json()["capabilities"])
    assert declared <= announced, sorted(declared - announced)
    assert announced <= set(schemas.KNOWN_CAPABILITIES), sorted(announced - set(schemas.KNOWN_CAPABILITIES))


@pytest.mark.parametrize(
    "url,status,code",
    [
        ("/v2/history/%3Cscript%3E", 400, "INVALID_SYMBOL"),
        ("/v2/history/" + "A" * 21, 400, "INVALID_SYMBOL"),
        ("/v2/instrument/AAPL%20X", 400, "INVALID_SYMBOL"),
        ("/v2/quotes?symbols=AAPL,%3Cx%3E", 400, "INVALID_SYMBOL"),
        ("/v2/news?symbol=%25", 400, "INVALID_SYMBOL"),
        ("/v2/screeners/fibras?extra=FUNO11.MX,$$$$$$$$$$$$$$$$$$$$$", 400, "INVALID_SYMBOL"),
        ("/v2/quotes", 422, "VALIDATION_ERROR"),
        ("/v2/quotes?symbols=,,,", 422, "VALIDATION_ERROR"),
        ("/v2/quotes?symbols=" + ",".join(f"S{i}" for i in range(51)), 422, "VALIDATION_ERROR"),
        ("/v2/history/AAPL?range=7y", 422, "VALIDATION_ERROR"),
        ("/v2/history/AAPL?interval=1h", 422, "VALIDATION_ERROR"),
        ("/v2/history/AAPL?ccy=EUR", 422, "VALIDATION_ERROR"),
        ("/v2/fx?pair=USD-MXN", 422, "VALIDATION_ERROR"),
        ("/v2/fx/history?start=2026-02-30", 422, "VALIDATION_ERROR"),
        ("/v2/fx/history?start=2026-09-22&end=2026-01-01", 422, "VALIDATION_ERROR"),
        ("/v2/rates/rf?tenorDays=30", 422, "VALIDATION_ERROR"),
        ("/v2/news?limit=0", 422, "VALIDATION_ERROR"),
        ("/v2/search", 422, "VALIDATION_ERROR"),
        ("/v2/valuation/AAPL?erp=0.5", 422, "VALIDATION_ERROR"),
        ("/v2/valuation/AAPL?years=40", 422, "VALIDATION_ERROR"),
        ("/v2/screeners/factors?universe=custom", 422, "VALIDATION_ERROR"),
        ("/v2/screeners/factors?universe=mx&symbols=AAPL", 422, "VALIDATION_ERROR"),
        ("/v2/screeners/magic?universe=eu", 422, "VALIDATION_ERROR"),
        ("/v2/instrument/AAPL/statements?freq=monthly", 422, "VALIDATION_ERROR"),
        # fase 5 (M5): las validaciones corren antes del stub
        ("/v2/curves", 422, "VALIDATION_ERROR"),
        ("/v2/curves?country=br", 422, "VALIDATION_ERROR"),
        ("/v2/curves?country=mx&compare=2y", 422, "VALIDATION_ERROR"),
        ("/v2/curves/spreads?history=10y", 422, "VALIDATION_ERROR"),
        ("/v2/fxdesk/monitor?years=2", 422, "VALIDATION_ERROR"),
        ("/v2/fxdesk/fix", 422, "VALIDATION_ERROR"),
        ("/v2/fxdesk/fix?date=2026-02-30", 422, "VALIDATION_ERROR"),
        ("/v2/fxdesk/fix?date=2026-09-30&rule=sat", 422, "VALIDATION_ERROR"),
        ("/v2/fxdesk/fix?date=1990-01-02", 400, "INVALID_PARAM"),
        ("/v2/fxdesk/fix-table?start=2026-09-30&end=2026-01-01", 422, "VALIDATION_ERROR"),
        ("/v2/fxdesk/fix-table?start=2020-01-01&end=2026-09-30", 400, "INVALID_PARAM"),
        ("/v2/fxdesk/forward?days=0", 400, "INVALID_PARAM"),
        ("/v2/fxdesk/forward?days=30,400", 400, "INVALID_PARAM"),
        ("/v2/fxdesk/forward?days=-5", 422, "VALIDATION_ERROR"),
        ("/v2/fxdesk/forward?date=2030-01-01", 400, "INVALID_PARAM"),
        ("/v2/fxdesk/forward?date=2020-01-01", 400, "INVALID_PARAM"),
        ("/v2/fxdesk/forward?days=30&date=2026-12-01", 422, "VALIDATION_ERROR"),
        ("/v2/fxdesk/forward?mxn=libor", 422, "VALIDATION_ERROR"),
        ("/v2/calendar/economic?start=2026-01-01&end=2026-12-31", 400, "INVALID_PARAM"),
        ("/v2/calendar/economic?start=2026-10-31&end=2026-10-01", 422, "VALIDATION_ERROR"),
        ("/v2/calendar/economic?country=br", 422, "VALIDATION_ERROR"),
        ("/v2/macro/indicators?country=br", 422, "VALIDATION_ERROR"),
        ("/v2/macro/indicators?years=3", 422, "VALIDATION_ERROR"),
        ("/v2/macro/world?countries=MEX,USA,BRA,ARG,CHL,COL,PER,CAN,DEU,FRA,JPN", 422, "VALIDATION_ERROR"),
        ("/v2/macro/world?indicators=pib", 422, "VALIDATION_ERROR"),
        ("/v2/events/season?universe=eu", 422, "VALIDATION_ERROR"),
        ("/v2/events/season?days=45", 422, "VALIDATION_ERROR"),
        ("/v2/earnings/%3Cscript%3E", 400, "INVALID_SYMBOL"),
        ("/v2/holders/" + "A" * 21, 400, "INVALID_SYMBOL"),
        ("/v2/shares/AAPL?start=2099-01-01", 400, "INVALID_PARAM"),
        ("/v2/shares/AAPL?start=2026-13-01", 422, "VALIDATION_ERROR"),
        ("/v2/filings/AAPL?forms=10-K,S-1", 422, "VALIDATION_ERROR"),
        ("/v2/filings/AAPL?limit=51", 422, "VALIDATION_ERROR"),
        ("/v2/ohlc/AAPL%20X", 400, "INVALID_SYMBOL"),
        ("/v2/ohlc/WALMEX.MX?interval=5m&range=1y", 400, "INVALID_PARAM"),
        ("/v2/ohlc/WALMEX.MX?interval=1h&range=max", 400, "INVALID_PARAM"),
        ("/v2/ohlc/WALMEX.MX?interval=1mo&range=5d", 400, "INVALID_PARAM"),
        ("/v2/ohlc/WALMEX.MX?interval=1m", 422, "VALIDATION_ERROR"),
        ("/v2/ohlc/WALMEX.MX?range=3mo", 422, "VALIDATION_ERROR"),
        ("/v2/ohlc/WALMEX.MX?compare=QQQ", 422, "VALIDATION_ERROR"),
        ("/v2/movers?market=eu", 422, "VALIDATION_ERROR"),
        ("/v2/movers?kind=hot", 422, "VALIDATION_ERROR"),
        ("/v2/movers?limit=5", 422, "VALIDATION_ERROR"),
        ("/v2/breadth?market=br", 422, "VALIDATION_ERROR"),
        ("/v2/sectors?market=br", 422, "VALIDATION_ERROR"),
        ("/v2/funds/$$$$$$$$$$$$$$$$$$$$$", 400, "INVALID_SYMBOL"),
        ("/v2/reference/mx/update-factor?from=2026-13&to=2026-08", 422, "VALIDATION_ERROR"),
        ("/v2/reference/mx/update-factor?from=2026-08&to=2025-01", 422, "VALIDATION_ERROR"),
        ("/v2/reference/mx/update-factor?from=2026-01", 422, "VALIDATION_ERROR"),
        ("/v2/business/industries?market=MX", 422, "VALIDATION_ERROR"),
        ("/v2/credit-health/AAPL?years=4", 422, "VALIDATION_ERROR"),
        ("/v2/no-existe", 404, "NOT_FOUND"),
    ],
)
def test_invalid_params_get_contract_errors(client, url, status, code):
    r = client.get(url)
    assert r.status_code == status, r.text
    body = schemas.ErrorBody.model_validate(r.json())
    assert body.error.code == code
    assert r.headers["cache-control"] == "no-store"
    if status in (400, 422):
        if code == "INVALID_PARAM":  # 400 de regla de negocio: el mensaje dice qué rango admite
            assert body.error.message and body.error.message != "La solicitud no es válida."
        fields = body.error.details["fields"]
        assert fields and all(set(f) == {"field", "type"} and f["field"].startswith(("path.", "query.")) for f in fields)


def test_wrong_method_is_405_error_body(client):
    r = client.post("/v2/quotes")
    assert r.status_code == 405 and r.headers["allow"] == "GET"
    assert schemas.ErrorBody.model_validate(r.json()).error.code == "METHOD_NOT_ALLOWED"


def test_health_matches_contract(client):
    body = schemas.HealthResponse.model_validate(client.get("/health").json())
    assert set(body.capabilities) <= set(schemas.KNOWN_CAPABILITIES)


# ─── los modelos mismos ──────────────────────────────────────────────────────


def _meta() -> dict:
    return meta("yahoo", as_of="2026-09-22")


def test_models_forbid_extra_fields_and_check_lengths():
    ok = {
        "symbol": "WALMEX.MX",
        "currency": "MXN",
        "interval": "1d",
        "adjusted": True,
        "dates": ["2026-09-21", "2026-09-22"],
        "close": [60.1, 60.5],
        "fx": None,
        "meta": _meta(),
    }
    schemas.HistoryResponse.model_validate(ok)
    with pytest.raises(ValidationError):
        schemas.HistoryResponse.model_validate({**ok, "extra": 1})
    with pytest.raises(ValidationError):
        schemas.HistoryResponse.model_validate({**ok, "close": [60.1]})
    with pytest.raises(ValidationError):
        schemas.HistoryResponse.model_validate({**ok, "dates": ["22/09/2026", "2026-09-22"]})
    with pytest.raises(ValidationError):
        schemas.PanelResponse.model_validate(
            {"currency": "MXN", "interval": "1d", "dates": ["2026-09-22"], "prices": {"A": [1.0, 2.0]}, "dropped": [], "meta": _meta()}
        )
    with pytest.raises(ValidationError):
        schemas.Sensitivity.model_validate({"waccs": [0.1, 0.11], "growths": [0.02], "grid": [[1.0]]})


def test_reserved_word_fields_serialize_with_their_names():
    div = schemas.DividendsResponse.model_validate(
        {"symbol": "FUNO11.MX", "currency": "MXN", "ttm": 2.1, "yield": 0.087, "history": [], "meta": _meta()}
    )
    assert div.model_dump(by_alias=True)["yield"] == 0.087
    check = schemas.FactorCheck.model_validate({"id": "roe", "label": "ROE", "pass": True, "value": 0.2, "threshold": 0.1})
    assert check.model_dump(by_alias=True)["pass"] is True
    lam = schemas.ValuationAssumptions.model_validate(
        {"rf": 0.09, "erp": 0.055, "crp": 0.02, "lambda": 1.0, "taxRate": 0.3, "terminalGrowth": 0.03, "source": "damodaran", "asOf": None}
    )
    assert lam.model_dump(by_alias=True)["lambda"] == 1.0


def test_meta_rejects_unknown_sources_and_bad_instants():
    schemas.Meta.model_validate(_meta())
    with pytest.raises(ValidationError):
        schemas.Meta.model_validate({**_meta(), "source": "google"})
    with pytest.raises(ValidationError):
        schemas.Meta.model_validate({**_meta(), "generatedAt": "2026-09-22 14:51:31"})


def test_docs_cover_every_route_and_error_code():
    text = DOCS.read_text(encoding="utf-8")
    for method, path, _, _, _ in SPEC:
        assert f"{method} {path}" in text, f"{method} {path} no está en docs/api-v2.md"
    for code in schemas.ErrorCode.__args__:
        assert f"`{code}`" in text, code
    assert "—" not in text and "–" not in text


def test_docs_reference_is_current():
    """La referencia de modelos de docs/api-v2.md es la que genera schemas.py (KAIZEN_WRITE_DOCS=1 la reescribe)."""
    import os

    from tests.contract.docs_reference import BEGIN, END, render_reference

    text = DOCS.read_text(encoding="utf-8")
    start, stop = text.index(BEGIN), text.index(END) + len(END)
    expected = render_reference()
    if os.environ.get("KAIZEN_WRITE_DOCS") == "1":
        DOCS.write_text(text[:start] + expected + text[stop:], encoding="utf-8")
        return
    assert text[start:stop] == expected, "docs/api-v2.md desactualizado: KAIZEN_WRITE_DOCS=1 pytest tests/contract -k docs_reference"


def test_links_must_be_http_and_minor_units_are_documented():
    """Las ligas que la UI abre en el navegador solo pueden ser http(s).

    Un RSS puede traer ``javascript:`` o ``data:`` en el enlace; el contrato lo rechaza para que el
    proveedor descarte el elemento en vez de publicarlo. Las monedas siguen siendo ISO de tres
    letras: las unidades menores de Yahoo (GBp, ZAc) se normalizan antes de armar la respuesta.
    """
    news = {
        "id": "1",
        "title": "Titular",
        "url": "https://ejemplo.mx/nota",
        "source": "rss",
        "publishedAt": "2026-09-22T14:00:00Z",
        "summary": None,
        "lang": "es",
        "tone": None,
    }
    schemas.NewsItem.model_validate(news)
    for malo in ("javascript:alert(1)", "data:text/html,<script>", "//ejemplo.mx/nota", "ftp://ejemplo.mx"):
        with pytest.raises(ValidationError):
            schemas.NewsItem.model_validate({**news, "url": malo})


# ─── fase 5 (M5): reglas que viven en los modelos ────────────────────────────


def test_events_stays_compatible_and_gains_estimate_range_and_dividends():
    """Lo que hoy responde /v2/events sigue siendo válido; los campos nuevos son opcionales."""
    item = {"symbol": "AAPL", "type": "earnings", "date": "2026-10-29", "estimate": 1.6, "amount": None, "currency": "USD"}
    old = schemas.EventsResponse.model_validate({"items": [item], "meta": _meta()})
    assert old.dividendSummary is None and old.items[0].estimateLow is None
    new = schemas.EventsResponse.model_validate(
        {
            "items": [{**item, "estimateLow": 1.5, "estimateHigh": 1.75}],
            "dividendSummary": [
                {
                    "symbol": "WALMEX.MX",
                    "currency": "MXN",
                    "lastPaidAmount": 0.5,
                    "lastPaidDate": "2026-07-15",
                    "frequency": "trimestral",
                    "paidMonths": [1, 4, 7, 10],
                }
            ],
            "meta": _meta(),
        }
    )
    assert new.items[0].estimateHigh == 1.75 and new.dividendSummary[0].paidMonths == [1, 4, 7, 10]
    with pytest.raises(ValidationError):
        schemas.DividendSummaryItem.model_validate({**new.dividendSummary[0].model_dump(), "paidMonths": [13]})


def _ohlc(interval: str, t: str, compare_t: str | None = None) -> dict:
    return {
        "symbol": "WALMEX.MX",
        "currency": "MXN",
        "interval": interval,
        "timezone": "America/Mexico_City",
        "adjustment": "splits",
        "bars": [{"t": t, "o": 60.0, "h": 61.0, "l": 59.5, "c": 60.5, "v": 0.0}],
        "compare": {"symbol": "^MXX", "points": [{"t": compare_t or t, "c": 55000.0}]},
        "high52w": 70.0,
        "low52w": 50.0,
        "meta": _meta(),
    }


def test_ohlc_t_is_a_date_for_daily_bars_and_an_instant_for_intraday():
    schemas.OhlcResponse.model_validate(_ohlc("1d", "2026-09-30"))
    schemas.OhlcResponse.model_validate(_ohlc("1wk", "2026-09-28"))
    schemas.OhlcResponse.model_validate(_ohlc("5m", "2026-09-30T08:30:00-06:00"))
    schemas.OhlcResponse.model_validate(_ohlc("1h", "2026-09-30T14:30:00Z"))
    for bad in (_ohlc("1d", "2026-09-30T08:30:00-06:00"), _ohlc("5m", "2026-09-30"), _ohlc("1d", "2026-09-30", "2026-09-30T08:30:00Z")):
        with pytest.raises(ValidationError):
            schemas.OhlcResponse.model_validate(bad)
    with pytest.raises(ValidationError):
        schemas.OhlcResponse.model_validate({**_ohlc("1d", "2026-09-30"), "adjustment": "total"})
    with pytest.raises(ValidationError):
        schemas.OhlcResponse.model_validate({**_ohlc("1d", "2026-09-30"), "interval": "1m"})


def _indicator(kind: str, **changes) -> dict:
    return {
        "id": "unemployment",
        "label": "Desempleo",
        "kind": kind,
        "unit": "fraction",
        "frequency": "monthly",
        "last": {"date": "2026-08-01", "value": 0.045},
        "previous": {"date": "2026-07-01", "value": 0.044},
        "changeYoY": None,
        "changeYoYBp": None,
        "history": {"dates": ["2026-07-01", "2026-08-01"], "values": [0.044, 0.045]},
        "seriesId": "UNRATE",
        "source": "fred",
        "fallback": False,
        "stale": False,
        "nextRelease": "2026-10-02",
        **changes,
    }


def test_macro_rates_change_in_bp_and_levels_in_fraction():
    schemas.MacroIndicator.model_validate(_indicator("rate", changeYoYBp=40.0))
    schemas.MacroIndicator.model_validate(_indicator("level", changeYoY=0.090467))
    with pytest.raises(ValidationError):
        schemas.MacroIndicator.model_validate(_indicator("rate", changeYoY=0.004))
    with pytest.raises(ValidationError):
        schemas.MacroIndicator.model_validate(_indicator("level", changeYoYBp=40.0))
    with pytest.raises(ValidationError):
        schemas.MacroIndicator.model_validate(_indicator("rate", unit="percent"))
    with pytest.raises(ValidationError):
        schemas.MacroIndicator.model_validate(_indicator("rate", history={"dates": ["2026-08-01"], "values": [0.1, 0.2]}))


def test_credit_health_not_applicable_has_reason_and_no_years():
    base = {"symbol": "GFNORTEO.MX", "currency": "MXN", "inputsMissing": [], "meta": _meta()}
    schemas.CreditHealthResponse.model_validate({**base, "applicable": False, "reason": "Es un banco", "years": []})
    year = {
        "fiscalYear": 2025,
        "altmanZEm": 7.052,
        "netDebtToEbitda": 2.0,
        "interestCoverage": 5.0,
        "currentRatio": None,
        "quickRatio": None,
        "dso": 30.0,
        "dpo": None,
    }
    with pytest.raises(ValidationError):
        schemas.CreditHealthResponse.model_validate({**base, "applicable": False, "reason": "Es un banco", "years": [year]})
    with pytest.raises(ValidationError):
        schemas.CreditHealthResponse.model_validate({**base, "applicable": False, "reason": None, "years": []})
    schemas.CreditHealthResponse.model_validate({**base, "applicable": True, "reason": None, "years": [year]})


def test_survey_date_is_always_the_first_of_the_month():
    survey = {"surveyDate": "2026-12-01", "yearT": 2026, "items": []}
    schemas.ExpectationsSurvey.model_validate(survey)
    with pytest.raises(ValidationError):
        schemas.ExpectationsSurvey.model_validate({**survey, "surveyDate": "2026-12-15"})


def test_new_sources_are_valid_and_units_are_closed_lists():
    for source in ("treasury", "frankfurter", "cftc", "bls", "worldbank", "fred,treasury", "curated,banxico"):
        schemas.Meta.model_validate({**_meta(), "source": source})
    with pytest.raises(ValidationError):
        schemas.MacroWorldRow.model_validate(
            {"country": "MEX", "name": "México", "indicator": "gdpUsd", "unit": "mxn", "year": 2025, "value": 1.0}
        )
    with pytest.raises(ValidationError):
        schemas.FilingsResponse.model_validate(
            {"symbol": "AAPL", "cik": "320193", "viaAdr": None, "filings": [], "meta": {**_meta(), "source": "sec"}}
        )
