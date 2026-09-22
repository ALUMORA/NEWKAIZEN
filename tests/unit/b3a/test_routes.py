"""Las cinco rutas de B3a: contrato, procedencia honesta, errores y estilo del texto."""

from __future__ import annotations

import pytest

from kaizen_api import schemas
from kaizen_api.routers import events as events_router
from kaizen_api.routers import insiders as insiders_router
from kaizen_api.routers import research as research_router
from tests.unit.b3a.conftest import strings

OK_ROUTES = [
    ("/v2/instrument/WALMEX.MX", schemas.InstrumentResponse),
    ("/v2/instrument/AAPL.MX", schemas.InstrumentResponse),
    ("/v2/instrument/AAPL", schemas.InstrumentResponse),
    ("/v2/instrument/SPY", schemas.InstrumentResponse),
    ("/v2/instrument/AAPL/statements", schemas.StatementsResponse),
    ("/v2/instrument/AAPL/statements?freq=quarterly", schemas.StatementsResponse),
    ("/v2/instrument/WALMEX.MX/statements", schemas.StatementsResponse),
    ("/v2/instrument/SPY/statements", schemas.StatementsResponse),
    ("/v2/instrument/AAPL/dividends", schemas.DividendsResponse),
    ("/v2/instrument/FUNO11.MX/dividends", schemas.DividendsResponse),
    ("/v2/events?symbols=AAPL,WALMEX.MX,FUNO11.MX", schemas.EventsResponse),
    ("/v2/insiders/AAPL", schemas.InsidersResponse),
    ("/v2/insiders/WALMEX.MX", schemas.InsidersResponse),
]


@pytest.mark.parametrize("url,model", OK_ROUTES)
def test_route_matches_the_contract(client, url, model):
    response = client.get(url)
    assert response.status_code == 200, response.text
    model.model_validate(response.json())


@pytest.mark.parametrize("url,_model", OK_ROUTES)
def test_no_em_dashes_anywhere_in_the_answer(client, url, _model):
    for text in strings(client.get(url).json()):
        assert "—" not in text, f"guion largo en {url}: {text}"
        assert "–" not in text, f"guion corto en {url}: {text}"


@pytest.mark.parametrize("url,_model", OK_ROUTES)
def test_meta_is_honest(client, url, _model):
    meta = client.get(url).json()["meta"]
    assert meta["source"] in ("yahoo", "sec", "yahoo,computed", "sec,computed")
    assert meta["stale"] is False
    assert isinstance(meta["notes"], list)
    assert meta["generatedAt"].endswith("Z")


def test_the_yield_field_keeps_its_contract_name(client):
    body = client.get("/v2/instrument/AAPL/dividends").json()
    assert "yield" in body and "yield_" not in body


def test_a_fallback_beta_is_flagged_as_a_fallback(client):
    """Sin la costura de históricos, AAPL cae a la beta de Yahoo y la respuesta lo declara."""
    body = client.get("/v2/instrument/AAPL").json()
    assert body["beta"]["source"] == "yahoo"
    assert body["meta"]["fallback"] is True
    assert any("S&P 500" in note for note in body["meta"]["notes"])


def test_a_bmv_symbol_never_borrows_the_us_beta(client):
    body = client.get("/v2/instrument/WALMEX.MX").json()
    assert body["beta"] is None
    assert body["meta"]["fallback"] is False
    assert any("beta no se calculó" in note for note in body["meta"]["notes"])


@pytest.mark.parametrize(
    "url,status,code",
    [
        ("/v2/instrument/ZZZNOTREAL", 404, "NOT_FOUND"),
        ("/v2/instrument/ZZZNOTREAL/dividends", 404, "NOT_FOUND"),
        ("/v2/instrument/AAPL%20X", 400, "INVALID_SYMBOL"),
        ("/v2/insiders/AAPL%20X", 400, "INVALID_SYMBOL"),
        ("/v2/instrument/AAPL/statements?freq=mensual", 422, "VALIDATION_ERROR"),
        ("/v2/events", 422, "VALIDATION_ERROR"),
        ("/v2/events?symbols=,,,", 422, "VALIDATION_ERROR"),
        # Una cadena vacía la corta el patrón del parámetro antes de llegar a parse_symbols.
        ("/v2/events?symbols=", 400, "INVALID_SYMBOL"),
        ("/v2/events?symbols=AAPL,%3Cx%3E", 400, "INVALID_SYMBOL"),
    ],
)
def test_error_paths_use_real_status_codes_and_spanish(client, url, status, code):
    response = client.get(url)
    assert response.status_code == status, response.text
    body = schemas.ErrorBody.model_validate(response.json())
    assert body.error.code == code
    assert response.headers["cache-control"] == "no-store"
    assert body.error.message and body.error.message[0].isupper()


def test_cache_headers_match_the_data_class(client):
    assert client.get("/v2/instrument/WALMEX.MX").headers["cache-control"] == "private, max-age=30"
    assert client.get("/v2/instrument/AAPL/statements").headers["cache-control"] == "private, max-age=21600"
    assert client.get("/v2/insiders/AAPL").headers["cache-control"] == "private, max-age=21600"


def test_health_announces_exactly_what_these_routers_do(client):
    announced = set(client.get("/health").json()["capabilities"])
    for name in ("instrument", "statements.real", "dividends", "events", "insiders"):
        assert name in announced, f"/health no anuncia {name}"


def test_declared_capabilities_are_known_and_complete():
    declared = set(research_router.CAPABILITIES) | set(events_router.CAPABILITIES) | set(insiders_router.CAPABILITIES)
    assert declared == {"instrument", "statements.real", "dividends", "events", "insiders"}
    assert declared <= set(schemas.KNOWN_CAPABILITIES)
