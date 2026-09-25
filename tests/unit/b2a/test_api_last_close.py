"""``marketStatus.<bolsa>.lastClose``: la fecha de la última jornada ya cerrada (pedido F2-7a).

F2 armaba "Cierre vie 18 sep" con el ``asOf`` más nuevo del grupo, que depende de que Yahoo haya
contestado. ``lastClose`` sale del calendario de cada bolsa, en su zona, así que llega aunque el
grupo venga vacío. La jornada de hoy no cuenta mientras la bolsa siga abierta.
"""

from __future__ import annotations

import datetime as _dt

import pytest

from kaizen_api import schemas
from kaizen_api.domain import market_calendar as cal

UTC = _dt.UTC


@pytest.mark.parametrize(
    "instante,bmv,nyse",
    [
        # Martes 22 de septiembre, las dos abiertas: la última cerrada es la del lunes.
        (_dt.datetime(2026, 9, 22, 14, 51, 31, tzinfo=UTC), "2026-09-21", "2026-09-21"),
        # Viernes 18 después del cierre de las dos: ya cuenta la de hoy.
        (_dt.datetime(2026, 9, 18, 21, 30, tzinfo=UTC), "2026-09-18", "2026-09-18"),
        # Sábado y lunes antes de abrir: la del viernes.
        (_dt.datetime(2026, 9, 19, 18, 0, tzinfo=UTC), "2026-09-18", "2026-09-18"),
        (_dt.datetime(2026, 9, 21, 12, 0, tzinfo=UTC), "2026-09-18", "2026-09-18"),
        # 16 de septiembre: la BMV no abre (Independencia) y la NYSE sí.
        (_dt.datetime(2026, 9, 16, 21, 0, tzinfo=UTC), "2026-09-15", "2026-09-16"),
        # Acción de Gracias: la NYSE no abre y la BMV sí.
        (_dt.datetime(2026, 11, 26, 22, 0, tzinfo=UTC), "2026-11-26", "2026-11-25"),
    ],
)
def test_last_close_es_la_ultima_jornada_cerrada_de_cada_bolsa(instante, bmv, nyse) -> None:
    payload, _notes = cal.market_status(instante)
    assert payload["bmv"]["lastClose"] == bmv
    assert payload["nyse"]["lastClose"] == nyse
    schemas.MarketStatus.model_validate(payload)


def test_last_close_es_opcional_para_un_api_anterior() -> None:
    viejo = {"open": False, "label": "Cerrada.", "nextOpen": None, "nextClose": None}
    assert schemas.ExchangeStatus.model_validate(viejo).lastClose is None
    with pytest.raises(ValueError):
        schemas.ExchangeStatus.model_validate({**viejo, "lastClose": "18/09/2026"})


def test_la_ruta_publica_last_close(client) -> None:
    r = client.get("/v2/markets/overview")
    assert r.status_code == 200, r.text
    body = schemas.MarketsOverviewResponse.model_validate(r.json())
    assert body.marketStatus.bmv.lastClose == "2026-09-21"
    assert body.marketStatus.nyse.lastClose == "2026-09-21"
