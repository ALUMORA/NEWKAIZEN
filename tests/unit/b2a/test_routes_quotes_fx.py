"""Rutas ``/v2/quotes``, ``/v2/fx`` y ``/v2/fx/history`` contra los fixtures grabados.

Lo que se cuida aquí es el contrato visible: unidades en fracción, monedas correctas, símbolos sin
dato en ``missing`` en vez de tumbar la respuesta, y ``meta`` que no miente.
"""

from __future__ import annotations

import pytest

from kaizen_api import schemas

DASHES = ("—", "–")


def _sin_guiones_largos(texto: str) -> bool:
    return not any(d in texto for d in DASHES)


def test_quotes_devuelve_lo_que_hay_y_lista_lo_que_falta(client) -> None:
    r = client.get("/v2/quotes?symbols=AAPL,WALMEX.MX,%5EMXX,ZZZNOTREAL")
    assert r.status_code == 200, r.text
    body = schemas.QuotesResponse.model_validate(r.json())
    assert body.missing == ["ZZZNOTREAL"]
    assert [q.symbol for q in body.quotes] == ["AAPL", "WALMEX.MX", "^MXX"]
    assert all(_sin_guiones_largos(n) for n in body.meta.notes)


def test_quotes_reporta_el_ipc_en_pesos(client) -> None:
    body = client.get("/v2/quotes?symbols=%5EMXX").json()
    ipc = body["quotes"][0]
    assert ipc["currency"] == "MXN"
    assert ipc["type"] == "index"
    assert ipc["price"] == pytest.approx(63722.71)


@pytest.mark.parametrize("symbol", ["AAPL", "WALMEX.MX", "^MXX"])
def test_el_cambio_porcentual_es_fraccion_y_cuadra_con_el_precio(client, symbol: str) -> None:
    """Yahoo manda el porcentaje en puntos porcentuales; el contrato v2 pide fracción."""
    quote = client.get(f"/v2/quotes?symbols={symbol.replace('^', '%5E')}").json()["quotes"][0]
    esperado = quote["price"] / quote["previousClose"] - 1
    assert quote["changePct"] == pytest.approx(esperado)
    assert abs(quote["changePct"]) < 0.5, "una fracción de más de 50 % delataría un porcentaje sin dividir"
    assert quote["change"] == pytest.approx(quote["price"] - quote["previousClose"])


def test_quotes_dice_cuando_yahoo_trae_un_precio_viejo(client) -> None:
    """Pasa de verdad con NAFTRAC.MX: el resumen de Yahoo regresa un precio de 2019."""
    body = client.get("/v2/quotes?symbols=NAFTRAC.MX").json()
    assert body["quotes"][0]["asOf"].startswith("2019-")
    assert body["meta"]["stale"] is True
    assert any("retraso" in nota for nota in body["meta"]["notes"])


def test_quotes_publica_el_retraso_de_la_fuente(client) -> None:
    meta = client.get("/v2/quotes?symbols=AAPL").json()["meta"]
    assert meta["source"] == "yahoo"
    assert meta["delayMinutes"] == 15
    assert meta["fallback"] is False


def test_fx_nunca_devuelve_el_17_5_fijo_del_backend_viejo(client) -> None:
    r = client.get("/v2/fx?pair=USDMXN")
    assert r.status_code == 200, r.text
    body = schemas.FxResponse.model_validate(r.json())
    assert body.rate != 17.5
    assert 10 < body.rate < 30
    assert body.source == "yahoo"
    assert body.asOf == "2026-09-22"
    assert body.stale is False


def test_fx_de_yahoo_se_marca_como_sustituto(client) -> None:
    meta = client.get("/v2/fx?pair=USDMXN").json()["meta"]
    assert meta["fallback"] is True
    assert meta["source"] == "yahoo"
    assert meta["notes"] and "FIX de Banxico" in meta["notes"][0]
    assert all(_sin_guiones_largos(n) for n in meta["notes"])


def test_fx_de_un_par_que_no_manejamos_es_400(client) -> None:
    r = client.get("/v2/fx?pair=EURMXN")
    assert r.status_code == 400
    body = schemas.ErrorBody.model_validate(r.json())
    assert body.error.code == "BAD_REQUEST"
    assert "USDMXN" in body.error.message
    assert r.headers["cache-control"] == "no-store"


def test_fx_history_respeta_el_rango_y_es_del_mismo_largo(client) -> None:
    r = client.get("/v2/fx/history?pair=USDMXN&start=2026-09-14&end=2026-09-22")
    assert r.status_code == 200, r.text
    body = schemas.FxHistoryResponse.model_validate(r.json())
    assert len(body.dates) == len(body.values) == 7
    assert body.dates[0] >= "2026-09-14" and body.dates[-1] <= "2026-09-22"
    assert body.dates == sorted(body.dates)
    assert body.source == "yahoo"
    assert body.meta.fallback is True
    assert body.meta.asOf == body.dates[-1]


def test_fx_history_sin_fechas_toma_el_ultimo_anio(client) -> None:
    body = client.get("/v2/fx/history").json()
    assert body["dates"][0] <= "2025-10-01"
    assert body["dates"][-1] == "2026-09-22"
    assert len(body["dates"]) > 200


def test_las_rutas_de_datos_traen_su_cache_control(client) -> None:
    assert client.get("/v2/quotes?symbols=AAPL").headers["cache-control"] == "private, max-age=30"
    assert client.get("/v2/fx?pair=USDMXN").headers["cache-control"] == "private, max-age=30"
    assert client.get("/v2/fx/history").headers["cache-control"] == "private, max-age=3600"


def test_fx_con_el_fix_de_banxico_ya_no_va_marcado(client, monkeypatch) -> None:
    """Camino bueno de la costura: cuando B2b entregue el SIE, la ruta deja de ser sustituta."""
    from kaizen_api.providers import banxico

    monkeypatch.setattr(
        banxico,
        "fetch_series",
        lambda ids, start=None, end=None: {"bmx": {"series": [{"datos": [{"fecha": "22/09/2026", "dato": "18.3500"}]}]}},
    )
    body = client.get("/v2/fx?pair=USDMXN").json()
    assert body["rate"] == 18.35
    assert body["source"] == "banxico_fix"
    assert body["asOf"] == "2026-09-22"
    assert body["meta"]["source"] == "banxico"
    assert body["meta"]["fallback"] is False
    assert body["meta"]["delayMinutes"] is None
    assert body["meta"]["notes"] == []
