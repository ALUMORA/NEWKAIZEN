"""Las tres rutas de V5EC completas desde las capas grabadas, sin red y sin llamadas sin grabar.

Capas: ``2026-09-22`` (FRED DFF), ``2026-10-01-banxico`` (SIE compartido) y ``2026-10-01-v5ec``
(BLS, FRED y Banco Mundial). El token de Banxico es falso: va en la cabecera y no es parte de la llave.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from kaizen_api.main import create_app
from kaizen_api.settings import Settings, configure
from tests.replay import load_module, replaying, reset_backend_state

SETS = "2026-09-22,2026-10-01-banxico,2026-10-01-v5ec"


@pytest.fixture
def client() -> Iterator[TestClient]:
    package = load_module("kaizen_api")
    env = {"KAIZEN_ENV": "development", "AUTH_REQUIRED": "false", "KAIZEN_LEGACY_ROUTES": "0",
           "BANXICO_TOKEN": "replay-falso"}
    with replaying(SETS) as session:
        reset_backend_state(package)
        settings = Settings.from_env(env)
        configure(settings)
        with TestClient(create_app(settings), raise_server_exceptions=False) as http:
            yield http
    configure(None)
    reset_backend_state(package)
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"


def test_calendario_de_la_semana(client):
    body = client.get("/v2/calendar/economic?start=2026-09-21&end=2026-10-04&country=mx,us").json()
    assert body["coverage"]["banxicoUntil"] == "2026-12-17" and body["coverage"]["blsUntil"]
    assert body["nextDecisions"]["banxico"] == {"date": "2026-09-24", "daysLeft": 2}
    banxico = next(e for e in body["events"] if e["id"] == "banxico-decision-2026-09-24")
    assert banxico["timeLocal"] == "13:00" and banxico["previous"] is not None and banxico["actual"] is None
    assert all(e["consensus"] is None for e in body["events"])
    assert "bls" in body["meta"]["source"]


def test_calendario_del_mes_trae_dato_anterior_y_publicado(client):
    body = client.get("/v2/calendar/economic?start=2026-09-01&end=2026-10-31&country=mx,us").json()
    inpc = next(e for e in body["events"] if e["id"] == "inegi-inpc-2026-09-09")
    assert inpc["previous"] == pytest.approx(0.0312) and inpc["actual"] == pytest.approx(0.0326)
    empleo = next(e for e in body["events"] if e["id"] == "bls-empsit-2026-09-04")
    assert empleo["period"] == "ago 2026" and empleo["unit"] == "thousandsPersons" and empleo["actual"] is not None


def test_calendario_solo_mexico(client):
    body = client.get("/v2/calendar/economic?start=2026-09-21&end=2026-10-04&country=mx").json()
    assert body["events"] and all(e["country"] == "MX" for e in body["events"])


def test_calendario_mas_de_90_dias_es_400(client):
    assert client.get("/v2/calendar/economic?start=2026-01-01&end=2026-06-01").status_code == 400


@pytest.mark.parametrize("country", ["mx", "us"])
def test_tablero(client, country):
    body = client.get(f"/v2/macro/indicators?country={country}&years=5").json()
    assert body["country"] == country
    for item in body["indicators"]:
        assert item["last"] is not None, item["id"]
        assert (item["changeYoY"] is None) or (item["changeYoYBp"] is None)


def test_tablero_mexico_espejos_ocde_marcados(client):
    body = client.get("/v2/macro/indicators?country=mx&years=5").json()
    ids = {i["id"]: i for i in body["indicators"]}
    assert "espejo OCDE" in ids["unemployment"]["label"]
    assert ids["inflation"]["seriesId"] == "SP30578" and ids["inflation"]["nextRelease"] == "2026-10-08"


def test_comparador_de_paises(client):
    body = client.get("/v2/macro/world").json()
    assert body["meta"]["source"] == "worldbank" and "CC BY 4.0" in body["meta"]["notes"][0]
    usa = next(r for r in body["rows"] if r["country"] == "USA" and r["indicator"] == "inflation")
    assert usa["value"] is None and usa["unit"] == "fraction"
    assert len(body["rows"]) == 12


def test_el_tablero_no_ensucia_la_verificacion_que_usa_rates_mx(client):
    """verification() devuelve el dict de la caché: el tablero no debe agregarle remesas y reserva."""
    from kaizen_api.providers import banxico

    assert client.get("/v2/macro/indicators?country=mx&years=5").status_code == 200
    assert set(banxico.verification(list(banxico.catalog()))) == set(banxico.catalog())
