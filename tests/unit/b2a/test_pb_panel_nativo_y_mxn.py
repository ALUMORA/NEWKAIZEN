"""La receta de docs/api-v2.md para separar efecto precio y efecto tipo de cambio con ``/v2/panel`` (PB).

F1 preguntó si hay una forma preferida de pedir el panel en moneda nativa y en MXN. La que quedó
escrita: un panel en MXN con todo, un panel ``native`` con las emisoras en dólares, cruzar por
fecha y sacar el tipo de cambio implícito como cociente. Estas pruebas comprueban que cada paso de
la receta es cierto contra el servidor, no solo contra el documento, incluido lo que el panel no
da: sus cierres están ajustados por dividendos y no sirven como precio de compra.
"""

from __future__ import annotations

import pytest

from kaizen_api.domain import fx as fx_domain
from kaizen_api.domain import history as history_domain
from kaizen_api.providers.yahoo import prices


def _panel(client, symbols: str, ccy: str) -> dict:
    r = client.get(f"/v2/panel?symbols={symbols}&range=1y&interval=1d&ccy={ccy}")
    assert r.status_code == 200, r.text
    return r.json()


def _por_fecha(panel: dict, symbol: str) -> dict[str, float]:
    return dict(zip(panel["dates"], panel["prices"][symbol], strict=True))


def test_native_con_monedas_mezcladas_es_400_y_por_eso_se_pide_por_moneda(client):
    r = client.get("/v2/panel?symbols=AAPL,WALMEX.MX&range=1y&interval=1d&ccy=native")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "BAD_REQUEST"


def test_los_dos_paneles_no_traen_las_mismas_fechas_y_hay_que_cruzarlas(client):
    en_pesos = _panel(client, "AAPL,WALMEX.MX", "MXN")
    nativo = _panel(client, "AAPL", "native")
    assert en_pesos["currency"] == "MXN" and nativo["currency"] == "USD"
    assert set(en_pesos["dates"]) != set(nativo["dates"]), "si fueran iguales la receta no pediría cruzar"
    assert set(en_pesos["dates"]) & set(nativo["dates"])


def test_el_tipo_de_cambio_implicito_es_exactamente_el_que_uso_el_servidor(client):
    en_pesos = _por_fecha(_panel(client, "AAPL,WALMEX.MX", "MXN"), "AAPL")
    nativo = _por_fecha(_panel(client, "AAPL", "native"), "AAPL")
    tasas = fx_domain.series_for("1y", "1d").as_map()
    comunes = sorted(set(en_pesos) & set(nativo))
    assert len(comunes) > 200
    for fecha in comunes:
        implicito = en_pesos[fecha] / nativo[fecha]
        usado, _ = fx_domain.rate_on(tasas, fecha)
        assert implicito == pytest.approx(usado, rel=1e-12), fecha


def test_una_emisora_en_pesos_sale_igual_en_native_y_en_mxn(client):
    en_pesos = _por_fecha(_panel(client, "AAPL,WALMEX.MX", "MXN"), "WALMEX.MX")
    nativo = _por_fecha(_panel(client, "WALMEX.MX", "native"), "WALMEX.MX")
    for fecha, precio in en_pesos.items():
        assert nativo[fecha] == pytest.approx(precio, rel=1e-12)


def test_efecto_precio_mas_efecto_cambiario_da_el_resultado_en_pesos(client):
    """La misma convención de ``pnlDecomposition`` (src/lib/finance/fx.js): precio a tipo de cambio
    inicial y tipo de cambio a precio final, sin término cruzado suelto."""
    en_pesos = _por_fecha(_panel(client, "AAPL,WALMEX.MX", "MXN"), "AAPL")
    nativo = _por_fecha(_panel(client, "AAPL", "native"), "AAPL")
    comunes = sorted(set(en_pesos) & set(nativo))
    inicio, fin = comunes[0], comunes[-1]
    q = 10
    p0, p1 = nativo[inicio], nativo[fin]
    x0, x1 = en_pesos[inicio] / p0, en_pesos[fin] / p1
    efecto_precio = q * (p1 - p0) * x0
    efecto_cambiario = q * p1 * (x1 - x0)
    total = q * (en_pesos[fin] - en_pesos[inicio])
    assert efecto_precio + efecto_cambiario == pytest.approx(total, rel=1e-12)


def _cierres_de_mercado(symbol: str) -> dict[str, float]:
    """Cierres sin el ajuste por dividendos, reconstruidos del mismo histórico grabado.

    Yahoo ajusta cada cierre anterior a una fecha ex dividendo multiplicándolo por
    ``1 − D / cierre del día previo``. Se deshace hacia atrás con la columna ``Dividends``.
    """
    hist = prices.fetch_history(symbol, "1y", "1d")
    ajustados = [float(v) for v in hist["Close"].tolist()]
    dividendos = [float(v) for v in hist["Dividends"].tolist()]
    fechas = [d.date().isoformat() for d in hist.index.tz_localize(None).normalize()]
    mercado = ajustados[:]
    factor = 1.0
    for i in range(len(ajustados) - 1, -1, -1):
        mercado[i] = ajustados[i] / factor
        if dividendos[i] > 0 and i > 0:
            factor *= 1 - dividendos[i] / (ajustados[i - 1] / factor)
    return dict(zip(fechas, mercado, strict=True))


@pytest.mark.parametrize("symbol", ["AAPL", "WALMEX.MX"])
def test_el_panel_viene_ajustado_por_dividendos_y_su_primer_cierre_no_es_un_costo(client, symbol):
    """Lo que dice la receta: el primer cierre del panel queda por debajo del precio al que de verdad
    cotizó la emisora, porque hubo dividendos en la ventana. Usarlo como ``price0`` de una posición
    mete esos dividendos al efecto precio. El último cierre no tiene ajuste por delante: ese sí es
    el de mercado y sirve como ``price1``."""
    panel = _por_fecha(_panel(client, symbol, "native"), symbol)
    mercado = _cierres_de_mercado(symbol)
    fechas = sorted(panel)
    primero, ultimo = fechas[0], fechas[-1]
    assert panel[primero] < mercado[primero] * (1 - 1e-3), (panel[primero], mercado[primero])
    assert panel[ultimo] == pytest.approx(mercado[ultimo], rel=1e-12)


def test_los_numeros_de_aapl_que_cita_la_receta(client):
    panel = _por_fecha(_panel(client, "AAPL", "native"), "AAPL")
    mercado = _cierres_de_mercado("AAPL")
    primero = sorted(panel)[0]
    assert primero == "2025-09-22"
    assert round(panel[primero], 2) == 255.14
    assert round(mercado[primero], 2) == 256.08


def test_una_emisora_fuera_de_dolares_y_pesos_sale_en_dropped_del_panel_en_pesos(client, monkeypatch):
    """El servidor solo convierte USDMXN. Una emisora en euros no tiene precio en pesos, así que no hay
    tipo de cambio que sacar, aunque su panel nativo sí responda."""
    serie_original = prices.fetch_series
    moneda_original = history_domain.native_currency

    def serie(symbol, period, interval):
        if symbol == "SAP.DE":
            fechas, cierres = serie_original("AAPL", period, interval)
            return fechas, [c / 1.5 for c in cierres]
        return serie_original(symbol, period, interval)

    def moneda(symbol):
        return ("EUR", False) if symbol == "SAP.DE" else moneda_original(symbol)

    monkeypatch.setattr(prices, "fetch_series", serie)
    monkeypatch.setattr(history_domain, "native_currency", moneda)
    en_pesos = _panel(client, "AAPL,SAP.DE", "MXN")
    assert list(en_pesos["prices"]) == ["AAPL"]
    assert [d["symbol"] for d in en_pesos["dropped"]] == ["SAP.DE"]
    assert "USDMXN" in en_pesos["dropped"][0]["reason"]
    assert _panel(client, "SAP.DE", "native")["currency"] == "EUR"
