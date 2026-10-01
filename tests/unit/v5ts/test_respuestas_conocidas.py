"""Pruebas de respuesta conocida del centro de tasas, una por cada caso de la spec de la fase 5.

Las cifras las recalculó el orquestador (``docs/overhaul/specs/fase5-spec.md``, sección
centro-de-tasas). Son aritmética pura o usan proveedores simulados: no salen a la red.
"""

from __future__ import annotations

import datetime as _dt

import pytest

from kaizen_api.domain import curves, expectations, money_market
from kaizen_api.providers import banxico, treasury
from kaizen_api.settings import Settings, configure

HOY = _dt.date(2026, 10, 1)


def test_diferencial_10a_bono_m_contra_tesoro_da_409_pb():
    assert curves.spread_bp(0.0935, 0.0526) == 409


def test_inflacion_implicita_mexico_20a_fisher_y_simple():
    assert curves.fisher(0.0964, 0.0461) == pytest.approx(0.048083, abs=1e-6)
    assert curves.simple_bp(0.0964, 0.0461) == 503


def test_inflacion_implicita_eeuu_10a_con_la_curva_del_tesoro():
    assert curves.fisher(0.0529, 0.0293) == pytest.approx(0.022928, abs=1e-6)
    assert curves.simple_bp(0.0529, 0.0293) == 236


def test_forward_cetes_act360_de_28_a_91_dias():
    assert expectations.forward_act360(0.07, 28, 0.072, 91) == pytest.approx(0.072494, abs=1e-6)


def test_conversion_cmt_a_act360():
    assert expectations.cmt_to_act360(0.0425) == pytest.approx(0.041918, abs=1e-6)


def test_cambio_semanal_de_la_tiie_91_en_pb():
    assert money_market.change_bp(0.068134, 0.069000) == pytest.approx(-8.66, abs=1e-9)
    serie = {"dates": ["2026-09-24", "2026-09-30", "2026-10-01"], "values": [0.069, 0.0682, 0.068134]}
    assert money_market.changes(serie)["change1wBp"] == pytest.approx(-8.66, abs=1e-9)


def test_fechas_distintas_bono_m_20a_contra_tesoro_20a():
    row = curves.spread_row(20, "SF45384", "TSY-PAR-20Y", ("2026-08-27", 0.0964), ("2026-09-30", 0.0568))
    assert row["dateGapDays"] == 34
    assert row["asOfMismatch"] is True
    assert curves.spread_row(10, "a", "b", ("2026-09-24", 0.09), ("2026-09-30", 0.05))["asOfMismatch"] is False


def test_tasa_real_de_cetes():
    assert expectations.real_rate(0.07, 0.04) == pytest.approx(0.028846, abs=1e-6)


def test_ano_de_la_encuesta():
    assert expectations.survey_years("2026-12-01", _dt.date(2027, 1, 15)) == (2026, 2027)
    assert expectations.survey_years("2027-01-01", _dt.date(2027, 1, 15)) == (2027, 2028)


def test_valor_del_sie_por_ciento_a_fraccion_y_n_e_a_none():
    assert curves.sie_percent("9.35") == pytest.approx(0.0935)
    assert curves.sie_percent("N/E") is None


def test_fecha_del_csv_del_tesoro_se_normaliza_y_queda_ascendente():
    texto = 'Date,"10 Yr","20 Yr"\n09/30/2026,5.29,5.68\n09/29/2026,5.31,N/A\n'
    data = treasury.parse_csv(texto)
    assert data["dates"] == ["2026-09-29", "2026-09-30"]
    assert data["columns"]["10 Yr"] == [pytest.approx(0.0531), pytest.approx(0.0529)]
    assert data["columns"]["20 Yr"] == [None, pytest.approx(0.0568)]


# ─── con el SIE simulado ─────────────────────────────────────────────────────


def _sie_simulado(monkeypatch, datos: dict[str, list[tuple[str, str]]]):
    """SIE falso: cada id devuelve sus ``(fecha dd/mm/aaaa, dato)``; todas las series pasan el candado."""
    configure(Settings.from_env({"BANXICO_TOKEN": "token-falso"}))
    monkeypatch.setattr(banxico, "verification", lambda ids: dict.fromkeys(ids, []))

    def _get(path: str) -> dict:
        ids = path.split("/series/")[1].split("/")[0].split(",")
        series = [
            {"idSerie": sid, "titulo": sid, "datos": [{"fecha": f, "dato": d} for f, d in datos.get(sid, [])]}
            for sid in ids
        ]
        return {"bmx": {"series": series}}

    monkeypatch.setattr(banxico, "_get", _get)


@pytest.fixture
def sin_estado():
    from kaizen_api import reset_state

    reset_state()
    yield
    configure(None)
    reset_state()


def test_un_n_e_del_sie_sale_s_d_y_nunca_cero(monkeypatch, sin_estado):
    _sie_simulado(
        monkeypatch,
        {
            "SF44071": [("20/09/2026", "9.35")],
            "SF45384": [("27/08/2026", "N/E")],
        },
    )
    monkeypatch.setattr(curves.fred, "fetch_series", lambda sid: {"dates": [], "values": []})
    data = curves.get_curves("mx", [], HOY)
    nodos = {n["seriesId"]: n for n in data["nodes"]}
    assert nodos["SF44071"]["value"] == pytest.approx(0.0935)
    assert nodos["SF45384"]["value"] is None and nodos["SF45384"]["asOf"] is None
    assert data["fallback"] is False


def test_serie_de_la_encuesta_sin_verificar_sale_s_d(monkeypatch, sin_estado):
    encuesta = banxico.extra_group("encuesta")
    _sie_simulado(monkeypatch, {sid: [("01/09/2026", "3.85")] for sid in encuesta})
    revisado = banxico.reviewed
    monkeypatch.setattr(banxico, "reviewed", lambda sid: False if sid == "SR14146" else revisado(sid))
    monkeypatch.setattr(curves.fred, "fetch_series", lambda sid: {"dates": [], "values": []})
    data = expectations.get_expectations(HOY)
    item = next(i for i in data["survey"]["items"] if i["id"] == "inflationT1")
    assert item["median"] is None
    assert item["verified"] is False
    assert item["mean"] == pytest.approx(0.0385)
    assert item["year"] == 2027 and data["survey"]["yearT"] == 2026
    assert any("SR14146" in n for n in data["notes"])
