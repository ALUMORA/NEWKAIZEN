"""Proveedor de FRED por ``fredgraph.csv``: parseo, recorte por fechas, caché y el User-Agent.

El detalle del User-Agent no es cosmético: FRED deja colgada la conexión con un User-Agent de
navegador, así que estas peticiones tienen que salir con ``requests.get`` pelón. Aquí se prueba.
"""

from __future__ import annotations

import pytest
import responses

from kaizen_api.providers import fred

CSV = """observation_date,DGS10
2026-09-14,4.94
2026-09-15,.
2026-09-16,4.97
2026-09-17,
2026-09-18,5.01
"""


def _add(series_id: str = "DGS10", body: str = CSV, status: int = 200) -> None:
    responses.add(
        responses.GET,
        fred.FREDGRAPH_URL,
        body=body,
        status=status,
        content_type="text/csv",
        match=[responses.matchers.query_param_matcher({"id": series_id})],
    )


def test_parse_csv_salta_los_dias_sin_dato():
    serie = fred.parse_csv(CSV)
    assert serie["dates"] == ["2026-09-14", "2026-09-16", "2026-09-18"]
    assert serie["values"] == [4.94, 4.97, 5.01]


@pytest.mark.parametrize("texto", ["", "observation_date,DGS10", "basura sin comas", "a,b\nx,y\n"])
def test_parse_csv_aguanta_basura(texto):
    assert fred.parse_csv(texto) == {"dates": [], "values": []}


@responses.activate
def test_fetch_series_manda_el_user_agent_de_requests(clean_state):
    _add()
    fred.fetch_series("DGS10")
    agente = responses.calls[0].request.headers.get("User-Agent", "")
    assert agente.startswith("python-requests/"), (
        f"FRED se cuelga con un User-Agent de navegador; salió {agente!r}. No uses providers.yahoo.session._session."
    )


@responses.activate
def test_fetch_series_recorta_por_fechas_sin_cambiar_la_url(clean_state):
    _add()
    completa = fred.fetch_series("DGS10")
    recorte = fred.fetch_series("DGS10", start="2026-09-16", end="2026-09-18")
    assert completa["dates"] == ["2026-09-14", "2026-09-16", "2026-09-18"]
    assert recorte["dates"] == ["2026-09-16", "2026-09-18"]
    assert recorte["values"] == [4.97, 5.01]
    assert len(responses.calls) == 1, "el recorte va en el cliente: una serie es UNA llave de caché y de fixture"
    assert responses.calls[0].request.params == {"id": "DGS10"}


@responses.activate
def test_fetch_series_cachea(clean_state):
    _add()
    fred.fetch_series("DGS10")
    fred.fetch_series("dgs10")  # el id se normaliza a mayúsculas
    assert len(responses.calls) == 1


@responses.activate
def test_fetch_series_devuelve_vacio_si_fred_falla(clean_state):
    _add(status=500, body="")
    assert fred.fetch_series("DGS10") == {"dates": [], "values": []}


def test_fetch_series_sin_id(clean_state):
    assert fred.fetch_series("  ") == {"dates": [], "values": []}


@responses.activate
def test_latest_y_last_points(clean_state):
    _add()
    assert fred.latest("DGS10") == ("2026-09-18", 5.01)
    assert fred.last_points("DGS10", 2) == [("2026-09-16", 4.97), ("2026-09-18", 5.01)]
    assert fred.last_points("DGS10", 0) == []


@responses.activate
def test_latest_sin_datos(clean_state):
    _add(body="observation_date,DGS10\n2026-09-18,.\n")
    assert fred.latest("DGS10") is None
