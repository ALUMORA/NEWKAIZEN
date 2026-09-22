"""La costura ``domain.history.get_series``: fechas reales, cierres ajustados y conversión por fecha.

Es la pieza que arregla el defecto de fondo del backend viejo. ``/chart`` devolvía una lista de
precios SIN fechas, así que el frontend alineaba dos series por posición en el arreglo: bastaba un
día inhábil en México que sí fuera hábil en Nueva York para que todos los rendimientos siguientes
quedaran corridos un renglón. Aquí cada cierre trae su fecha y la conversión usa el tipo de cambio
de esa misma fecha.
"""

from __future__ import annotations

import pytest

from kaizen_api.domain import fx as fx_domain
from kaizen_api.domain import history
from kaizen_api.errors import ApiError
from kaizen_api.providers.yahoo import prices


def test_el_ipc_cotiza_en_pesos(b2a_replay) -> None:
    """El backend viejo etiquetaba ``^MXX`` en dólares porque deducía la moneda del sufijo."""
    series = history.get_series("^MXX", "5y", "1wk", "native")
    assert series.currency == "MXN"
    assert series.fx_pair is None and series.fx_source is None
    assert series.notes == []


def test_una_serie_trae_fechas_iso_en_orden_y_del_mismo_largo(b2a_replay) -> None:
    series = history.get_series("^MXX", "5y", "1wk", "native")
    assert len(series.dates) == len(series.close) == 262
    assert series.dates == sorted(series.dates)
    assert len(set(series.dates)) == len(series.dates)
    assert series.dates[0] == "2021-09-20" and series.dates[-1] == "2026-09-21"
    assert series.as_of == series.dates[-1]
    assert series.adjusted is True
    assert all(isinstance(d, str) and len(d) == 10 for d in series.dates)


def test_convertir_a_pesos_multiplica_por_el_fx_de_la_misma_fecha(b2a_replay) -> None:
    dates, closes = prices.fetch_series("AAPL", "1y", "1d")
    fx_dates, fx_values = prices.fetch_series("MXN=X", "1y", "1d")
    rates = dict(zip(fx_dates, fx_values, strict=True))

    series = history.get_series("AAPL", "1y", "1d", "MXN")
    assert series.currency == "MXN"
    assert series.fx_pair == "USDMXN" and series.fx_source == "yahoo"
    assert series.close[-1] == pytest.approx(340.3157958984375 * 17.297130584716797)

    by_date = dict(zip(series.dates, series.close, strict=True))
    for date in series.dates:
        assert by_date[date] == pytest.approx(dict(zip(dates, closes, strict=True))[date] * rates[date])


def test_convertir_a_dolares_divide_por_el_fx_de_la_misma_fecha(b2a_replay) -> None:
    series = history.get_series("WALMEX.MX", "1y", "1d", "USD")
    assert series.currency == "USD"
    assert series.close[-1] == pytest.approx(45.34000015258789 / 17.297130584716797)


def test_pedir_la_moneda_nativa_no_toca_la_serie(b2a_replay) -> None:
    nativa = history.get_series("WALMEX.MX", "1y", "1d", "native")
    misma = history.get_series("WALMEX.MX", "1y", "1d", "MXN")
    assert nativa.currency == misma.currency == "MXN"
    assert nativa.close == misma.close
    assert misma.fx_pair is None


def test_un_simbolo_sin_historico_es_404(b2a_replay) -> None:
    with pytest.raises(ApiError) as excinfo:
        history.get_series("ZZZNOTREAL", "1y", "1d", "native")
    assert excinfo.value.status == 404 and excinfo.value.code == "NOT_FOUND"
    assert "ZZZNOTREAL" in excinfo.value.message


@pytest.mark.parametrize(
    "kwargs,field",
    [
        ({"range": "7y"}, "query.range"),
        ({"interval": "1h"}, "query.interval"),
        ({"ccy": "EUR"}, "query.ccy"),
    ],
)
def test_parametros_fuera_del_contrato_son_422(kwargs, field) -> None:
    with pytest.raises(ApiError) as excinfo:
        history.get_series("AAPL", **kwargs)
    assert excinfo.value.status == 422 and excinfo.value.code == "VALIDATION_ERROR"
    assert excinfo.value.details["fields"][0]["field"] == field


def test_el_hueco_del_fx_se_rellena_hasta_tres_dias_y_lo_que_no_se_omite(monkeypatch) -> None:
    """Respuesta conocida: 4 fechas de precio contra 2 de tipo de cambio."""
    monkeypatch.setattr(
        prices,
        "fetch_series",
        lambda symbol, period, interval: (
            ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-22"],
            [100.0, 100.0, 100.0, 100.0],
        ),
    )
    monkeypatch.setattr(history, "native_currency", lambda symbol: ("USD", False))
    monkeypatch.setattr(
        fx_domain,
        "series_for",
        lambda *args, **kwargs: fx_domain.FxSeries(
            ["2026-09-14", "2026-09-15"], [18.0, 18.1], fx_domain.YAHOO_SOURCE, True, ["aviso del fx"]
        ),
    )

    series = history.get_series("FAKE", "1mo", "1d", "MXN")
    # 14 y 15 tienen tipo de cambio propio; 16 se rellena con el del 15; 22 queda a 7 días y se cae.
    assert series.dates == ["2026-09-14", "2026-09-15", "2026-09-16"]
    assert series.close == pytest.approx([1800.0, 1810.0, 1810.0])
    assert "aviso del fx" in series.notes
    assert any("1 fechas el tipo de cambio venía del día hábil anterior" in n for n in series.notes)
    assert any("Se omitieron 1 fechas" in n for n in series.notes)


def test_sin_ninguna_fecha_convertible_es_503(monkeypatch) -> None:
    monkeypatch.setattr(prices, "fetch_series", lambda *a: (["2026-09-22"], [100.0]))
    monkeypatch.setattr(history, "native_currency", lambda symbol: ("USD", False))
    monkeypatch.setattr(
        fx_domain,
        "series_for",
        lambda *a, **k: fx_domain.FxSeries(["2026-01-05"], [18.0], fx_domain.YAHOO_SOURCE, True, []),
    )
    with pytest.raises(ApiError) as excinfo:
        history.get_series("FAKE", "1mo", "1d", "MXN")
    assert excinfo.value.status == 503 and excinfo.value.code == "UPSTREAM_UNAVAILABLE"


def test_la_moneda_sale_de_yahoo_y_solo_se_infiere_como_ultimo_recurso(b2a_replay, monkeypatch) -> None:
    assert history.native_currency("AAPL") == ("USD", False)
    assert history.native_currency("WALMEX.MX") == ("MXN", False)
    monkeypatch.setattr(prices, "fetch_info", lambda symbol: {})
    assert history.native_currency("^MXX") == ("MXN", False)
    assert history.native_currency("ALGO.MX") == ("MXN", True)
    assert history.native_currency("BTC-USD") == ("USD", True)


def test_una_moneda_inferida_se_avisa_en_las_notas(b2a_replay, monkeypatch) -> None:
    monkeypatch.setattr(prices, "fetch_info", lambda symbol: {})
    series = history.get_series("WALMEX.MX", "1y", "1d", "native")
    assert series.currency == "MXN"
    assert any("no reporta la moneda" in note for note in series.notes)
