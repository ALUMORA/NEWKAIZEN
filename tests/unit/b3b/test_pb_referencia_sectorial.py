"""Lo que docs/api-v2.md dice de las referencias del sector, comprobado contra el servidor (PB).

F3 pidió el contrato de ``sectorMedians``. La respuesta honesta tiene dos partes: ``sectorMedians``
vive en ``/v2/instrument/{symbol}`` y hoy siempre sale en ``null``; la referencia sectorial que sí
existe está en ``/v2/valuation/{symbol}``, en ``multiples.methods``. Si alguien llena
``sectorMedians`` o cambia los métodos, estas pruebas obligan a corregir el documento.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from tests.replay import format_sets, replaying

from .conftest import b3b_set

B3A_LAYER = "2026-09-22-b3a"


@pytest.fixture
def api() -> Iterator[TestClient]:
    """Ficha (capa de B3a) y valuación (capa de B3b) en el mismo replay, sin red."""
    import kaizen_api
    from kaizen_api.main import create_app
    from kaizen_api.settings import Settings, configure

    with replaying(format_sets(b3b_set() + "," + B3A_LAYER)) as session:
        kaizen_api.reset_state()
        app = create_app(Settings.from_env({"KAIZEN_ENV": "development", "AUTH_REQUIRED": "false"}))
        try:
            yield TestClient(app, raise_server_exceptions=False)
        finally:
            configure(None)
            kaizen_api.reset_state()
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"


@pytest.mark.parametrize("symbol", ["AAPL", "WALMEX.MX"])
def test_sector_medians_hoy_siempre_sale_en_null(api, symbol):
    r = api.get(f"/v2/instrument/{symbol}")
    assert r.status_code == 200, r.text
    assert "sectorMedians" in r.json()
    assert r.json()["sectorMedians"] is None


@pytest.mark.parametrize("symbol", ["AAPL", "WALMEX.MX", "GFNORTEO.MX"])
def test_los_metodos_son_cuatro_y_pfcf_nunca_trae_referencia(api, symbol):
    methods = api.get(f"/v2/valuation/{symbol}").json()["multiples"]["methods"]
    assert [m["id"] for m in methods] == ["pe", "pb", "evEbitda", "pfcf"]
    pfcf = methods[-1]
    assert pfcf["benchmark"] is None and pfcf["applicable"] is False
    for m in methods[:3]:
        assert m["benchmark"] is not None and m["benchmark"] > 0, m


def test_el_alcance_de_la_referencia_solo_se_dice_en_meta_notes_y_solo_si_aplica(api):
    aapl = api.get("/v2/valuation/AAPL").json()
    assert aapl["multiples"]["applicable"] is True
    assert aapl["multiples"]["market"] == "US"
    assert any(n.startswith("Mediana de 11 industrias de Damodaran del sector Technology") for n in aapl["meta"]["notes"])
    banco = api.get("/v2/valuation/GFNORTEO.MX").json()
    assert banco["multiples"]["applicable"] is False
    assert not any(n.startswith("Mediana de") or n.startswith("Total del mercado") for n in banco["meta"]["notes"])


def test_current_de_la_valuacion_no_es_el_mismo_numero_que_fundamentals_de_la_ficha(api):
    """Por eso el documento pide comparar ``benchmark`` contra ``current`` de la misma respuesta."""
    ficha = api.get("/v2/instrument/AAPL").json()["fundamentals"]
    metodos = {m["id"]: m for m in api.get("/v2/valuation/AAPL").json()["multiples"]["methods"]}
    assert metodos["evEbitda"]["current"] != pytest.approx(ficha["evEbitda"], rel=0.01)
    assert metodos["pe"]["current"] == pytest.approx(ficha["pe"], rel=0.01)
