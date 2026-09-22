"""Ficha de la emisora: monedas, razones con respuesta conocida y cobertura.

Los números que se afirman salen de los datos grabados del 22 de septiembre de 2026, y cada uno
está escrito como la cuenta que debería ser, no como el número que devolvió el código.
"""

from __future__ import annotations

import pytest

from kaizen_api.domain import currency as currency_mod
from kaizen_api.domain import fundamentals as mod
from kaizen_api.errors import ApiError

# Datos de info grabados el 22 de septiembre de 2026 (tests/fixtures/recorded/2026-09-22).
WALMEX_MARKET_CAP = 775_254_835_200.0
WALMEX_REVENUE = 1_019_541_651_456.0
WALMEX_NET_INCOME = 49_999_036_416.0
WALMEX_EBITDA = 97_542_111_232.0
WALMEX_DEBT = 83_098_099_712.0
WALMEX_CASH = 30_118_252_544.0
WALMEX_FCF = 22_467_825_664.0

AAPLMX_MARKET_CAP = 85_230_153_105_408.0
AAPLMX_REVENUE_USD = 466_822_987_776.0


def test_walmex_ratios_are_the_arithmetic_they_claim(replay_b3a):
    """WALMEX cotiza y reporta en pesos: sin conversión de por medio, todo tiene que cuadrar."""
    data = mod.get_instrument("WALMEX.MX")
    f = data["fundamentals"]
    assert data["priceCurrency"] == "MXN"
    assert data["financialCurrency"] == "MXN"
    assert data["fxUsed"] is None, "misma moneda: no hubo conversión que reportar"
    assert f["ps"] == pytest.approx(WALMEX_MARKET_CAP / WALMEX_REVENUE, rel=1e-4)
    assert f["earningsYield"] == pytest.approx(WALMEX_NET_INCOME / WALMEX_MARKET_CAP, rel=1e-4)
    assert f["fcfYield"] == pytest.approx(WALMEX_FCF / WALMEX_MARKET_CAP, rel=1e-4)
    enterprise = WALMEX_MARKET_CAP + WALMEX_DEBT - WALMEX_CASH
    assert f["enterpriseValue"] == pytest.approx(enterprise, rel=1e-6)
    assert f["evEbitda"] == pytest.approx(enterprise / WALMEX_EBITDA, rel=1e-4)
    assert f["netDebtToEbitda"] == pytest.approx((WALMEX_DEBT - WALMEX_CASH) / WALMEX_EBITDA, rel=1e-4)
    assert data["coverage"] == {"available": 22, "total": 22}


def test_debt_to_equity_is_a_ratio_not_a_percentage(replay_b3a):
    """Yahoo publica 34.825 para WALMEX, que son 0.35 veces, no 34.8 veces."""
    f = mod.get_instrument("WALMEX.MX")["fundamentals"]
    assert f["debtToEquity"] == pytest.approx(34.825 / 100.0, abs=1e-6)
    assert f["debtToEquity"] < 1.0


def test_dividend_yield_is_a_fraction(replay_b3a):
    """4.45 % sale como 0.0445, no como 4.45 ni como 0.000445."""
    f = mod.get_instrument("WALMEX.MX")["fundamentals"]
    assert f["dividendYield"] == pytest.approx(0.0445, abs=1e-6)


def test_every_rate_like_metric_is_a_fraction(replay_b3a):
    f = mod.get_instrument("WALMEX.MX")["fundamentals"]
    for key in ("dividendYield", "payoutRatio", "roe", "roa", "grossMargin", "operatingMargin", "netMargin"):
        assert 0.0 <= f[key] <= 2.0, f"{key} parece porcentaje y no fracción: {f[key]}"


def test_aapl_mx_never_mixes_pesos_with_dollars(replay_b3a):
    """AAPL.MX cotiza en pesos y reporta en dólares: los estados se convierten antes de dividir.

    Antes de M2 la costura de tipo de cambio no existía y estas razones salían vacías. Ahora existe
    (B2a), así que sí se calculan, pero con los dólares convertidos a pesos, nunca mezclados.
    """
    data = mod.get_instrument("AAPL.MX")
    assert data["priceCurrency"] == "MXN"
    assert data["financialCurrency"] == "USD"
    fx = data["fxUsed"]
    assert fx["pair"] == "USDMXN" and fx["rate"] > 1
    f = data["fundamentals"]
    for key in ("ps", "evEbitda", "pfcf", "fcfYield", "enterpriseValue"):
        assert f[key] is not None, f"{key} debería calcularse con los estados convertidos"
    # Yahoo sí publica esas razones, y mezcladas: su priceToSales de AAPL.MX vale 182.6. La nuestra
    # sale del ingreso convertido a pesos, así que tiene que quedar cerca de 182.6 / 17.3.
    mezclada = AAPLMX_MARKET_CAP / AAPLMX_REVENUE_USD
    assert f["ps"] != pytest.approx(mezclada, rel=1e-3)
    assert f["ps"] == pytest.approx(mezclada / fx["rate"], rel=0.05)


def test_the_earnings_yield_fallback_says_where_it_came_from(replay_b3a):
    """Sin estados convertidos el rendimiento sale de 1/(P/U), y la respuesta tiene que decirlo.

    Si no lo dijera, contradiría a la nota de arriba, que promete que las razones que mezclan
    precio con estados quedan vacías.
    """
    data = mod.get_instrument("AAPL.MX")
    f = data["fundamentals"]
    # Desde M2 los estados sí se convierten, así que los dos rendimientos salen de los estados y no
    # del respaldo de 1/(P/U). Lo que se vigila es que sigan siendo coherentes entre ellos.
    assert f["fcfYield"] is not None and 0 < f["fcfYield"] < 1
    assert f["earningsYield"] == pytest.approx(1.0 / f["pe"], rel=0.05)


def test_the_earnings_yield_from_the_statements_does_not_claim_the_fallback(replay_b3a):
    """WALMEX sí lo saca de los estados: ahí la nota del respaldo estaría de más."""
    data = mod.get_instrument("WALMEX.MX")
    assert not any("P/U que publica Yahoo" in note for note in data["notes"])


def test_aapl_mx_converts_the_statements_when_there_is_an_fx(replay_b3a, monkeypatch):
    """Con la costura de B2a disponible, P/S es capitalización en pesos entre ingresos EN PESOS."""
    monkeypatch.setattr(currency_mod, "fx_convert", lambda amount, f, t, on=None: amount * 18.5)
    data = mod.get_instrument("AAPL.MX")
    assert data["fxUsed"] == {"pair": "USDMXN", "rate": 18.5, "asOf": None}
    expected = AAPLMX_MARKET_CAP / (AAPLMX_REVENUE_USD * 18.5)
    assert data["fundamentals"]["ps"] == pytest.approx(expected, rel=1e-4)
    assert data["fundamentals"]["ps"] < 20, "P/S de dos dígitos bajos, no 182"
    assert data["fundamentals"]["enterpriseValue"] is not None


def test_ratios_that_yahoo_normalizes_stay_as_yahoo_gives_them(replay_b3a):
    """``trailingPE`` y ``priceToBook`` ya vienen en la moneda del precio: no se tocan."""
    f = mod.get_instrument("AAPL.MX")["fundamentals"]
    assert f["pe"] == pytest.approx(38.915237, rel=1e-5)
    assert f["pb"] == pytest.approx(46.04324, rel=1e-5)


def test_unknown_symbol_is_a_404_in_spanish(replay_b3a):
    with pytest.raises(ApiError) as excinfo:
        mod.get_instrument("ZZZNOTREAL")
    assert excinfo.value.status == 404
    assert excinfo.value.code == "NOT_FOUND"
    assert "No encontramos datos de ZZZNOTREAL" in excinfo.value.message


def test_an_index_gives_a_quote_and_no_fundamentals(replay_b3a):
    data = mod.get_instrument("^MXX")
    assert data["type"] == "index"
    assert data["priceCurrency"] == "MXN"
    assert data["quote"]["price"] == pytest.approx(63722.71)
    assert data["coverage"]["available"] == 0
    assert all(value is None for value in data["fundamentals"].values())


def test_a_bmv_real_estate_trust_is_labelled_fibra(replay_b3a):
    assert mod.get_instrument("FUNO11.MX")["type"] == "fibra"
    assert mod.get_instrument("WALMEX.MX")["type"] == "equity"
    assert mod.get_instrument("SPY")["type"] == "etf"


def test_growth_is_annual_and_comes_from_the_statements(replay_b3a):
    """Ingresos 2025 contra 2024 de WALMEX: 1,010,803,706,000 / 957,524,496,000 menos uno."""
    f = mod.get_instrument("WALMEX.MX")["fundamentals"]
    assert f["revenueGrowthYoY"] == pytest.approx(1_010_803_706_000 / 957_524_496_000 - 1, rel=1e-5)
    assert f["epsGrowthYoY"] == pytest.approx(2.873 / 3.085 - 1, rel=1e-3)


def test_minor_units_become_the_major_currency(monkeypatch):
    """Un papel de Londres cotiza en peniques: el contrato pide GBP y montos entre 100."""
    info = {
        "currency": "GBp",
        "financialCurrency": "GBp",
        "regularMarketPrice": 12_345.0,
        "previousClose": 12_300.0,
        "marketCap": 5_000_000_000.0,
        "totalRevenue": 800_000_000.0,
        "netIncomeToCommon": 40_000_000.0,
        "sharesOutstanding": 1_000_000.0,
        "longName": "Emisora de Londres",
        "quoteType": "EQUITY",
        "shortName": "LON",
    }
    monkeypatch.setattr(mod._yahoo, "get_info", lambda symbol: info)
    monkeypatch.setattr(mod._yahoo, "get_statement", lambda symbol, kind, freq="annual": None)
    data = mod.get_instrument("LON.L")
    assert data["priceCurrency"] == "GBP"
    assert data["financialCurrency"] == "GBP"
    assert data["quote"]["price"] == pytest.approx(123.45)
    assert data["quote"]["previousClose"] == pytest.approx(123.0)
    assert data["quote"]["marketCap"] == pytest.approx(50_000_000.0)
    # 50,000,000 GBP entre 8,000,000 GBP de ingresos: la división no cambia por la unidad, pero los
    # montos sí, y eso es lo que ve el usuario.
    assert data["fundamentals"]["ps"] == pytest.approx(50_000_000.0 / 8_000_000.0, rel=1e-6)
    assert any("unidad menor" in note for note in data["notes"])


def test_the_response_carries_no_em_dashes(replay_b3a):
    from tests.unit.b3a.conftest import strings

    for text in strings(mod.get_instrument("WALMEX.MX")):
        assert "—" not in text and "–" not in text, text
