"""Piezas compartidas por las pruebas de B1."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from kaizen_api.main import create_app
from kaizen_api.security.auth import hash_password
from kaizen_api.settings import Settings

SECRET = "prueba-secreta-de-32-caracteres-o-mas-0123"
PASSWORD = "correcta-y-larga"


@pytest.fixture(scope="session")
def ana_hash() -> str:
    """Un hash scrypt real. Es caro (scrypt), así que se calcula una sola vez por sesión."""
    return hash_password(PASSWORD)


@pytest.fixture
def settings_for(ana_hash):
    def build(**env: str) -> Settings:
        base = {"SECRET_KEY": SECRET, "USERS": json.dumps({"ana": ana_hash})}
        base.update(env)
        return Settings.from_env(base)

    return build


@pytest.fixture
def client_for(settings_for):
    def build(**env: str) -> TestClient:
        return TestClient(create_app(settings_for(**env)), raise_server_exceptions=False)

    return build
