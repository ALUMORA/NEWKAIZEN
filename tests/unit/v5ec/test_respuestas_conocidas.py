"""Pruebas de respuesta conocida de calendario-economico y tablero-economia (spec de la fase 5).

Una prueba por cada caso de la spec, sin red. Las de fecha del 1 de octubre de 2026 pasan ``today``
explícito, porque el reloj del replay es el 22 de septiembre.
"""

from __future__ import annotations

import datetime as dt

import pytest

from kaizen_api.domain import econ_calendar as ec
from kaizen_api.domain import economy
from kaizen_api.providers import banxico, bls, fred, worldbank
from kaizen_api.schemas import EconomicCalendarResponse, MacroIndicator, MacroWorldResponse
from tests.replay import load_module, reset_backend_state

OCT1 = dt.date(2026, 10, 1)


@pytest.fixture(autouse=True)
def _limpio():
    package = load_module("kaizen_api")
    reset_backend_state(package)
    yield
    reset_backend_state(package)


# ─── calendario-economico ────────────────────────────────────────────────────


def test_proxima_decision_de_banxico_desde_el_1_de_octubre():
    nxt = ec.next_decisions(OCT1)["banxico"]
    assert nxt == {"date": "2026-11-05", "daysLeft": 35}
    raw = next(e for e in ec.curated("banxico")["events"] if e["date"] == "2026-11-05")
    assert raw["kind"] == "decision" and raw["time"] == "13:00"


def test_proxima_decision_de_la_fed_es_el_segundo_dia_a_las_12_hora_del_centro():
    assert ec.next_decisions(OCT1)["fed"]["date"] == "2026-10-28"
    raw = next(e for e in ec.curated("fomc")["events"] if e["date"] == "2026-10-28")
    assert raw["meetingStart"] == "2026-10-27"
    assert ec.localize("2026-10-28", "14:00", "America/New_York")[1] == "12:00"


ICS = (
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;TZID=US-Eastern:20261014T083000\r\n"
    "SUMMARY:Consumer Price Index\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\n"
    "DTSTART;TZID=US-Eastern:20261110T083000\r\nSUMMARY:Consumer Price Index\r\nEND:VEVENT\r\n"
    "BEGIN:VEVENT\r\nDTSTART;TZID=US-Eastern:20261002T083000\r\nSUMMARY:Employment Situation\r\n"
    "END:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;TZID=US-Eastern:20261002T100000\r\n"
    "SUMMARY:Metropolitan Area Employment\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
)


def test_cpi_respeta_el_cambio_de_horario_de_eeuu():
    events = {e["date"]: e for e in ec.bls_events(bls.parse_ics(ICS)) if e["title"].startswith("Índice de precios")}
    octubre, noviembre = events["2026-10-14"], events["2026-11-10"]
    assert octubre["timeLocal"] == "06:30" and octubre["datetimeUtc"] == "2026-10-14T12:30:00Z"
    assert noviembre["timeLocal"] == "07:30" and noviembre["datetimeUtc"] == "2026-11-10T13:30:00Z"
    assert octubre["period"] == "sep 2026" and noviembre["period"] == "oct 2026"
    assert octubre["source"] == "bls" and octubre["consensus"] is None


def test_el_ics_del_bls_solo_deja_las_publicaciones_del_tablero():
    titles = [e["title"] for e in ec.bls_events(bls.parse_ics(ICS))]
    assert len(titles) == 3 and not any("Metropolitan" in t for t in titles)


def test_decision_de_banxico_en_utc_para_el_ics():
    """El .ics de la UI usa datetimeUtc: 13:00 hora del centro del 5 nov es DTSTART:20261105T190000Z."""
    assert ec.localize("2026-11-05", "13:00", "America/Mexico_City") == ("2026-11-05", "13:00", "2026-11-05T19:00:00Z")


def test_inflacion_de_eeuu_indice_110_contra_100_da_010():
    serie = {"dates": ["2025-09-01", "2026-08-01", "2026-09-01"], "values": [100.0, 108.0, 110.0]}
    prev, actual = ec.release_values("yoy", serie, "sep 2026", "2026-10-14", dt.date(2026, 10, 20))
    assert actual == pytest.approx(0.10)
    assert prev is None  # falta agosto de 2025


def test_nomina_no_agricola_159075_contra_158953_da_122():
    serie = {"dates": ["2026-08-01", "2026-09-01"], "values": [158953.0, 159075.0]}
    _, actual = ec.release_values("diff", serie, "sep 2026", "2026-10-02", OCT1 + dt.timedelta(days=5))
    assert actual == 122


def test_dato_publicado_no_existe_antes_de_la_fecha():
    serie = {"dates": ["2026-08-01", "2026-09-01"], "values": [158953.0, 159075.0]}
    _, actual = ec.release_values("diff", serie, "sep 2026", "2026-10-02", OCT1)
    assert actual is None


def test_marzo_2027_sin_calendario_de_banxico_no_inventa_eventos(monkeypatch):
    monkeypatch.setattr(banxico, "configured", lambda: False)
    monkeypatch.setattr(bls, "releases", lambda: [])
    monkeypatch.setattr(fred, "fetch_series", lambda sid, *a, **k: {"dates": [], "values": []})
    data = ec.build_calendar(dt.date(2027, 3, 1), dt.date(2027, 3, 31), ["mx", "us"], OCT1)
    assert data["coverage"]["banxicoUntil"] == "2026-12-17"
    ids = [e["id"] for e in data["events"]]
    assert not [i for i in ids if i.startswith("banxico-")]
    assert any("Banxico publicado cubre hasta el 17 de diciembre de 2026" in n for n in data["notes"])
    # INEGI sí publicó su primer semestre de 2027 y la Fed sus reuniones de 2027
    assert any(i.startswith("inegi-") for i in ids) and any(i.startswith("fomc-decision-2027-03-17") for i in ids)
    EconomicCalendarResponse.model_validate({
        "events": data["events"], "coverage": data["coverage"], "nextDecisions": data["nextDecisions"],
        "meta": {"asOf": "2026-10-01", "source": data["source"], "delayMinutes": None, "stale": False,
                 "fallback": False, "generatedAt": "2026-10-01T00:00:00Z", "notes": data["notes"]},
    })


def test_ventana_por_omision():
    lunes = dt.date(2026, 9, 28)
    assert ec.default_window(None, None, OCT1) == (lunes, lunes + dt.timedelta(days=13))
    assert ec.default_window(OCT1, None, OCT1) == (OCT1, dt.date(2026, 10, 14))
    assert ec.default_window(None, OCT1, OCT1) == (dt.date(2026, 9, 18), OCT1)


def test_calendarios_curados_completos_y_sin_huecos():
    bx = ec.curated("banxico")["events"]
    assert [e["date"] for e in bx if e["kind"] == "decision"] == [
        "2026-02-05", "2026-03-26", "2026-05-07", "2026-06-25", "2026-08-06", "2026-09-24", "2026-11-05", "2026-12-17"]
    fomc = [e for e in ec.curated("fomc")["events"] if e["kind"] == "decision"]
    assert len(fomc) == 16 and sum(e["projections"] for e in fomc) == 8
    inegi = ec.curated("inegi")
    assert all(e["time"] == "06:00" for e in inegi["events"])
    assert max(e["date"] for e in inegi["events"]) == inegi["coverageUntil"] == "2027-06-24"


# ─── tablero-economia ────────────────────────────────────────────────────────


def _spec(**kw):
    base = {"id": "inflation", "label": "x", "kind": "rate", "unit": "fraction", "frequency": "monthly",
            "source": "fred", "seriesId": "X", "transform": "pct"}
    base.update(kw)
    return base


def _monthly(n: int, end: str = "2026-08-01") -> list[str]:
    y, m = int(end[:4]), int(end[5:7])
    out = []
    for i in range(n - 1, -1, -1):
        t = y * 12 + m - 1 - i
        out.append(f"{t // 12:04d}-{t % 12 + 1:02d}-01")
    return out


def test_inflacion_anual_de_un_indice():
    dates, values = economy.yoy_series(["2025-08-01", "2026-08-01"], [100.0, 110.0])
    assert dates == ["2026-08-01"] and values == [pytest.approx(0.10)]


def test_sp30578_se_publica_en_fraccion_sin_recalcular():
    item, _ = economy.build_indicator(_spec(source="banxico", seriesId="SP30578"),
                                      {"dates": ["2026-08-01"], "values": [banxico.parse_amount("3.76")]}, "5", OCT1, None)
    assert item["last"]["value"] == pytest.approx(0.0376)
    MacroIndicator.model_validate(item)


def test_desempleo_de_0041_a_0045_cambia_40_pb():
    dates = _monthly(13)
    values = [4.1] + [4.3] * 11 + [4.5]
    item, _ = economy.build_indicator(_spec(id="unemployment"), {"dates": dates, "values": values}, "5", OCT1, None)
    assert item["changeYoYBp"] == pytest.approx(40) and item["changeYoY"] is None
    MacroIndicator.model_validate(item)


def test_pib_trimestral_anualizado():
    assert economy.annualized_qoq(101, 100) == pytest.approx(0.040604)
    dates, values = economy.transform("annualizedQoq", ["2026-01-01", "2026-04-01"], [100.0, 101.0])
    assert values == [pytest.approx(0.040604)]


def test_remesas_quita_la_coma_y_cambian_0090467():
    dates = _monthly(13)
    values = [5000.0] + [5200.0] * 11 + [banxico.parse_amount("5,452.3367")]
    spec = _spec(id="remittances", kind="level", unit="usdMillions", source="banxico", seriesId="SE27803", transform="level")
    item, _ = economy.build_indicator(spec, {"dates": dates, "values": values}, "5", OCT1, None)
    assert item["changeYoY"] == pytest.approx(0.090467) and item["changeYoYBp"] is None
    MacroIndicator.model_validate(item)


def test_pib_de_eeuu_ya_anualizado_no_se_vuelve_a_anualizar():
    raw = fred.parse_csv("observation_date,A191RL1Q225SBEA\n2026-01-01,2.5\n2026-04-01,2.2\n")
    item, _ = economy.build_indicator(_spec(id="gdpGrowth", frequency="quarterly", seriesId="A191RL1Q225SBEA"), raw, "5", OCT1, None)
    assert item["last"] == {"date": "2026-04-01", "value": 0.022}


def test_espejo_ocde_viejo_se_rechaza_con_stale():
    spec = _spec(id="inflation", seriesId="MEXCPIALLMINMEI", transform="pct", oecdMirror=True)
    raw = {"dates": ["2024-12-01", "2025-01-01"], "values": [4.2, 3.6]}
    item, notes = economy.build_indicator(spec, raw, "5", OCT1, None)
    assert item["stale"] is True and item["last"] is None and item["history"]["dates"] == []
    assert notes and "18 meses" in notes[0]
    MacroIndicator.model_validate(item)


def test_banco_mundial_con_null_sale_sin_dato_y_cada_fila_trae_unidad(monkeypatch):
    body = [{"page": 1}, [
        {"countryiso3code": "USA", "country": {"value": "United States"}, "date": "2025", "value": None},
        {"countryiso3code": "MEX", "country": {"value": "Mexico"}, "date": "2025", "value": 3.8067},
        {"countryiso3code": "USA", "country": {"value": "United States"}, "date": "2024", "value": 2.9},
    ]]
    rows = worldbank.parse_rows(body)
    monkeypatch.setattr(worldbank, "indicator", lambda countries, code: rows)
    data = economy.world_rows(["MEX", "USA"], ["inflation"])
    by = {r["country"]: r for r in data["rows"]}
    assert by["USA"]["value"] is None and by["USA"]["year"] == 2025
    assert by["MEX"]["value"] == pytest.approx(0.038067)
    assert all(r["unit"] == "fraction" for r in data["rows"])
    assert "CC BY 4.0" in data["notes"][0]
    MacroWorldResponse.model_validate({"rows": data["rows"], "meta": {
        "asOf": None, "source": "worldbank", "delayMinutes": None, "stale": False, "fallback": False,
        "generatedAt": "2026-10-01T00:00:00Z", "notes": data["notes"]}})
