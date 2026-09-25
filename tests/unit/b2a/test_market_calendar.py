"""Calendario de BMV y NYSE: horarios, feriados, jornadas recortadas y el siguiente turno.

Todo se prueba contra instantes concretos, no contra "ahora": el estado de una bolsa es una
función del reloj y de un archivo, así que se puede fijar el reloj y exigir la respuesta exacta.
"""

from __future__ import annotations

import datetime as _dt
from zoneinfo import ZoneInfo

import pytest

from kaizen_api.domain import market_calendar as cal

CDMX = ZoneInfo("America/Mexico_City")
NY = ZoneInfo("America/New_York")


def easter(year: int) -> _dt.date:
    """Domingo de Pascua por el algoritmo gregoriano anónimo (Meeus/Jones/Butcher)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f, g = (b + 8) // 25, 0
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    lam = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * lam) // 451
    month = (h + lam - 7 * m + 114) // 31
    day = ((h + lam - 7 * m + 114) % 31) + 1
    return _dt.date(year, month, day)


@pytest.mark.parametrize("exchange", cal.EXCHANGES)
def test_el_archivo_de_cada_bolsa_es_coherente(exchange: str) -> None:
    calendar = cal.load_calendar(exchange)
    years = set(calendar["years"])
    assert years == {2025, 2026, 2027}
    assert calendar["tradingDays"] == [1, 2, 3, 4, 5]
    for iso in calendar["holidays"]:
        day = _dt.date.fromisoformat(iso)
        assert day.year in years
    for iso in calendar.get("earlyCloses", {}):
        day = _dt.date.fromisoformat(iso)
        assert day.year in years
        assert iso not in calendar["holidays"], f"{iso} no puede ser feriado y jornada recortada a la vez"


def test_la_nyse_nunca_pone_un_feriado_en_fin_de_semana() -> None:
    """Regla 7.2 de la NYSE: sábado se observa el viernes previo y domingo el lunes siguiente."""
    for iso in cal.load_calendar("nyse")["holidays"]:
        assert _dt.date.fromisoformat(iso).weekday() < 5, iso


@pytest.mark.parametrize(
    "exchange,year,offset",
    [("nyse", 2025, 2), ("nyse", 2026, 2), ("nyse", 2027, 2), ("bmv", 2025, 2), ("bmv", 2026, 2), ("bmv", 2027, 2),
     ("bmv", 2025, 3), ("bmv", 2026, 3), ("bmv", 2027, 3)],
)
def test_viernes_y_jueves_santo_caen_donde_dice_la_pascua(exchange: str, year: int, offset: int) -> None:
    """La NYSE cierra el Viernes Santo y la BMV además el Jueves Santo: se derivan de la Pascua."""
    expected = (easter(year) - _dt.timedelta(days=offset)).isoformat()
    assert expected in cal.load_calendar(exchange)["holidays"], (exchange, year, expected)


def test_la_bmv_esta_abierta_a_media_jornada() -> None:
    state = cal.status("bmv", _dt.datetime(2026, 9, 22, 9, 0, tzinfo=CDMX))
    assert state.open is True
    assert state.label == "Abierto. Cierra hoy a las 15:00 h de la Ciudad de México."
    assert state.next_close == "2026-09-22T21:00:00Z"
    assert state.next_open == "2026-09-23T14:30:00Z"


def test_la_bmv_antes_de_abrir_da_la_apertura_de_hoy() -> None:
    state = cal.status("bmv", _dt.datetime(2026, 9, 22, 7, 59, tzinfo=CDMX))
    assert state.open is False
    assert state.next_open == "2026-09-22T14:30:00Z"
    assert "Abre hoy a las 8:30 h" in state.label


def test_el_viernes_por_la_tarde_la_siguiente_jornada_es_el_lunes() -> None:
    state = cal.status("bmv", _dt.datetime(2026, 9, 18, 16, 0, tzinfo=CDMX))
    assert state.open is False
    assert state.next_open == "2026-09-21T14:30:00Z"
    assert state.label.endswith("Abre el lunes 21 de septiembre a las 8:30 h de la Ciudad de México.")


def test_la_bmv_cierra_en_navidad_y_lo_dice() -> None:
    state = cal.status("bmv", _dt.datetime(2026, 12, 25, 10, 0, tzinfo=CDMX))
    assert state.open is False
    assert state.label.startswith("Cerrado por Navidad.")
    assert state.next_open == "2026-12-28T14:30:00Z"


def test_la_nyse_cierra_a_la_una_el_viernes_despues_de_accion_de_gracias() -> None:
    abierta = cal.status("nyse", _dt.datetime(2026, 11, 27, 12, 30, tzinfo=NY))
    assert abierta.open is True
    assert abierta.next_close == "2026-11-27T18:00:00Z"
    assert abierta.label == "Abierto. Cierra hoy a las 13:00 h de Nueva York."
    cerrada = cal.status("nyse", _dt.datetime(2026, 11, 27, 13, 30, tzinfo=NY))
    assert cerrada.open is False
    assert cerrada.next_open == "2026-11-30T14:30:00Z"


def test_el_horario_de_verano_mueve_la_apertura_de_nueva_york_en_utc() -> None:
    """Misma hora local, distinto UTC: en enero son las 14:30 Z y en septiembre las 13:30 Z."""
    invierno = cal.status("nyse", _dt.datetime(2027, 1, 4, 8, 0, tzinfo=NY))
    verano = cal.status("nyse", _dt.datetime(2026, 9, 22, 8, 0, tzinfo=NY))
    assert invierno.next_open == "2027-01-04T14:30:00Z"
    assert verano.next_open == "2026-09-22T13:30:00Z"


# ─── 2025, desde la fuente oficial ───────────────────────────────────────────


@pytest.mark.parametrize("exchange", cal.EXCHANGES)
def test_cada_anio_del_archivo_cita_su_fuente(exchange: str) -> None:
    calendar = cal.load_calendar(exchange)
    fuentes = calendar["fuentes"]
    for year in calendar["years"]:
        assert str(year) in fuentes, f"{exchange} {year} no dice de dónde salió"
        assert "https://" in fuentes[str(year)]


def test_la_nyse_cerro_el_9_de_enero_de_2025_por_el_duelo_nacional_por_carter() -> None:
    state = cal.status("nyse", _dt.datetime(2025, 1, 9, 11, 0, tzinfo=NY))
    assert state.open is False
    assert state.label.startswith("Cerrado por Duelo nacional")
    assert state.next_open == "2025-01-10T14:30:00Z"
    assert state.notes == []
    # Y la frescura no espera la barra del 9: la última jornada cerrada antes del 10 es la del 8.
    assert cal.last_completed_session("nyse", _dt.datetime(2025, 1, 10, 8, 0, tzinfo=NY)) == _dt.date(2025, 1, 8)


def test_la_nyse_cerro_el_4_de_julio_de_2025_y_recorto_el_3() -> None:
    assert cal.status("nyse", _dt.datetime(2025, 7, 4, 11, 0, tzinfo=NY)).open is False
    tres = cal.status("nyse", _dt.datetime(2025, 7, 3, 12, 0, tzinfo=NY))
    assert tres.open is True
    assert tres.next_close == "2025-07-03T17:00:00Z", "13:00 de Nueva York en horario de verano"
    assert cal.status("nyse", _dt.datetime(2025, 12, 24, 13, 30, tzinfo=NY)).open is False


@pytest.mark.parametrize(
    "iso,nombre",
    [("2025-02-03", "Constitución"), ("2025-03-17", "Juárez"), ("2025-04-17", "Jueves Santo"),
     ("2025-11-17", "Revolución"), ("2025-12-12", "Guadalupe")],
)
def test_la_bmv_cerro_los_dias_inhabiles_de_2025(iso: str, nombre: str) -> None:
    day = _dt.date.fromisoformat(iso)
    state = cal.status("bmv", _dt.datetime(day.year, day.month, day.day, 10, 0, tzinfo=CDMX))
    assert state.open is False
    assert nombre in state.label, state.label


def test_la_bmv_abrio_el_lunes_3_de_noviembre_de_2025() -> None:
    """El 2 de noviembre de 2025 cayó domingo: el DOF lo lista, pero no mueve el lunes."""
    state = cal.status("bmv", _dt.datetime(2025, 11, 3, 10, 0, tzinfo=CDMX))
    assert state.open is True


def test_el_aviso_de_cobertura_nombra_el_rango_completo() -> None:
    state = cal.status("nyse", _dt.datetime(2029, 3, 6, 10, 0, tzinfo=NY))
    assert any("de 2025 a 2027" in note for note in state.notes), state.notes


def test_fuera_de_los_anios_del_archivo_se_avisa_en_vez_de_adivinar() -> None:
    state = cal.status("bmv", _dt.datetime(2029, 3, 6, 10, 0, tzinfo=CDMX))
    assert state.open is True
    assert any("2029" in note for note in state.notes)


def test_market_status_entrega_las_dos_bolsas_con_la_forma_del_contrato() -> None:
    payload, notes = cal.market_status(_dt.datetime(2026, 9, 22, 14, 51, 31, tzinfo=_dt.UTC))
    assert set(payload) == {"bmv", "nyse"}
    for state in payload.values():
        assert set(state) == {"open", "label", "nextOpen", "nextClose", "lastClose"}
        assert isinstance(state["open"], bool)
        assert "—" not in state["label"] and "–" not in state["label"]
    assert notes == []
    assert payload["bmv"]["open"] is True and payload["nyse"]["open"] is True
