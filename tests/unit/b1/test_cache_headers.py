"""``Cache-Control`` por clase de dato: la tabla de la spec, ruta por ruta.

Esta prueba recorre ``app.routes``, así que B2 y B3 la heredan: el día que implementen su ruta, el
encabezado ya está declarado y si alguien registra una ruta nueva sin clase de dato, esto falla con
su nombre. Las clases y sus segundos los decide B1 en ``kaizen_api/http_cache.py``.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient

from kaizen_api.http_cache import CACHE_SECONDS, cache_control, no_store
from kaizen_api.main import create_app
from kaizen_api.settings import Settings

# La tabla de la spec v2 (Caching headers), sin margen de interpretación.
SPEC_SECONDS = {
    "quotes": 30,
    "history": 3600,
    "fundamentals": 21600,
    "macro": 3600,
    "news": 600,
    "screeners": 43200,
}

# Cada ruta v2 con la clase que le toca. Los criterios, para que B2/B3 no tengan que adivinar:
# precio que se mueve en el día -> quotes; serie histórica cerrada -> history; dato de la emisora
# que cambia por trimestre -> fundamentals; tasas y macro -> macro; titulares -> news; tablas
# completas de screener, caras de armar -> screeners.
EXPECTED = {
    ("GET", "/v2/quotes"): "quotes",
    ("GET", "/v2/fx"): "quotes",
    ("GET", "/v2/history/{symbol}"): "history",
    ("GET", "/v2/panel"): "history",
    ("GET", "/v2/fx/history"): "history",
    ("GET", "/v2/rates/mx"): "macro",
    ("GET", "/v2/rates/rf"): "macro",
    ("GET", "/v2/rates/mx/inpc"): "macro",
    ("GET", "/v2/macro/us"): "macro",
    ("GET", "/v2/markets/overview"): "quotes",
    ("GET", "/v2/markets/world"): "quotes",
    ("GET", "/v2/search"): "fundamentals",
    ("GET", "/v2/news"): "news",
    ("GET", "/v2/events"): "fundamentals",
    ("GET", "/v2/instrument/{symbol}"): "quotes",  # trae la cotización del momento
    ("GET", "/v2/instrument/{symbol}/statements"): "fundamentals",
    ("GET", "/v2/instrument/{symbol}/dividends"): "fundamentals",
    ("GET", "/v2/insiders/{symbol}"): "fundamentals",
    ("GET", "/v2/assumptions"): "fundamentals",
    ("GET", "/v2/valuation/{symbol}"): "fundamentals",
    ("GET", "/v2/momentum/{symbol}"): "history",
    ("GET", "/v2/screeners/factors"): "screeners",
    ("GET", "/v2/screeners/magic"): "screeners",
    ("GET", "/v2/screeners/fibras"): "screeners",
}

NO_STORE = {("GET", "/health"), ("POST", "/auth/login"), ("GET", "/auth/me")}


@pytest.fixture(scope="module")
def app():
    return create_app(Settings.from_env({"KAIZEN_LEGACY_ROUTES": "1"}))


def declared(route_context) -> list[str]:
    """Qué declara esa ruta: ``cache:<clase>`` o ``no-store``."""
    found = []
    for dependency in route_context.dependant.dependencies:
        name = getattr(dependency.call, "__name__", "")
        if name.startswith("cache_"):
            found.append(f"cache:{name[len('cache_') :]}")
        elif dependency.call is no_store:
            found.append("no-store")
    return found


def api_routes(app) -> dict[tuple[str, str], object]:
    routes = {}
    for rc in iter_route_contexts(app.routes):
        path = rc.path or ""
        if not getattr(rc, "include_in_schema", False):
            continue
        if path == "/health" or path.startswith(("/auth/", "/v2/")):
            for method in sorted(m for m in (rc.methods or []) if m != "HEAD"):
                routes[(method, path)] = rc
    return routes


def test_the_seconds_are_the_ones_in_the_spec():
    assert CACHE_SECONDS == SPEC_SECONDS


def test_every_route_declares_its_data_class(app):
    """Ni una ruta de más ni una de menos: si B2/B3 registran una nueva, aquí se entera."""
    assert set(api_routes(app)) == set(EXPECTED) | NO_STORE


@pytest.mark.parametrize("key", sorted(EXPECTED), ids=lambda k: f"{k[0]} {k[1]}")
def test_v2_routes_declare_the_right_data_class(app, key):
    assert declared(api_routes(app)[key]) == [f"cache:{EXPECTED[key]}"]


@pytest.mark.parametrize("key", sorted(NO_STORE), ids=lambda k: f"{k[0]} {k[1]}")
def test_health_and_auth_are_no_store(app, key):
    assert declared(api_routes(app)[key]) == ["no-store"]


def test_the_dependency_really_sets_the_header():
    """La declaración de arriba solo sirve si el encabezado sale. Se prueba con una ruta de juguete,
    porque en la fase 2 las rutas v2 todavía contestan 501 y un 501 es error (no-store)."""
    app = FastAPI()
    for data_class in CACHE_SECONDS:

        @app.get(f"/{data_class}", dependencies=[cache_control(data_class)])
        def ok() -> dict:
            return {"ok": True}

    client = TestClient(app)
    for data_class, seconds in CACHE_SECONDS.items():
        r = client.get(f"/{data_class}")
        assert r.headers["cache-control"] == f"private, max-age={seconds}"
        assert "public" not in r.headers["cache-control"]  # nunca en una caché compartida


def test_unknown_data_class_fails_loudly():
    with pytest.raises(KeyError):
        cache_control("inventada")


def test_errors_are_never_cached(app):
    client = TestClient(app, raise_server_exceptions=False)
    # Nota de M2: ya no queda ninguna ruta en 501 entre estas, porque la fase 2 las implementó.
    casos = {
        "/v2/quotes?symbols=<mal>": 400,
        "/v2/quotes": 422,
        "/nada/que/ver": 404,
        "/health": 200,
    }
    for url, status in casos.items():
        r = client.get(url)
        assert r.status_code == status, url
        assert r.headers["cache-control"] == "no-store", url
