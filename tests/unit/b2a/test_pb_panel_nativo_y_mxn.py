"""La receta de docs/api-v2.md para separar efecto precio y efecto tipo de cambio con ``/v2/panel`` (PB).

F1 preguntó si hay una forma preferida de pedir el panel en moneda nativa y en MXN. La que quedó
escrita: un panel en MXN con todo, un panel ``native`` por cada moneda distinta del peso, cruzar
por fecha y sacar el tipo de cambio implícito como cociente. Estas pruebas comprueban que cada paso
de la receta es cierto contra el servidor, no solo contra el documento.
"""

from __future__ import annotations

import pytest

from kaizen_api.domain import fx as fx_domain


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
