"""Frescura de los datos: ``meta.stale`` se calcula, no se afirma.

El contrato dice que ``stale`` significa "el dato es más viejo de lo esperado para su clase". Un
``False`` fijo es exactamente el valor silencioso que el contrato prohíbe: afirma frescura sin
haberla medido. Aquí se fija el reloj y se exige la respuesta exacta en cada caso.

Hay dos reglas y cada una se prueba aparte:

* Con calendario de la bolsa (BMV o NYSE) y barras diarias: está vieja si le falta una jornada que
  ya cerró. La jornada de hoy no cuenta mientras el mercado siga abierto.
* Sin calendario (Tokio, cripto, divisas) o con barras semanales o mensuales: tolerancia en días
  naturales.
"""

from __future__ import annotations

import datetime as _dt
from zoneinfo import ZoneInfo

import pytest

from kaizen_api.domain import fx as fx_domain
from kaizen_api.domain import history as history_domain
from kaizen_api.domain import market_calendar as cal
from kaizen_api.domain import markets as markets_domain
from kaizen_api.domain import search as search_domain

CDMX = ZoneInfo("America/Mexico_City")
NY = ZoneInfo("America/New_York")
UTC = _dt.UTC


# ─── la última jornada que ya cerró ──────────────────────────────────────────


@pytest.mark.parametrize(
    ("exchange", "now", "esperada"),
    [
        # Martes 22 con el mercado abierto: la barra de hoy se está formando, así que la última
        # jornada cerrada es la del lunes 21.
        ("bmv", _dt.datetime(2026, 9, 22, 9, 51, tzinfo=CDMX), _dt.date(2026, 9, 21)),
        ("nyse", _dt.datetime(2026, 9, 22, 10, 51, tzinfo=NY), _dt.date(2026, 9, 21)),
        # Ya cerrada la sesión del día, hoy sí cuenta.
        ("bmv", _dt.datetime(2026, 9, 22, 15, 30, tzinfo=CDMX), _dt.date(2026, 9, 22)),
        ("nyse", _dt.datetime(2026, 9, 22, 16, 30, tzinfo=NY), _dt.date(2026, 9, 22)),
        # Justo en la campana de cierre ya cuenta como cerrada.
        ("bmv", _dt.datetime(2026, 9, 22, 15, 0, tzinfo=CDMX), _dt.date(2026, 9, 22)),
        # 16 de septiembre es feriado en la BMV: el 17 en la mañana la última cerrada es el 15.
        ("bmv", _dt.datetime(2026, 9, 17, 10, 0, tzinfo=CDMX), _dt.date(2026, 9, 15)),
        # 7 de septiembre es Labor Day en Nueva York: el 8 en la mañana la última es el viernes 4.
        ("nyse", _dt.datetime(2026, 9, 8, 10, 0, tzinfo=NY), _dt.date(2026, 9, 4)),
        # Domingo: la última cerrada es el viernes anterior en las dos bolsas.
        ("bmv", _dt.datetime(2026, 9, 20, 12, 0, tzinfo=CDMX), _dt.date(2026, 9, 18)),
        ("nyse", _dt.datetime(2026, 9, 20, 12, 0, tzinfo=NY), _dt.date(2026, 9, 18)),
    ],
)
def test_ultima_jornada_cerrada(exchange: str, now: _dt.datetime, esperada: _dt.date) -> None:
    assert cal.last_completed_session(exchange, now) == esperada


def test_la_jornada_recortada_cierra_a_su_hora() -> None:
    """Un día de cierre adelantado ya cuenta como cerrado a esa hora, no a la hora normal."""
    calendar = cal.load_calendar("nyse")
    early = sorted(calendar.get("earlyCloses", {}))
    if not early:
        pytest.skip("El calendario de la NYSE no declara cierres adelantados")
    day = _dt.date.fromisoformat(early[0])
    hours = cal.session(calendar, day)
    assert hours is not None
    close = hours[1]
    assert close < cal._hhmm(calendar["regularHours"]["close"])
    justo_despues = _dt.datetime.combine(day, close, tzinfo=NY) + _dt.timedelta(minutes=1)
    assert cal.last_completed_session("nyse", justo_despues) == day


# ─── a qué calendario pertenece cada símbolo ─────────────────────────────────


@pytest.mark.parametrize(
    ("symbol", "esperada"),
    [
        ("WALMEX.MX", "bmv"),
        ("NAFTRAC.MX", "bmv"),
        ("FUNO11.MX", "bmv"),
        ("^MXX", "bmv"),
        ("AAPL", "nyse"),
        ("SPY", "nyse"),
        ("^GSPC", "nyse"),
        ("^DJI", "nyse"),
        # De estos no afirmamos calendario: no tenemos el de Tokio ni el de las cripto.
        ("^N225", None),
        ("BTC-USD", None),
        ("MXN=X", None),
        ("CL=F", None),
    ],
)
def test_bolsa_de_cada_simbolo(symbol: str, esperada: str | None) -> None:
    assert history_domain.exchange_for(symbol) == esperada


# ─── la regla de las series de precios ───────────────────────────────────────

ABIERTO_22 = _dt.datetime(2026, 9, 22, 14, 51, tzinfo=UTC)
"""El mismo instante del reloj congelado de los fixtures: BMV y NYSE abiertas."""


@pytest.mark.parametrize(
    ("symbol", "ultima", "esperado"),
    [
        # Le falta el lunes 21, que ya cerró.
        ("NAFTRAC.MX", "2026-09-18", True),
        ("WALMEX.MX", "2026-09-17", True),
        # Está al día: trae la última jornada cerrada, o incluso la de hoy en curso.
        ("WALMEX.MX", "2026-09-21", False),
        ("WALMEX.MX", "2026-09-22", False),
        ("AAPL", "2026-09-21", False),
        ("AAPL", "2026-09-22", False),
        ("AAPL", "2026-09-18", True),
        # Sin calendario se usa la tolerancia en días naturales.
        ("BTC-USD", "2026-09-21", False),
        ("BTC-USD", "2026-09-17", True),
        ("^N225", "2026-09-18", False),
    ],
)
def test_serie_diaria_vieja(symbol: str, ultima: str, esperado: bool) -> None:
    assert history_domain.is_stale(symbol, ultima, "1d", ABIERTO_22) is esperado


def test_las_barras_semanales_no_se_miden_contra_la_jornada() -> None:
    """La barra semanal en curso lleva la fecha del lunes, así que el calendario diario no aplica."""
    assert history_domain.is_stale("WALMEX.MX", "2026-09-14", "1wk", ABIERTO_22) is False
    assert history_domain.is_stale("WALMEX.MX", "2026-09-01", "1wk", ABIERTO_22) is True
    assert history_domain.is_stale("WALMEX.MX", "2026-08-31", "1mo", ABIERTO_22) is False
    assert history_domain.is_stale("WALMEX.MX", "2026-07-15", "1mo", ABIERTO_22) is True


def test_sin_fecha_no_se_inventa_frescura() -> None:
    assert history_domain.is_stale("AAPL", None, "1d", ABIERTO_22) is False


# ─── tipo de cambio, canasta de mercados y directorio ────────────────────────


def test_serie_de_tipo_de_cambio_vieja() -> None:
    al_dia = fx_domain.FxSeries(["2026-09-21"], [17.2], fx_domain.YAHOO_SOURCE, True, [])
    puente = fx_domain.FxSeries(["2026-09-18"], [17.2], fx_domain.BANXICO_FIX_SOURCE, False, [])
    vieja = fx_domain.FxSeries(["2026-09-10"], [17.2], fx_domain.BANXICO_FIX_SOURCE, False, [])
    hoy = _dt.date(2026, 9, 22)
    assert fx_domain.series_is_stale(al_dia, hoy) is False
    assert fx_domain.series_is_stale(puente, hoy) is False
    assert fx_domain.series_is_stale(vieja, hoy) is True
    assert fx_domain.series_is_stale(fx_domain.FxSeries([], [], "yahoo", True, []), hoy) is True


def test_canasta_de_mercados_vieja() -> None:
    assert markets_domain.basket_is_stale("2026-09-22", ABIERTO_22) is False
    assert markets_domain.basket_is_stale("2026-09-18", ABIERTO_22) is False
    assert markets_domain.basket_is_stale("2026-09-01", ABIERTO_22) is True
    assert markets_domain.basket_is_stale(None, ABIERTO_22) is True


def test_la_lista_curada_de_mexico_esta_al_dia() -> None:
    """Hoy no está vieja, y se marca sola cuando pase el semestre sin revisarla."""
    curada = _dt.date.fromisoformat(search_domain.curated_as_of()[:10])
    assert search_domain.curated_is_stale(ABIERTO_22) is False
    tarde = _dt.datetime.combine(
        curada + _dt.timedelta(days=search_domain.CURATED_STALE_DAYS + 1), _dt.time(12), tzinfo=UTC
    )
    assert search_domain.curated_is_stale(tarde) is True


# ─── lo que sale por las rutas ───────────────────────────────────────────────


def test_la_ruta_marca_vieja_la_serie_que_viene_atrasada(client) -> None:
    """NAFTRAC.MX grabado termina el 18 y el reloj está en el 22: la ruta tiene que decirlo."""
    body = client.get("/v2/history/NAFTRAC.MX", params={"range": "1y"}).json()
    assert body["meta"]["asOf"] == "2026-09-18"
    assert body["meta"]["stale"] is True


def test_la_ruta_no_marca_vieja_la_serie_al_dia(client) -> None:
    body = client.get("/v2/history/WALMEX.MX", params={"range": "1mo"}).json()
    assert body["meta"]["asOf"] == "2026-09-22"
    assert body["meta"]["stale"] is False


def test_el_panel_nombra_a_los_que_vienen_atrasados(client) -> None:
    body = client.get("/v2/panel", params={"symbols": "NAFTRAC.MX,WALMEX.MX", "range": "1y"}).json()
    assert body["meta"]["stale"] is True
    assert any("NAFTRAC.MX" in note and "atrasados" in note for note in body["meta"]["notes"])


def test_el_panel_al_dia_no_se_marca(client) -> None:
    body = client.get("/v2/panel", params={"symbols": "AAPL,WALMEX.MX", "range": "1mo"}).json()
    assert body["meta"]["stale"] is False
    assert not any("atrasados" in note for note in body["meta"]["notes"])
