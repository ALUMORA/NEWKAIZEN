"""Tipo de cambio v2: conversión con el FX de la misma fecha, relleno acotado y cero valores fijos.

El defecto que estas pruebas cuidan es el del backend viejo: cuando Yahoo fallaba devolvía
``{"USDMXN": 17.5, "fallback": True}`` y el frontend lo pintaba como si fuera cotización. En v2 no
existe ese camino: o hay dato real o hay 503.
"""

from __future__ import annotations

import datetime as _dt

import pytest

from kaizen_api.domain import fx as fx_domain
from kaizen_api.errors import ApiError
from kaizen_api.providers import banxico

RATES = {"2026-09-14": 18.0, "2026-09-15": 18.1, "2026-09-18": 18.4}


def test_convertir_a_la_misma_moneda_devuelve_lo_mismo() -> None:
    assert fx_domain.convert(123.45, "MXN", "mxn") == 123.45
    assert fx_domain.convert(7, "USD", "USD") == 7


def test_aplicar_el_tipo_de_cambio_en_las_dos_direcciones() -> None:
    assert fx_domain.apply_rate(100.0, 18.0, "USD", "MXN") == 1800.0
    assert fx_domain.apply_rate(1800.0, 18.0, "MXN", "USD") == 100.0


def test_un_par_que_no_es_usd_mxn_sale_con_400() -> None:
    with pytest.raises(ApiError) as excinfo:
        fx_domain.convert(100, "EUR", "MXN")
    assert excinfo.value.status == 400
    assert excinfo.value.code == "BAD_REQUEST"
    assert "USDMXN" in excinfo.value.message


def test_el_relleno_hacia_adelante_llega_a_tres_dias_y_ni_uno_mas() -> None:
    assert fx_domain.rate_on(RATES, "2026-09-15") == (18.1, 0)
    assert fx_domain.rate_on(RATES, "2026-09-16") == (18.1, 1)
    assert fx_domain.rate_on(RATES, "2026-09-17") == (18.1, 2)
    assert fx_domain.rate_on(RATES, "2026-09-21") == (18.4, 3)
    assert fx_domain.rate_on(RATES, "2026-09-22") == (None, 0)


def test_la_respuesta_del_sie_se_normaliza_a_fechas_iso() -> None:
    raw = {
        "bmx": {
            "series": [
                {
                    "idSerie": "SF43718",
                    "datos": [
                        {"fecha": "18/09/2026", "dato": "18.4010"},
                        {"fecha": "21/09/2026", "dato": "N/E"},
                        {"fecha": "22/09/2026", "dato": "18,3500"},
                    ],
                }
            ]
        }
    }
    assert fx_domain._parse_banxico(raw) == [("2026-09-18", 18.401), ("2026-09-22", 18.35)]


def test_sin_token_de_banxico_no_se_intenta_el_sie() -> None:
    """``require_token`` levanta 503 NOT_CONFIGURED y la capa de FX se va al respaldo sin romperse."""
    with pytest.raises(ApiError) as excinfo:
        banxico.fetch_series([banxico.SERIES_FIX])
    assert excinfo.value.status == 503 and excinfo.value.code == "NOT_CONFIGURED"
    assert fx_domain._banxico_points(None, None) == []


def test_si_la_costura_de_banxico_todavia_no_existe_el_fx_sigue_trabajando(monkeypatch) -> None:
    def _todavia_no(series_ids, start=None, end=None):
        raise NotImplementedError("la implementa B2b")

    monkeypatch.setattr(banxico, "fetch_series", _todavia_no)
    assert fx_domain._banxico_points(None, None) == []


def test_con_el_fix_de_banxico_el_spot_deja_de_ser_sustituto(monkeypatch) -> None:
    def _fake(series_ids, start=None, end=None):
        assert series_ids == [banxico.SERIES_FIX]
        return {"bmx": {"series": [{"datos": [{"fecha": "22/09/2026", "dato": "18.3500"}]}]}}

    monkeypatch.setattr(banxico, "fetch_series", _fake)
    monkeypatch.setattr(fx_domain, "_today", lambda: _dt.date(2026, 9, 22))
    quote = fx_domain._spot_fresh()
    assert quote.rate == 18.35
    assert quote.source == fx_domain.BANXICO_FIX_SOURCE
    assert quote.fallback is False and quote.stale is False
    assert quote.notes == []


def test_un_fix_viejo_sale_marcado_como_rancio(monkeypatch) -> None:
    def _fake(series_ids, start=None, end=None):
        return {"bmx": {"series": [{"datos": [{"fecha": "10/09/2026", "dato": "18.0000"}]}]}}

    monkeypatch.setattr(banxico, "fetch_series", _fake)
    monkeypatch.setattr(fx_domain, "_today", lambda: _dt.date(2026, 9, 22))
    assert fx_domain._spot_fresh().stale is True


def test_sin_ninguna_fuente_real_es_503_y_nunca_17_5(monkeypatch) -> None:
    monkeypatch.setattr(fx_domain, "_banxico_points", lambda *a, **k: [])
    monkeypatch.setattr(fx_domain, "_yahoo_points", lambda *a, **k: [])
    with pytest.raises(ApiError) as excinfo:
        fx_domain._spot_fresh()
    assert excinfo.value.status == 503 and excinfo.value.code == "UPSTREAM_UNAVAILABLE"
    with pytest.raises(ApiError):
        fx_domain.daily_range(_dt.date(2026, 9, 1), _dt.date(2026, 9, 22))


def test_el_periodo_de_yahoo_es_el_mas_corto_que_cubre_el_tramo() -> None:
    assert fx_domain._period_for_span(20) == "1mo"
    assert fx_domain._period_for_span(31) == "1mo"
    assert fx_domain._period_for_span(32) == "3mo"
    assert fx_domain._period_for_span(365) == "1y"
    assert fx_domain._period_for_span(400) == "2y"
    assert fx_domain._period_for_span(5000) == "max"


def test_el_spot_grabado_es_real_y_viene_marcado_como_sustituto(b2a_replay) -> None:
    quote = fx_domain.spot()
    assert quote.source == fx_domain.YAHOO_SOURCE
    assert quote.fallback is True
    assert quote.as_of == "2026-09-22"
    assert 10 < quote.rate < 30 and quote.rate != 17.5
    assert quote.notes and "FIX" in quote.notes[0]


def test_la_serie_diaria_grabada_respeta_el_rango_pedido(b2a_replay) -> None:
    series = fx_domain.daily_range(_dt.date(2026, 9, 14), _dt.date(2026, 9, 22))
    assert series.dates[0] >= "2026-09-14" and series.dates[-1] <= "2026-09-22"
    assert series.dates == sorted(series.dates)
    assert len(series.dates) == len(series.values)
    assert all(10 < v < 30 for v in series.values)
    assert series.source == fx_domain.YAHOO_SOURCE and series.fallback is True


def test_convertir_una_serie_de_pandas_usa_el_fx_de_cada_fecha(b2a_replay) -> None:
    import pandas as pd

    dates = pd.to_datetime(["2026-09-14", "2026-09-15", "2026-09-16"])
    serie = pd.Series([100.0, 100.0, 100.0], index=dates, name="precio")
    convertida = fx_domain.convert(serie, "USD", "MXN")
    crudo = fx_domain.daily_range(_dt.date(2026, 9, 14), _dt.date(2026, 9, 16)).as_map()
    for stamp, value in convertida.items():
        rate, _ = fx_domain.rate_on(crudo, stamp.date().isoformat())
        assert value == pytest.approx(100.0 * rate)


def _fix_falso(dias: dict[str, float]):
    """Costura de Banxico de mentiras, con la forma cruda del SIE."""

    def _fake(series_ids, start=None, end=None):
        datos = [{"fecha": _dt.date.fromisoformat(d).strftime("%d/%m/%Y"), "dato": f"{v:.4f}"} for d, v in dias.items()]
        return {"bmx": {"series": [{"idSerie": banxico.SERIES_FIX, "datos": datos}]}}

    return _fake


def test_con_el_fix_la_serie_diaria_deja_de_ser_sustituta(monkeypatch) -> None:
    monkeypatch.setattr(banxico, "fetch_series", _fix_falso(RATES))
    series = fx_domain.daily_range(_dt.date(2026, 9, 14), _dt.date(2026, 9, 18))
    assert series.source == fx_domain.BANXICO_FIX_SOURCE
    assert series.fallback is False and series.notes == []
    assert series.dates == ["2026-09-14", "2026-09-15", "2026-09-18"]
    assert series.values == [18.0, 18.1, 18.4]


def test_el_rango_recorta_lo_que_el_sie_manda_de_mas(monkeypatch) -> None:
    monkeypatch.setattr(banxico, "fetch_series", _fix_falso(RATES))
    series = fx_domain.daily_range(_dt.date(2026, 9, 15), _dt.date(2026, 9, 15))
    assert series.dates == ["2026-09-15"] and series.values == [18.1]


def test_la_conversion_diaria_prefiere_el_fix_sobre_yahoo(monkeypatch) -> None:
    monkeypatch.setattr(banxico, "fetch_series", _fix_falso(RATES))
    monkeypatch.setattr(fx_domain, "_today", lambda: _dt.date(2026, 9, 22))
    series = fx_domain.series_for("1mo", "1d")
    assert series.source == fx_domain.BANXICO_FIX_SOURCE
    assert series.fallback is False


def test_la_conversion_semanal_se_queda_en_yahoo(monkeypatch) -> None:
    """El SIE publica el FIX diario; para barras semanales se usa la serie semanal de Yahoo."""
    monkeypatch.setattr(banxico, "fetch_series", _fix_falso(RATES))
    monkeypatch.setattr(fx_domain, "_yahoo_points", lambda period, interval="1d": [("2026-09-14", 18.0)])
    series = fx_domain.series_for("1y", "1wk")
    assert series.source == fx_domain.YAHOO_SOURCE and series.fallback is True
