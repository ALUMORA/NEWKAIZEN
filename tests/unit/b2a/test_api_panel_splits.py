"""``/v2/panel?adjust=splits``: cierres ajustados solo por splits (pedido F1-4).

El libro de F1 suma el efectivo de cada dividendo, y los cierres del API ya venían ajustados por
dividendos: el TWR contaba el pago dos veces. Con ``adjust=splits`` el servidor deshace el ajuste
por dividendos con la columna ``Dividends`` de la MISMA descarga de Yahoo; el replay falla si hiciera
falta otra llamada al proveedor.
"""

from __future__ import annotations

import pytest

from kaizen_api import schemas
from kaizen_api.domain import history as history_domain
from kaizen_api.providers.yahoo import prices

FECHAS = ["2026-09-14", "2026-09-15", "2026-09-17", "2026-09-18", "2026-09-21"]


def _ajustados_como_yahoo(crudos: list[float], pagos: dict[int, float]) -> list[float]:
    """Lo que hace Yahoo: cada cierre anterior a la fecha ex por ``1 - D / cierre previo``."""
    out = list(crudos)
    for ex, pago in pagos.items():
        factor = 1 - pago / crudos[ex - 1]
        for i in range(ex):
            out[i] *= factor
    return out


def test_respuesta_conocida_recupera_los_cierres_sin_dividendos() -> None:
    crudos = [100.0, 102.0, 98.0, 99.0, 101.0]
    pagos = {2: 2.0, 4: 1.0}
    ajustados = _ajustados_como_yahoo(crudos, pagos)
    assert ajustados[0] == pytest.approx(100 * (1 - 1 / 99) * (1 - 2 / 102))
    recuperados, usados = history_domain.undo_dividend_adjustment(
        FECHAS, ajustados, {FECHAS[i]: d for i, d in pagos.items()}
    )
    assert usados == 2
    assert recuperados == pytest.approx(crudos, rel=1e-12)


def test_sin_pagos_no_cambia_nada_y_un_pago_en_la_primera_barra_no_se_puede_deshacer() -> None:
    cierres = [10.0, 11.0, 12.0]
    assert history_domain.undo_dividend_adjustment(FECHAS[:3], cierres, {}) == (cierres, 0)
    assert history_domain.undo_dividend_adjustment(FECHAS[:3], cierres, {FECHAS[0]: 0.5}) == (cierres, 0)


def test_la_columna_dividends_sale_de_la_misma_descarga(b2a_replay) -> None:
    pagos = prices.fetch_dividends("AAPL", "1y", "1d")
    assert pagos, "el histórico grabado de AAPL a un año trae pagos"
    assert all(len(f) == 10 and 0 < d < 5 for f, d in pagos.items())


def test_el_panel_con_adjust_splits_quita_solo_el_ajuste_por_dividendos(client) -> None:
    base = "/v2/panel?symbols=AAPL&range=1y&interval=1d&ccy=native"
    total = schemas.PanelResponse.model_validate(client.get(base).json())
    r = client.get(base + "&adjust=splits")
    assert r.status_code == 200, r.text
    solo = schemas.PanelResponse.model_validate(r.json())
    assert total.adjustment == "total" and solo.adjustment == "splits"
    assert solo.dates == total.dates
    a, s = total.prices["AAPL"], solo.prices["AAPL"]
    assert s[-1] == pytest.approx(a[-1]), "después del último pago no hay nada que deshacer"
    assert s[0] > a[0], "antes de un pago el cierre sin ajustar es mayor"
    # Lo que se deshace es del orden del rendimiento por dividendo de un año (AAPL paga menos de 1 %).
    assert 0 < s[0] / a[0] - 1 < 0.01
    assert any("solo por splits" in n for n in solo.meta.notes)
    assert all(x >= y - 1e-9 for x, y in zip(s, a, strict=True))


def test_adjust_invalido_es_422(client) -> None:
    r = client.get("/v2/panel?symbols=AAPL&adjust=dividendos")
    assert r.status_code == 422
    assert schemas.ErrorBody.model_validate(r.json()).error.code == "VALIDATION_ERROR"


def test_un_api_anterior_sin_adjustment_se_lee_como_total() -> None:
    viejo = {"currency": "MXN", "interval": "1d", "dates": [], "prices": {}, "dropped": [], "meta": {
        "asOf": None, "source": "yahoo", "delayMinutes": None, "stale": False, "fallback": False,
        "generatedAt": "2026-09-22T14:51:31Z", "notes": []}}
    assert schemas.PanelResponse.model_validate(viejo).adjustment == "total"
