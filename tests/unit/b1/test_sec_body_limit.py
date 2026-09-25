"""Revisión de seguridad de fase 4 (stream SEC): tope al tamaño del cuerpo de los requests.

Antes, ``POST /auth/login`` (pública) leía el cuerpo COMPLETO a memoria antes de validar nada y antes
del límite de tasa: un solo request de cientos de MB, sin sesión, tumbaba el servicio de Render
(512 MB en el plan gratuito). El reporte está en ``docs/overhaul/notas/fase4-seguridad.md``.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from kaizen_api.main import MAX_BODY_BYTES, create_app
from kaizen_api.settings import Settings

from .conftest import PASSWORD


def _client() -> TestClient:
    return TestClient(create_app(Settings.from_env({})), raise_server_exceptions=False)


def test_the_limit_is_small_but_fits_any_real_login():
    assert 4 * 1024 <= MAX_BODY_BYTES <= 64 * 1024


def test_a_declared_oversized_body_is_refused_before_reading_it():
    big = b'{"username": "ana", "password": "' + b"x" * (MAX_BODY_BYTES + 1) + b'"}'
    r = _client().post("/auth/login", content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    body = r.json()["error"]
    assert body["code"] == "BAD_REQUEST" and "grande" in body["message"]
    assert r.headers["cache-control"] == "no-store"


def test_a_chunked_body_without_content_length_is_cut_while_streaming():
    sent = {"bytes": 0}

    def chunks():
        yield b'{"username": "ana", "password": "'
        for _ in range(64):  # 64 x 16 KB = 1 MB, muy por encima del tope
            sent["bytes"] += 16 * 1024
            yield b"x" * (16 * 1024)
        yield b'"}'

    r = _client().post("/auth/login", content=chunks(), headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "BAD_REQUEST"


def test_the_legacy_login_is_covered_too():
    big = b"{" + b" " * (MAX_BODY_BYTES + 1) + b"}"
    r = _client().post("/login", content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413


def test_a_normal_login_still_works(ana_hash):
    import json

    settings = Settings.from_env({"USERS": json.dumps({"ana": ana_hash})})
    client = TestClient(create_app(settings), raise_server_exceptions=False)
    r = client.post("/auth/login", json={"username": "ana", "password": PASSWORD})
    assert r.status_code == 200 and r.json()["token"]


def test_a_malformed_content_length_is_a_client_error():
    r = _client().post("/auth/login", content=b"{}", headers={"Content-Type": "application/json", "Content-Length": "abc"})
    assert 400 <= r.status_code < 500
