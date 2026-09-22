"""Rutas ``/v2/history/{symbol}`` y ``/v2/panel``.

El panel es un INNER JOIN por fecha, SIN rellenar precios. Rellenar el precio de un día que no
operó inventa un rendimiento de cero, que es exactamente el ruido que ensucia una covarianza y un
backtest. La respuesta conocida del spec de finanzas se prueba abajo con series sintéticas.
"""

from __future__ import annotations

import pytest

from kaizen_api import schemas
from kaizen_api.domain import history as history_domain
from kaizen_api.errors import ApiError

D1, D2, D3, D4 = "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"


def test_history_entrega_fechas_reales_y_cierres_ajustados(client) -> None:
    r = client.get("/v2/history/%5EMXX?range=5y&interval=1wk&ccy=MXN")
    assert r.status_code == 200, r.text
    body = schemas.HistoryResponse.model_validate(r.json())
    assert body.adjusted is True
    assert body.currency == "MXN"
    assert body.fx is None
    assert len(body.dates) == len(body.close) == 262
    assert body.dates[0] == "2021-09-20" and body.dates[-1] == "2026-09-21"
    assert body.meta.asOf == "2026-09-21"


def test_history_convertido_dice_con_que_tipo_de_cambio(client) -> None:
    body = client.get("/v2/history/AAPL?range=1y&interval=1d&ccy=MXN").json()
    assert body["currency"] == "MXN"
    assert body["fx"] == {"pair": "USDMXN", "source": "yahoo"}
    assert body["meta"]["fallback"] is True
    assert any("misma fecha" in nota for nota in body["meta"]["notes"])
    assert body["close"][-1] == pytest.approx(340.3157958984375 * 17.297130584716797)


def test_history_de_un_simbolo_inexistente_es_404(client) -> None:
    r = client.get("/v2/history/ZZZNOTREAL?range=1y")
    assert r.status_code == 404
    assert schemas.ErrorBody.model_validate(r.json()).error.code == "NOT_FOUND"
    assert r.headers["cache-control"] == "no-store"


def test_panel_cruza_por_fecha_y_no_rellena(client, monkeypatch) -> None:
    """Respuesta conocida del spec: A en 4 fechas y B en 3 dejan las 3 comunes."""
    series = {
        "A": history_domain.PriceSeries("A", "MXN", "1d", [D1, D2, D3, D4], [100.0, 110.0, 121.0, 133.1], "yahoo"),
        "B": history_domain.PriceSeries("B", "MXN", "1d", [D1, D3, D4], [50.0, 55.0, 60.5], "yahoo"),
    }
    monkeypatch.setattr(history_domain, "get_series", lambda symbol, *a, **k: series[symbol])

    body = client.get("/v2/panel?symbols=A,B&range=1y&interval=1d&ccy=MXN").json()
    panel = schemas.PanelResponse.model_validate(body)
    assert panel.dates == [D1, D3, D4]
    assert panel.prices["A"] == [100.0, 121.0, 133.1]
    assert panel.prices["B"] == [50.0, 55.0, 60.5]
    assert panel.dropped == []
    assert panel.currency == "MXN"
    assert any("no se rellenaron" in nota for nota in panel.meta.notes)


def test_panel_deja_fuera_lo_que_falla_y_dice_por_que(client, monkeypatch) -> None:
    buena = history_domain.PriceSeries("A", "MXN", "1d", [D1, D2], [100.0, 110.0], "yahoo")

    def _fake(symbol, *args, **kwargs):
        if symbol == "A":
            return buena
        raise ApiError(404, "NOT_FOUND", f"No encontramos histórico de {symbol}. Revisa el símbolo.")

    monkeypatch.setattr(history_domain, "get_series", _fake)
    body = client.get("/v2/panel?symbols=A,ZZZNOTREAL&range=1y&interval=1d&ccy=MXN").json()
    assert body["dropped"] == [{"symbol": "ZZZNOTREAL", "reason": "No encontramos histórico de ZZZNOTREAL. Revisa el símbolo."}]
    assert list(body["prices"]) == ["A"]
    assert body["dates"] == [D1, D2]


def test_panel_sin_ningun_simbolo_util_es_404(client, monkeypatch) -> None:
    def _fake(symbol, *args, **kwargs):
        raise ApiError(404, "NOT_FOUND", "sin histórico")

    monkeypatch.setattr(history_domain, "get_series", _fake)
    r = client.get("/v2/panel?symbols=A,B")
    assert r.status_code == 404
    assert schemas.ErrorBody.model_validate(r.json()).error.code == "NOT_FOUND"


def test_panel_sin_fechas_en_comun_es_404(client, monkeypatch) -> None:
    series = {
        "A": history_domain.PriceSeries("A", "MXN", "1d", [D1, D2], [1.0, 2.0], "yahoo"),
        "B": history_domain.PriceSeries("B", "MXN", "1d", [D3, D4], [3.0, 4.0], "yahoo"),
    }
    monkeypatch.setattr(history_domain, "get_series", lambda symbol, *a, **k: series[symbol])
    r = client.get("/v2/panel?symbols=A,B")
    assert r.status_code == 404
    assert "no comparten ninguna fecha" in r.json()["error"]["message"]


def test_panel_no_mezcla_monedas(client, monkeypatch) -> None:
    series = {
        "A": history_domain.PriceSeries("A", "MXN", "1d", [D1], [1.0], "yahoo"),
        "B": history_domain.PriceSeries("B", "USD", "1d", [D1], [2.0], "yahoo"),
    }
    monkeypatch.setattr(history_domain, "get_series", lambda symbol, *a, **k: series[symbol])
    r = client.get("/v2/panel?symbols=A,B&ccy=native")
    assert r.status_code == 400
    assert "monedas distintas" in r.json()["error"]["message"]


def test_panel_real_alinea_mexico_y_estados_unidos(client) -> None:
    body = client.get("/v2/panel?symbols=WALMEX.MX,AAPL&range=1y&interval=1d&ccy=MXN").json()
    panel = schemas.PanelResponse.model_validate(body)
    assert panel.currency == "MXN"
    assert set(panel.prices) == {"WALMEX.MX", "AAPL"}
    assert len(panel.dates) == len(panel.prices["AAPL"]) == len(panel.prices["WALMEX.MX"])
    assert panel.dates == sorted(panel.dates)
    assert panel.dropped == []
    # Los calendarios de la BMV y de Nueva York no coinciden: el cruce tiene que perder fechas.
    assert len(panel.dates) < 252
    assert any("fechas comunes" in nota for nota in panel.meta.notes)
