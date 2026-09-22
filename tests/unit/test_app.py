"""La app: configuración, CORS, GZip, id de request, errores 500 y las rutas v1 que no tienen golden."""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

from kaizen_api.main import create_app
from kaizen_api.provenance import meta
from kaizen_api.routers import legacy_v1
from kaizen_api.schemas import Meta
from kaizen_api.settings import DEV_SECRET_KEY, Settings, SettingsError


def client_for(**env: str) -> TestClient:
    return TestClient(create_app(Settings.from_env(env)), raise_server_exceptions=False)


# ─── configuración ───────────────────────────────────────────────────────────


def test_defaults_are_development():
    s = Settings.from_env({})
    assert (s.port, s.env, s.auth_required, s.legacy_routes, s.token_ttl_hours, s.token_version) == (
        8002,
        "development",
        False,
        True,
        12,
        1,
    )
    assert DEV_SECRET_KEY not in repr(s) and "secret_key" not in repr(s)
    with_users = Settings.from_env({"USERS": '{"ana": "pw-secreta-123"}', "BANXICO_TOKEN": "tok-banxico"})
    assert "pw-secreta-123" not in repr(with_users) and "tok-banxico" not in repr(with_users)


@pytest.mark.parametrize(
    "env,match",
    [
        ({"KAIZEN_ENV": "staging"}, "KAIZEN_ENV"),
        ({"AUTH_REQUIRED": "quizá"}, "AUTH_REQUIRED"),
        ({"PORT": "ochenta"}, "PORT"),
        ({"TOKEN_TTL_HOURS": "0"}, "TOKEN_TTL_HOURS"),
        ({"ALLOWED_ORIGIN_REGEX": "("}, "ALLOWED_ORIGIN_REGEX"),
        ({"ALLOWED_ORIGINS": "*"}, "ALLOWED_ORIGINS"),
        ({"KAIZEN_ENV": "production", "SECRET_KEY": "x" * 40, "USERS": "no es json"}, "USERS"),
    ],
)
def test_invalid_settings_refuse_to_start(env, match):
    with pytest.raises(SettingsError, match=match):
        Settings.from_env(env)


def test_production_hides_docs_and_legacy_routes():
    client = client_for(KAIZEN_ENV="production", SECRET_KEY="x" * 40)
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
    assert client.get("/rf").status_code == 404
    assert "legacy.v1" not in client.get("/health").json()["capabilities"]


def test_legacy_routes_can_be_turned_off_in_development():
    client = client_for(KAIZEN_LEGACY_ROUTES="0")
    assert client.get("/stock/AAPL").status_code == 404
    # Se afirma lo que depende del legado, no la lista entera: fase 2 va agregando capacidades.
    caps = client.get("/health").json()["capabilities"]
    assert "auth" in caps and "legacy.v1" not in caps


def test_health_shape():
    body = client_for(BANXICO_TOKEN="t", RENDER_GIT_COMMIT="abc123", KAIZEN_VERSION="2.0.1").get("/health").json()
    assert body["status"] == "ok" and body["apiVersion"] == 2
    assert body["version"] == "2.0.1" and body["commit"] == "abc123"
    assert body["providers"] == {
        "yahoo": {"ok": None},
        "banxico": {"configured": True},
        "fred": {"configured": False},
        "sec": {"ok": None},
        "eodhd": {"configured": False},
    }
    assert {"auth", "legacy.v1"} <= set(body["capabilities"])


# ─── CORS, GZip, id de request ───────────────────────────────────────────────


@pytest.mark.parametrize(
    "origin,allowed",
    [
        ("https://newkaizen.vercel.app", True),
        ("https://newkaizen-git-rama-luis.vercel.app", True),
        ("http://localhost:5201", True),
        ("http://127.0.0.1:5202", True),
        ("https://evil.example", False),
        ("https://newkaizen.vercel.app.evil.example", False),
    ],
)
def test_cors_preflight(origin, allowed):
    client = client_for()
    r = client.options(
        "/v2/quotes",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization, x-request-id",
        },
    )
    if allowed:
        assert r.status_code == 200
        assert r.headers["access-control-allow-origin"] == origin
        assert r.headers["access-control-max-age"] == "600"
        allowed_headers = r.headers["access-control-allow-headers"].lower()
        assert "authorization" in allowed_headers and "x-request-id" in allowed_headers
        assert "access-control-allow-credentials" not in r.headers
    else:
        assert r.status_code == 400
        assert "access-control-allow-origin" not in r.headers


def _exposed(response) -> set[str]:
    raw = response.headers.get("access-control-expose-headers", "")
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def test_cors_exposes_retry_after_and_request_id_on_cross_origin_429():
    # El contrato le pide al frontend leer Retry-After en un 429 y X-Request-ID en toda respuesta;
    # desde otro origen el navegador solo se los deja leer si vienen en Access-Control-Expose-Headers.
    origin = "https://newkaizen.vercel.app"
    client = client_for(USERS='{"luis": "clave"}')
    headers = {"Origin": origin, "X-Forwarded-For": "203.0.113.7", "X-Request-ID": "front-42"}
    for _ in range(5):
        assert client.post("/auth/login", json={"username": "luis", "password": "mala"}, headers=headers).status_code == 401
    r = client.post("/auth/login", json={"username": "luis", "password": "mala"}, headers=headers)
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"
    assert r.headers["access-control-allow-origin"] == origin
    assert {"retry-after", "x-request-id"} <= _exposed(r)
    assert int(r.headers["retry-after"]) >= 1 and r.headers["x-request-id"] == "front-42"

    legacy = client.post("/login", json={"username": "luis", "password": "mala"}, headers=headers)
    assert legacy.status_code == 429 and {"retry-after", "x-request-id"} <= _exposed(legacy)

    ok = client.get("/health", headers={"Origin": origin})
    assert ok.status_code == 200 and "x-request-id" in _exposed(ok)
    other = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in other.headers  # sin esto el navegador no deja leer nada


def test_cors_production_only_configured_origins():
    client = client_for(KAIZEN_ENV="production", SECRET_KEY="x" * 40, ALLOWED_ORIGINS="https://kaizen.mx")
    ok = client.get("/health", headers={"Origin": "https://kaizen.mx"})
    assert ok.headers["access-control-allow-origin"] == "https://kaizen.mx"
    local = client.get("/health", headers={"Origin": "http://localhost:5201"})
    assert "access-control-allow-origin" not in local.headers


def test_gzip_and_request_id(caplog):
    client = client_for()
    with caplog.at_level(logging.INFO, logger="kaizen_api"):
        r = client.get("/openapi.json?token=secreto", headers={"Accept-Encoding": "gzip", "X-Request-ID": "abc-123"})
    assert r.headers["content-encoding"] == "gzip"
    assert r.headers["x-request-id"] == "abc-123"
    lines = [rec.getMessage() for rec in caplog.records if "rid=abc-123" in rec.getMessage()]
    assert lines and lines[0].startswith("GET /openapi.json 200 ")
    assert "secreto" not in caplog.text
    small = client.get("/health", headers={"Accept-Encoding": "gzip", "X-Request-ID": "no valido!"})
    assert "content-encoding" not in small.headers
    assert small.headers["x-request-id"] != "no valido!" and len(small.headers["x-request-id"]) == 16


def test_unexpected_error_is_500_internal_without_exception_text(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("detalle interno que no debe salir")

    monkeypatch.setattr(legacy_v1, "legacy_dispatch", boom)
    client = client_for()
    r = client.get("/rf", headers={"Origin": "http://localhost:5201"})
    assert r.status_code == 500
    assert r.json() == {"error": {"code": "INTERNAL", "message": "Ocurrió un error inesperado. Intenta de nuevo en un momento."}}
    assert "detalle interno" not in r.text
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["access-control-allow-origin"] == "http://localhost:5201"


# ─── rutas v1 sin golden ─────────────────────────────────────────────────────


def test_legacy_invalid_ticker_and_bare_routes():
    client = client_for()
    for path in ("/stock/AAPL%20X", "/chart/%3Cscript%3E", "/news/" + "A" * 21, "/dcf/%0A"):
        r = client.get(path)
        assert r.status_code == 200 and r.content == b'{"error": "Ticker inv\\u00e1lido"}', path
    for path in ("/stock", "/stock/", "/magic_one", "/news"):
        r = client.get(path)
        assert r.status_code == 200 and r.json() == {"error": "Ruta no encontrada"}, path
    r = client.get("/nada/que/ver")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert client.get("/debug/macro").status_code == 404


def test_legacy_exception_becomes_200_error(monkeypatch):
    def boom():
        raise ValueError("sin datos")

    monkeypatch.setattr(legacy_v1, "get_rf", boom)
    r = client_for().get("/rf")
    assert r.status_code == 200 and r.json() == {"error": "sin datos"}


def test_legacy_login_semantics():
    client = client_for(USERS='{"Luis": "clave"}')
    assert client.post("/login", json={"username": " LUIS ", "password": "clave"}).json() == {"ok": True}
    assert client.post("/login", json={"username": "luis", "password": "otra"}).json() == {
        "ok": False,
        "error": "Credenciales incorrectas",
    }
    assert client.post("/login", content=b"no es json", headers={"Content-Type": "application/json"}).json() == {
        "ok": False,
        "error": "Credenciales incorrectas",
    }
    big = client.post("/login", content=b"{" + b" " * (10 * 1024) + b"}")
    assert big.status_code == 200 and big.json() == {"error": "Cuerpo demasiado grande"}


def test_legacy_login_shares_the_rate_limit():
    client = client_for(USERS='{"luis": "clave"}')
    headers = {"X-Forwarded-For": "203.0.113.9"}
    for _ in range(5):
        assert client.post("/login", json={"username": "x", "password": "y"}, headers=headers).status_code == 200
    r = client.post("/login", json={"username": "luis", "password": "clave"}, headers=headers)
    assert r.status_code == 429 and r.json()["ok"] is False and int(r.headers["retry-after"]) >= 1
    blocked = client.post("/auth/login", json={"username": "luis", "password": "clave"}, headers=headers)
    assert blocked.status_code == 429


# ─── procedencia ─────────────────────────────────────────────────────────────


def test_meta_matches_contract():
    import datetime as dt

    m = meta("yahoo,banxico", as_of=dt.date(2026, 9, 22), delay_minutes=15, fallback=True, notes=["FX rellenado 1 día"])
    Meta.model_validate(m)
    assert m["asOf"] == "2026-09-22" and m["generatedAt"].endswith("Z") and m["fallback"] is True
    instant = meta("computed", as_of=dt.datetime(2026, 9, 22, 8, 30, tzinfo=dt.timezone(dt.timedelta(hours=-6))))
    assert instant["asOf"] == "2026-09-22T14:30:00Z"
    Meta.model_validate(meta("replay"))
    for bad in ("", "google", "yahoo, fred", "YAHOO"):
        with pytest.raises(ValueError):
            meta(bad)
