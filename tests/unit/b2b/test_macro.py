"""``/v2/macro/us``: tasas como fracción, diferenciales en puntos base, VIX y DXY con fecha."""

from __future__ import annotations

import pytest

from kaizen_api.domain import macro as macro_domain
from kaizen_api.schemas import UsMacroResponse

CBOE_CSV = """DATE,OPEN,HIGH,LOW,CLOSE
09/18/2026,15.070000,15.630000,14.800000,14.810000
09/21/2026,14.960000,15.130000,14.600000,14.870000
"""


def _items(client) -> dict:
    respuesta = client.get("/v2/macro/us")
    assert respuesta.status_code == 200, respuesta.text
    body = UsMacroResponse.model_validate(respuesta.json())
    return {item.id: item for item in body.items}, body


def test_macro_trae_los_ocho_indicadores_en_orden(client):
    _por_id, body = _items(client)
    assert [item.id for item in body.items] == [
        "ust3m", "ust2y", "ust10y", "spread10y2y", "spread10y3m", "vix", "dxy", "fedFunds"
    ]
    assert body.meta.source == "cboe,fred,yahoo"
    assert body.meta.fallback is False
    assert body.meta.notes == []
    assert client.get("/v2/macro/us").headers["cache-control"] == "private, max-age=3600"


def test_las_tasas_van_como_fraccion_y_el_cambio_en_puntos_base(client):
    por_id, _body = _items(client)
    diez = por_id["ust10y"]
    assert diez.unit == "fraction"
    assert diez.value == pytest.approx(0.0501), "5.01 % anual sale 0.0501, no 5.01"
    assert diez.previous == pytest.approx(0.0494)
    assert diez.change == pytest.approx(0.0007)
    assert diez.changeBp == pytest.approx(7.0)
    assert diez.asOf == "2026-09-18"
    assert diez.source == "fred"
    assert por_id["ust3m"].value == pytest.approx(0.0414)
    assert por_id["ust2y"].changeBp == pytest.approx(9.0)
    assert por_id["fedFunds"].unit == "fraction"
    assert por_id["fedFunds"].value == pytest.approx(0.0388)


def test_los_diferenciales_van_en_puntos_base(client):
    por_id, _body = _items(client)
    spread = por_id["spread10y2y"]
    assert spread.unit == "bp"
    assert spread.value == pytest.approx(25.0), "5.01 % menos 4.76 % son 25 puntos base"
    assert spread.previous == pytest.approx(27.0)
    assert spread.change == spread.changeBp == pytest.approx(-2.0)
    assert por_id["spread10y3m"].value == pytest.approx(87.0), "5.01 % menos 4.14 %"


def test_vix_y_dxy_son_niveles_sin_puntos_base(client):
    por_id, _body = _items(client)
    vix = por_id["vix"]
    assert vix.unit == "index" and vix.source == "cboe"
    assert vix.value == pytest.approx(14.87) and vix.previous == pytest.approx(14.81)
    assert vix.changeBp is None, "un índice no cambia en puntos base"
    dxy = por_id["dxy"]
    assert dxy.unit == "index" and dxy.source == "yahoo"
    assert dxy.value == pytest.approx(100.54), "Yahoo lo manda como float32; se publica con 2 decimales"
    assert dxy.changeBp is None


def test_parse_cboe_csv():
    serie = macro_domain.parse_cboe_csv(CBOE_CSV)
    assert serie["dates"] == ["2026-09-18", "2026-09-21"], "las fechas de CBOE vienen MM/DD/AAAA"
    assert serie["values"] == [14.81, 14.87]


@pytest.mark.parametrize("texto", ["", "DATE,OPEN,HIGH,LOW,CLOSE", "basura", "DATE,CLOSE\n09/18/2026,x\n"])
def test_parse_cboe_csv_aguanta_basura(texto):
    assert macro_domain.parse_cboe_csv(texto) == {"dates": [], "values": []}


def test_aligned_tail_no_mezcla_fechas_distintas():
    """Sin alinear, un diferencial mezcla el 10 años de ayer con el de 2 años de anteayer."""
    largo = {"dates": ["2026-09-16", "2026-09-17", "2026-09-18"], "values": [4.97, 4.99, 5.01]}
    corto = {"dates": ["2026-09-16", "2026-09-18"], "values": [4.70, 4.76]}
    fechas, a, b = macro_domain._aligned_tail(largo, corto)
    assert fechas == ["2026-09-16", "2026-09-18"]
    assert a == [4.97, 5.01]
    assert b == [4.70, 4.76]


def test_aligned_tail_sin_fechas_en_comun():
    assert macro_domain._aligned_tail({"dates": ["2026-09-16"], "values": [1.0]},
                                      {"dates": ["2026-09-17"], "values": [2.0]}) == ([], [], [])


def test_el_vix_cae_a_fred_y_lo_marca_como_respaldo(client, monkeypatch):
    monkeypatch.setattr(macro_domain, "_cboe_vix_series", lambda: {"dates": [], "values": []})
    original = macro_domain.fred.fetch_series

    def falso(series_id, start=None, end=None):
        if series_id == macro_domain.VIX_FRED_SERIES:
            return {"dates": ["2026-09-18", "2026-09-21"], "values": [14.81, 14.87]}
        return original(series_id, start, end)

    monkeypatch.setattr(macro_domain.fred, "fetch_series", falso)
    body = UsMacroResponse.model_validate(client.get("/v2/macro/us").json())
    por_id = {item.id: item for item in body.items}
    assert por_id["vix"].source == "fred"
    assert body.meta.fallback is True, "un sustituto se anuncia"
    assert any("CBOE" in nota for nota in body.meta.notes)


def test_si_no_hay_ni_un_indicador_la_ruta_responde_503(client, monkeypatch):
    monkeypatch.setattr(macro_domain, "_cboe_vix_series", lambda: {"dates": [], "values": []})
    monkeypatch.setattr(macro_domain, "_yahoo_close_series", lambda _s: {"dates": [], "values": []})
    monkeypatch.setattr(macro_domain.fred, "fetch_series", lambda *a, **k: {"dates": [], "values": []})
    r = client.get("/v2/macro/us")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"
    assert r.headers["cache-control"] == "no-store"


def test_un_indicador_caido_no_tumba_a_los_demas(client, monkeypatch):
    monkeypatch.setattr(macro_domain, "_yahoo_close_series", lambda _s: {"dates": [], "values": []})
    body = UsMacroResponse.model_validate(client.get("/v2/macro/us").json())
    ids = {item.id for item in body.items}
    assert "dxy" not in ids
    assert {"ust3m", "ust2y", "ust10y", "vix", "fedFunds"} <= ids
    assert any("dólar" in nota for nota in body.meta.notes)


def test_el_dxy_reusa_la_misma_llamada_en_lote_que_b2a(client, b2b_replay):
    """Mismos argumentos que ``domain.markets._bulk_download``: es la MISMA llave de fixture."""
    with b2b_replay.trace() as llaves:
        client.get("/v2/macro/us")
    assert "yf.download:[DX-Y.NYB]?period=5d" in llaves
