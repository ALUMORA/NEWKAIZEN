"""Los defectos que la revisión independiente encontró en B2a, cada uno con su prueba.

Todo lo de aquí falla contra el código anterior a la corrección. Son cinco cosas distintas: barras
de días cerrados publicadas como observaciones reales, la conversión de series que perdía sus
primeros puntos, las unidades menores de Londres y Johannesburgo sin normalizar, un rango futuro
que culpaba al proveedor, y la frescura por calendario que no alcanzaba a los tickers con clase de
acción.
"""

from __future__ import annotations

import datetime as _dt

import pandas as pd
import pytest

from kaizen_api.domain import fx as fx_domain
from kaizen_api.domain import history
from kaizen_api.errors import ApiError
from kaizen_api.providers.yahoo import prices
from kaizen_api.routers import quotes as quotes_router

# ─── Barras de días en que la bolsa no operó ─────────────────────────────────

CERRADOS_BMV = ("2026-02-02", "2026-03-16", "2026-04-02", "2026-05-01", "2026-09-16")
"""Días inhábiles de la BMV que Yahoo servía con el cierre anterior repetido en NAFTRAC.MX."""


def test_el_historico_no_publica_barras_de_dias_inhabiles_de_la_bmv(b2a_replay) -> None:
    series = history.get_series("NAFTRAC.MX", "1y", "1d", "native")
    assert [d for d in CERRADOS_BMV if d in series.dates] == []
    assert any("no" in n and "operó" in n for n in series.notes), series.notes


def test_el_historico_dice_cuantas_barras_descarto_y_por_que(b2a_replay) -> None:
    series = history.get_series("NAFTRAC.MX", "1y", "1d", "native")
    nota = next(n for n in series.notes if "descartaron" in n)
    assert "5 barras" in nota and "cierre anterior repetido" in nota


def test_descartar_no_deja_rendimientos_diarios_de_cero_inventados(b2a_replay) -> None:
    """Cada fecha quitada metía un rendimiento de 0.00% que nadie operó y que bajaba la volatilidad.

    Se mide sobre 2026, que es el tramo que el calendario cubre. Antes de 2026 quedan dos cierres
    repetidos (2025-11-17 y 2025-12-12) que el archivo de días inhábiles todavía no alcanza, y por
    eso la serie lo dice en sus notas en vez de callarlo.
    """
    series = history.get_series("NAFTRAC.MX", "1y", "1d", "native")
    puntos = list(zip(series.dates, series.close, strict=True))
    ceros = [b for (_, va), (b, vb) in zip(puntos, puntos[1:], strict=False) if va == vb and b >= "2026-01-01"]
    assert ceros == []
    assert any("solo se verificaron fines de semana" in n for n in series.notes)


def test_un_simbolo_de_estados_unidos_no_pierde_ninguna_barra(b2a_replay) -> None:
    """AAPL no trae barras el 7 de septiembre ni el 3 de abril, así que el filtro no toca nada."""
    series = history.get_series("AAPL", "1y", "1d", "native")
    assert not any("descartaron" in n for n in series.notes)
    assert len(series.dates) == len(prices.fetch_series("AAPL", "1y", "1d")[0])


# ─── La costura convert() con series ─────────────────────────────────────────


def test_convertir_una_serie_no_pierde_sus_primeros_puntos(b2a_replay) -> None:
    """El 1 de enero no tiene barra de FX; el contrato dice rellenar hacia atrás, no descartar."""
    fechas = ["2026-01-01", "2026-01-02", "2026-01-05"]
    serie = pd.Series([100.0, 101.0, 102.0], index=pd.Index([_dt.date.fromisoformat(d) for d in fechas]))
    convertida = fx_domain.convert(serie, "USD", "MXN")
    assert len(convertida) == 3
    assert [d.isoformat() for d in convertida.index] == fechas


def test_el_primer_punto_usa_el_tipo_de_cambio_arrastrado_del_dia_habil_anterior(b2a_replay) -> None:
    serie = pd.Series([100.0], index=pd.Index([_dt.date(2026, 1, 1)]))
    convertida = fx_domain.convert(serie, "USD", "MXN")
    esperado = fx_domain._rate_for_date("2026-01-01")
    assert float(convertida.iloc[0]) == pytest.approx(100.0 * esperado)


# ─── Unidades menores: GBp y ZAc ─────────────────────────────────────────────


def test_las_unidades_menores_se_normalizan_a_su_moneda_mayor() -> None:
    assert prices.normalize_currency("GBp") == ("GBP", 100.0)
    assert prices.normalize_currency("ZAc") == ("ZAR", 100.0)
    assert prices.normalize_currency("MXN") == ("MXN", 1.0)
    # Idempotente: un código ya normalizado no se vuelve a dividir.
    assert prices.normalize_currency("GBP") == ("GBP", 1.0)


def test_una_cotizacion_en_peniques_no_sale_como_libras() -> None:
    info = {
        "currency": "GBp",
        "regularMarketPrice": 7420.0,
        "regularMarketPreviousClose": 7400.0,
        "shortName": "Vodafone Group Plc",
        "quoteType": "EQUITY",
    }
    quote = quotes_router._quote("VOD.L", info)
    assert quote["currency"] == "GBP"
    assert quote["price"] == pytest.approx(74.20)
    assert quote["previousClose"] == pytest.approx(74.00)
    assert quote["change"] == pytest.approx(0.20)


def test_el_info_normalizado_deja_el_divisor_a_la_vista() -> None:
    normalizado = prices.normalize_info({"currency": "ZAc", "regularMarketPrice": 25000.0})
    assert normalizado["currency"] == "ZAR"
    assert normalizado["regularMarketPrice"] == pytest.approx(250.0)
    assert normalizado[prices.DIVISOR_KEY] == 100.0


def test_el_historico_en_peniques_se_divide_igual_que_el_precio(monkeypatch) -> None:
    info = prices.normalize_info({"currency": "GBp", "regularMarketPrice": 7420.0})
    monkeypatch.setattr(prices, "fetch_info", lambda symbol: info)
    monkeypatch.setattr(prices, "fetch_series", lambda *a, **k: (["2026-09-21", "2026-09-22"], [7400.0, 7420.0]))
    series = history.get_series("VOD.L", "1mo", "1d", "native")
    assert series.currency == "GBP"
    assert series.close == pytest.approx([74.0, 74.2])
    assert any("unidad menor" in n for n in series.notes)


# ─── Rango de fechas en el futuro ────────────────────────────────────────────


def test_un_rango_entero_en_el_futuro_es_error_de_la_solicitud(b2a_replay) -> None:
    with pytest.raises(ApiError) as excinfo:
        fx_domain.daily_range(_dt.date(2030, 1, 1), _dt.date(2030, 12, 31))
    assert excinfo.value.status == 422
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert "todavía no ocurre" in excinfo.value.message
    assert "más tarde" not in excinfo.value.message


def test_la_ruta_de_fx_historico_contesta_422_a_un_rango_futuro(client) -> None:
    response = client.get("/v2/fx/history", params={"start": "2030-01-01", "end": "2030-12-31"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


# ─── Frescura de tickers con clase de acción ─────────────────────────────────


def test_los_tickers_con_clase_de_accion_se_miden_contra_el_calendario_de_la_nyse() -> None:
    assert history.exchange_for("BRK-B") == "nyse"
    assert history.exchange_for("BF-B") == "nyse"
    assert history.exchange_for("BTC-USD") is None
    assert history.exchange_for("WALMEX.MX") == "bmv"


def test_una_serie_de_brk_b_a_la_que_le_falta_una_jornada_sale_atrasada() -> None:
    ahora = _dt.datetime(2026, 9, 22, 15, 0, tzinfo=_dt.UTC)  # 11:00 en Nueva York, mercado abierto
    assert history.is_stale("BRK-B", "2026-09-18", "1d", ahora) is True
    assert history.is_stale("BRK-B", "2026-09-21", "1d", ahora) is False


# ─── La barra de hoy, que todavía se está formando ───────────────────────────


def test_la_serie_de_yahoo_avisa_que_el_ultimo_punto_todavia_se_mueve(b2a_replay) -> None:
    serie = fx_domain.daily_range(_dt.date(2026, 8, 25), None)
    assert serie.dates[-1] == "2026-09-22"
    assert any("todavía se está formando" in n for n in serie.notes), serie.notes
