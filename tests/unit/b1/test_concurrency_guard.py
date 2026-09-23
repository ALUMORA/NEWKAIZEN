"""Guarda de carga: saturado, el API contesta 503 del contrato en vez del 503 pelón de uvicorn.

El defecto que arregla, de la revisión de S1: arriba de ``limit_concurrency`` uvicorn contesta un
503 en texto plano, sin CORS y sin ``{"error": {...}}``. El navegador ni siquiera lo puede leer, así
que el frontend no tiene qué decirle a la persona. La guarda de la app va por debajo de ese límite
(``MAX_CONCURRENCY`` < ``UVICORN_LIMIT_CONCURRENCY``) y contesta el cuerpo del contrato, con
``Retry-After`` y con CORS. El de uvicorn queda como red de seguridad.
"""

from __future__ import annotations

import threading

import pytest
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from kaizen_api.main import ConcurrencyLimitMiddleware, create_app
from kaizen_api.routers import legacy_v1
from kaizen_api.schemas import ErrorBody
from kaizen_api.settings import (
    DEFAULT_MAX_CONCURRENCY,
    UVICORN_LIMIT_CONCURRENCY,
    Settings,
    SettingsError,
)

ORIGIN = "http://localhost:5316"


def middleware_chain(app) -> list[str]:
    """Nombres de las capas, de la más externa a la más interna."""
    if app.middleware_stack is None:
        app.middleware_stack = app.build_middleware_stack()
    names, node = [], app.middleware_stack
    while node is not None:
        names.append(type(node).__name__)
        node = getattr(node, "app", None)
    return names


def guard_of(app) -> ConcurrencyLimitMiddleware:
    if app.middleware_stack is None:
        app.middleware_stack = app.build_middleware_stack()
    node = app.middleware_stack
    while node is not None and not isinstance(node, ConcurrencyLimitMiddleware):
        node = getattr(node, "app", None)
    assert isinstance(node, ConcurrencyLimitMiddleware), "la guarda de carga no está en la pila"
    return node


@pytest.fixture
def saturada(monkeypatch):
    """App con cupo 1 y una request v1 detenida adentro, así que ya no cabe ninguna otra."""
    started, release = threading.Event(), threading.Event()

    def slow_rf():
        started.set()
        assert release.wait(10), "la prueba nunca soltó la ruta"
        return {"rf": 0.0965}

    monkeypatch.setattr(legacy_v1, "get_rf", slow_rf)
    app = create_app(Settings.from_env({"MAX_CONCURRENCY": "1"}))
    held: dict[str, object] = {}

    def hold():
        held["response"] = TestClient(app).get("/rf")

    worker = threading.Thread(target=hold, daemon=True)
    worker.start()
    assert started.wait(10), "la primera request nunca entró"

    def soltar() -> None:
        release.set()
        worker.join(10)
        assert not worker.is_alive()

    try:
        yield app, held, soltar
    finally:
        release.set()
        worker.join(10)


def test_overload_answers_503_with_the_contract_body_and_cors(saturada):
    app, _held, _soltar = saturada
    r = TestClient(app, raise_server_exceptions=False).get("/v2/quotes?symbols=AAPL", headers={"Origin": ORIGIN})

    assert r.status_code == 503
    body = ErrorBody.model_validate(r.json())
    assert body.error.code == "RATE_LIMITED"  # el más cercano del contrato congelado
    assert body.error.message == ConcurrencyLimitMiddleware.MESSAGE
    assert "saturado" in body.error.message and "—" not in body.error.message and "–" not in body.error.message
    assert int(r.headers["retry-after"]) >= 1
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["content-type"].startswith("application/json")
    # Lo que uvicorn no da, y por eso existe esta capa: el navegador puede leer la respuesta.
    assert r.headers["access-control-allow-origin"] == ORIGIN
    assert "x-request-id" in r.headers


def test_health_still_answers_while_saturated(saturada):
    app, _held, _soltar = saturada
    # Render sondea /health: tumbarlo por carga haría que la plataforma reinicie el servicio justo
    # cuando está ocupado.
    r = TestClient(app).get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_the_slot_comes_back_when_the_request_ends(saturada):
    app, held, soltar = saturada
    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/v2/quotes?symbols=AAPL").status_code == 503

    soltar()
    assert held["response"].status_code == 200
    # Con el cupo libre, la siguiente request pasa la guarda y llega hasta la validación.
    otra = client.get("/v2/quotes?symbols=,,,")
    assert otra.status_code == 422 and otra.json()["error"]["code"] == "VALIDATION_ERROR"
    assert guard_of(app).in_flight == 0


def test_the_counter_comes_back_after_an_error(monkeypatch):
    """Una ruta que truena también devuelve su cupo: el descuento va en un ``finally``."""

    def boom():
        raise RuntimeError("falla del proveedor")

    monkeypatch.setattr(legacy_v1, "get_rf", boom)
    app = create_app(Settings.from_env({"MAX_CONCURRENCY": "2"}))
    client = TestClient(app, raise_server_exceptions=False)
    for _ in range(5):
        assert client.get("/rf").status_code == 200  # v1 convierte la excepción en 200 {"error"}
    assert guard_of(app).in_flight == 0


def test_the_guard_sits_below_uvicorns_last_resort():
    assert DEFAULT_MAX_CONCURRENCY < UVICORN_LIMIT_CONCURRENCY
    assert Settings.from_env({}).max_concurrency == DEFAULT_MAX_CONCURRENCY
    for bad in ("0", str(UVICORN_LIMIT_CONCURRENCY), str(UVICORN_LIMIT_CONCURRENCY + 10)):
        with pytest.raises(SettingsError, match="MAX_CONCURRENCY"):
            Settings.from_env({"MAX_CONCURRENCY": bad})
    with pytest.raises(SettingsError, match="MAX_CONCURRENCY"):
        Settings(max_concurrency=UVICORN_LIMIT_CONCURRENCY)


def test_the_guard_is_inside_cors_and_outside_gzip():
    chain = middleware_chain(create_app(Settings.from_env({})))
    assert chain.index(CORSMiddleware.__name__) < chain.index(ConcurrencyLimitMiddleware.__name__)
    assert chain.index(ConcurrencyLimitMiddleware.__name__) < chain.index(GZipMiddleware.__name__)


def test_openapi_announces_rate_limited_on_the_503():
    """La guarda contesta 503 con código RATE_LIMITED: el contrato tiene que decir que puede pasar."""
    spec = TestClient(create_app(Settings.from_env({}))).get("/openapi.json").json()
    data_routes = [p for p in spec["paths"] if p.startswith("/v2/")]
    assert data_routes
    for path in data_routes:
        for op in spec["paths"][path].values():
            desc = op["responses"]["503"]["description"]
            assert "RATE_LIMITED" in desc and "Retry-After" in desc, (path, desc)
