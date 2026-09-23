"""Correcciones de la primera revisión de B3c (docs/overhaul/notas/fase2-revision-b3.md, sección B3c).

Cada prueba nombra el punto de la revisión que cierra. Todas fallaban antes del arreglo.
"""

from __future__ import annotations

import datetime as dt
import math

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from kaizen_api import cache
from kaizen_api.domain import rates
from kaizen_api.domain.screeners import factors as F
from kaizen_api.domain.screeners import fibras as FB
from kaizen_api.domain.screeners import magic as M
from kaizen_api.domain.universe import EMPTY_INFO, row_value
from kaizen_api.main import create_app
from kaizen_api.routers import screeners
from kaizen_api.settings import Settings
from tests.unit.b3c import fakes
from tests.unit.b3c.test_fibras import balance as fibra_balance
from tests.unit.b3c.test_fibras import fibra
from tests.unit.b3c.test_magic import balance as magic_balance
from tests.unit.b3c.test_magic import emisora

HOY = dt.date(2026, 9, 22)
AÑOS = ["2025-12-31", "2024-12-31"]
VIEJOS = ["2023-12-31", "2022-12-31"]

# El payload de la revisión: el balance de Banco Invex que Yahoo sirve para FMTY14 y FHIPO14.
INVEX = {"Total Assets": 156_249e6, "Total Debt": 5_234e6, "Ordinary Shares Number": 967_740_599.0,
         "Stockholders Equity": 8_660e6, "Cash And Cash Equivalents": 10e9}


@pytest.fixture(autouse=True)
def _limpio(monkeypatch):
    cache.reset_state()
    monkeypatch.setattr(FB, "_today", lambda: HOY)
    for name in FB.RF_FUNCTIONS:
        monkeypatch.delattr(rates, name, raising=False)
    monkeypatch.setattr(FB, "get_dividends", lambda sym: {"ttm": None, "yield": None, "history": []})
    yield
    cache.reset_state()


def _invex(dates=VIEJOS):
    return fakes.frame({k: [v, v] for k, v in INVEX.items()}, dates)


def _tabla(monkeypatch, datos, rate=None):
    monkeypatch.setattr(FB, "fetch_symbols", lambda syms, **kw: ({s: datos[s] for s in syms if s in datos}, []))
    from tests.unit.b3c.test_fibras import fakes_universe

    monkeypatch.setattr(FB, "get_fibras_universe", lambda: fakes_universe(datos))
    if rate is not None:
        monkeypatch.setattr(rates, "get_rf_series", lambda *a, **k: rate, raising=False)
    return FB.build()


def _fila(tabla, sym):
    return next(r for r in tabla["rows"] if r["symbol"] == sym)


# ─── punto 1 [blocker]: estados ajenos y viejos ──────────────────────────────


def test_p1_estados_de_hace_mas_de_18_meses_no_se_publican(monkeypatch):
    data = fibra("VIEJA.MX")
    data.balance = fibra_balance()
    data.balance.columns = [pd.Timestamp(d) for d in VIEJOS]
    tabla = _tabla(monkeypatch, {"VIEJA.MX": data})
    fila = _fila(tabla, "VIEJA.MX")
    assert fila["ltv"] is None
    assert fila["capRate"] is None
    assert fila["debtToMarketCap"] is None
    assert fila["cashFlowYield"] is None
    assert any("VIEJA.MX" in n and "18 meses" in n for n in tabla["notes"])


def test_p1_el_balance_del_fiduciario_en_dos_fibras_se_descarta_en_las_dos(monkeypatch):
    """FMTY14 y FHIPO14 traen el mismo balance de Banco Invex: ltv 0.0335 idéntico en las dos."""
    fmty = fibra("FMTY14.MX", sharesOutstanding=0, impliedSharesOutstanding=2_485_280_000,
                 totalDebt=38_063_472_640.0, industry="Banks - Regional", sector="Financial Services")
    fhipo = fibra("FHIPO14.MX", sharesOutstanding=4_804_828_304, totalDebt=5_251_163_136.0,
                  industry="Banks - Regional", sector="Financial Services")
    for d in (fmty, fhipo):
        d.balance = _invex()
        d.cashflow = fakes.frame({"Operating Cash Flow": [-1.97e9, 1e9]}, VIEJOS)
        d.income = fakes.frame({"Operating Income": [3e9, 2e9]}, VIEJOS)
    tabla = _tabla(monkeypatch, {"FMTY14.MX": fmty, "FHIPO14.MX": fhipo})
    for sym in ("FMTY14.MX", "FHIPO14.MX"):
        fila = _fila(tabla, sym)
        assert fila["ltv"] is None, sym
        assert fila["cashFlowYield"] is None, sym
        assert fila["capRate"] is None, sym
        assert fila["debtToMarketCap"] is None, sym
    texto = " ".join(tabla["notes"])
    assert "FMTY14.MX" in texto and "FHIPO14.MX" in texto
    assert "fiduciario" in texto


def test_p1_industria_de_banco_delata_al_fiduciario_aunque_el_estado_sea_reciente(monkeypatch):
    data = fibra("BANCO.MX", industry="Banks - Regional")
    tabla = _tabla(monkeypatch, {"BANCO.MX": data})
    assert _fila(tabla, "BANCO.MX")["ltv"] is None


def test_p1_cbfis_que_no_cuadran_con_yahoo_descartan_el_estado(monkeypatch):
    data = fibra("OTRA.MX", sharesOutstanding=4_804_828_304)
    data.balance = fibra_balance(**{"Ordinary Shares Number": 967_740_599.0})
    tabla = _tabla(monkeypatch, {"OTRA.MX": data})
    assert _fila(tabla, "OTRA.MX")["ltv"] is None
    assert any("OTRA.MX" in n and "CBFI" in n for n in tabla["notes"])


def test_p1_deuda_mil_veces_menor_que_la_de_yahoo_no_da_ltv(monkeypatch):
    """DANHOS13: 11,710,529 en el balance contra 11.58 mil M del info daba ltv 0.000146."""
    data = fibra("DANHOS13.MX", totalDebt=11_579_153_408.0)
    data.balance = fibra_balance(**{"Total Debt": 11_710_529.0, "Total Assets": 80_148_261_966.0})
    tabla = _tabla(monkeypatch, {"DANHOS13.MX": data})
    fila = _fila(tabla, "DANHOS13.MX")
    assert fila["ltv"] is None
    assert fila["debtToMarketCap"] is None
    assert fila["capRate"] is None
    # El flujo no depende de la deuda: se queda.
    assert fila["cashFlowYield"] == pytest.approx(80 / 500)
    assert any("DANHOS13.MX" in n and "deuda" in n for n in tabla["notes"])


def test_p1_una_fibra_sana_conserva_sus_metricas(monkeypatch):
    data = fibra("SANA.MX", sharesOutstanding=1_000.0, totalDebt=360.0)
    data.balance = fibra_balance(**{"Ordinary Shares Number": 1_010.0})
    tabla = _tabla(monkeypatch, {"SANA.MX": data})
    assert _fila(tabla, "SANA.MX")["ltv"] == pytest.approx(0.35)


# ─── punto 2 [major]: la tasa de FRED no son CETES ───────────────────────────

RF_FRED = {
    "tenorDays": 91,
    "dates": ["2026-07-01", "2026-08-01"],
    "values": [0.0681, 0.0679],
    "source": "fred_ir3tib",
    "fallback": True,
    "asOf": "2026-08-01",
    "stale": False,
    "notes": [
        "Falta el token de Banxico (BANXICO_TOKEN) para servir CETES del SIE.",
        "Respaldo: serie interbancaria de México a 3 meses de la OCDE en FRED, mensual. No son CETES de 28 días.",
    ],
}


def test_p2_la_tasa_de_fred_se_publica_como_sustituto_con_su_fuente_y_su_nota(monkeypatch):
    tabla = _tabla(monkeypatch, {"FUNO11.MX": fibra()}, rate=RF_FRED)
    assert tabla["cetes28"] == pytest.approx(0.0679)
    assert tabla["rateSource"] == "fred"
    assert tabla["rateFallback"] is True
    texto = " ".join(tabla["notes"])
    assert "No son CETES" in texto
    assert "91 días" in texto


def test_p2_la_ruta_agrega_fred_a_la_fuente(monkeypatch):
    monkeypatch.setattr(FB, "fetch_symbols", lambda syms, **kw: ({s: fibra(s) for s in syms}, []))
    monkeypatch.setattr(rates, "get_rf_series", lambda *a, **k: RF_FRED, raising=False)
    client = TestClient(create_app(Settings.from_env({"KAIZEN_ENV": "development", "AUTH_REQUIRED": "false"})))
    body = client.get("/v2/screeners/fibras").json()
    assert body["meta"]["source"] == "yahoo,computed,fred"
    assert body["meta"]["fallback"] is True
    assert any("No son CETES" in n for n in body["meta"]["notes"])


# ─── punto 3 [major]: distribuciones pagadas, no el dividendYield de Yahoo ───


def test_p3_el_rendimiento_sale_de_los_pagos_de_12_meses(monkeypatch):
    """FUNO: Yahoo publica 8.71 %; los pagos de 12 meses dan 0.085954, que es lo que dice /dividends."""
    monkeypatch.setattr(FB, "get_dividends", lambda sym: {"ttm": 2.5348, "yield": 0.085954, "history": [{}]})
    tabla = _tabla(monkeypatch, {"FUNO11.MX": fibra(dividendYield=8.71)})
    assert _fila(tabla, "FUNO11.MX")["distributionYield"] == pytest.approx(0.085954)


def test_p3_sin_historia_de_pagos_el_rendimiento_va_en_nulo_y_se_dice(monkeypatch):
    def falla(sym):
        raise RuntimeError("Yahoo no contestó")

    monkeypatch.setattr(FB, "get_dividends", falla)
    tabla = _tabla(monkeypatch, {"FUNO11.MX": fibra(dividendYield=8.71)}, rate=RF_FRED)
    fila = _fila(tabla, "FUNO11.MX")
    assert fila["distributionYield"] is None
    assert fila["spreadVsCetes"] is None
    assert any("FUNO11.MX" in n and "historia de pagos" in n for n in tabla["notes"])
    # Nunca de regreso al dividendYield de Yahoo, que va hacia adelante.
    assert fila["distributionYield"] != pytest.approx(0.0871)


# ─── punto 5 y nota de A5: utilidad de operación, EBIT ≤ 0 y FIBRAs ──────────


def _magic(monkeypatch, universo, datos):
    monkeypatch.setattr(M, "fetch_symbols", lambda syms, **kw: ({s: datos[s] for s in syms if s in datos}, []))
    return M.build(universo)


def test_p5_prefiere_la_utilidad_de_operacion_sobre_el_renglon_ebit(monkeypatch):
    """CMCSA: EBIT de Yahoo 30.2 mil M contra utilidad de operación 20.7 mil M."""
    universo = fakes.universe(("CMCSA", "Comcast", "Communication Services"))
    inc = fakes.frame({"EBIT": [30.2, 28.0], "Operating Income": [20.7, 19.0]}, AÑOS)
    datos = {"CMCSA": fakes.symbol("CMCSA", income=inc, balance=magic_balance(), marketCap=1_000.0)}
    tabla = _magic(monkeypatch, universo, datos)
    assert tabla["rows"][0]["ebit"] == pytest.approx(20.7)


def test_p5_sin_utilidad_de_operacion_usa_ebit_y_lo_anota(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"))
    tabla = _magic(monkeypatch, universo, {"AAA": emisora("AAA", ebit=100.0)})
    assert tabla["rows"][0]["ebit"] == pytest.approx(100.0)
    assert any("AAA" in n and "EBIT" in n for n in tabla["notes"])


def test_a5_ebit_no_positivo_sale_de_la_formula(monkeypatch):
    """APD con el renglón EBIT daba -0.23 mil M y se ordenaba junto a las demás."""
    universo = fakes.universe(("AAA", "A", "Technology"), ("NEG", "Negativa", "Materials"))
    tabla = _magic(monkeypatch, universo, {"AAA": emisora("AAA"), "NEG": emisora("NEG", ebit=-5.0)})
    assert [r["symbol"] for r in tabla["rows"]] == ["AAA"]
    fuera = {e["symbol"]: e["reason"] for e in tabla["excluded"]}
    assert "positiva" in fuera["NEG"]


def test_a5_las_fibras_salen_de_la_formula(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"), ("FUNO11.MX", "Fibra Uno", "Real Estate"))
    tabla = _magic(monkeypatch, universo, {"AAA": emisora("AAA"), "FUNO11.MX": emisora("FUNO11.MX")})
    fuera = {e["symbol"]: e["reason"] for e in tabla["excluded"]}
    assert "Bienes raíces" in fuera["FUNO11.MX"]
    assert [r["symbol"] for r in tabla["rows"]] == ["AAA"]


def test_a5_una_fibra_fuera_del_universo_curado_tambien_sale_por_el_sector_de_yahoo(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"), ("RARA", None, None))
    datos = {"AAA": emisora("AAA"), "RARA": emisora("RARA", info={"sector": "Real Estate"})}
    tabla = _magic(monkeypatch, universo, datos)
    assert "RARA" in {e["symbol"] for e in tabla["excluded"]}


# ─── punto 6 [minor]: row_value no se queda con un NaN ───────────────────────


def test_p6_row_value_sigue_al_siguiente_renglon_si_el_primero_es_nan():
    cols = [pd.Timestamp("2025-12-31"), pd.Timestamp("2024-12-31")]
    inc = pd.DataFrame({cols[0]: [math.nan, 500.0], cols[1]: [400.0, 400.0]}, index=["EBIT", "Operating Income"])
    assert row_value(inc, ("EBIT", "Operating Income")) == pytest.approx(500.0)
    bal = pd.DataFrame(
        {cols[0]: [math.nan, 300.0, 1000.0, 400.0, 200.0, 800.0]},
        index=["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments",
               "Total Debt", "Current Assets", "Current Liabilities", "Net PPE"],
    )
    assert row_value(bal, M.CASH_ROWS) == pytest.approx(300.0)
    assert M.enterprise_value(2000.0, bal) == pytest.approx(2700.0)


# ─── punto 7 [minor]: símbolos que no existen en universo propio ─────────────


def test_p7_universo_propio_con_simbolos_inexistentes_es_404(monkeypatch):
    vacio = lambda syms, **kw: ({s: fakes.symbol(s, error=EMPTY_INFO) for s in syms}, [])  # noqa: E731
    monkeypatch.setattr(F, "fetch_symbols", vacio)
    monkeypatch.setattr(F, "fetch_closes", lambda syms, **kw: {})
    monkeypatch.setattr(screeners, "fetch_symbols", vacio)
    client = TestClient(create_app(Settings.from_env({"KAIZEN_ENV": "development", "AUTH_REQUIRED": "false"})),
                        raise_server_exceptions=False)
    r = client.get("/v2/screeners/factors?universe=custom&symbols=ZZZZ,QQQQX")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"
    assert "ZZZZ" in r.json()["error"]["message"]


def test_p7_si_yahoo_esta_caido_sigue_siendo_503(monkeypatch):
    caido = lambda syms, **kw: ({s: fakes.symbol(s, error="HTTP 500") for s in syms}, [])  # noqa: E731
    monkeypatch.setattr(F, "fetch_symbols", caido)
    monkeypatch.setattr(F, "fetch_closes", lambda syms, **kw: {})
    monkeypatch.setattr(screeners, "fetch_symbols", caido)
    client = TestClient(create_app(Settings.from_env({"KAIZEN_ENV": "development", "AUTH_REQUIRED": "false"})),
                        raise_server_exceptions=False)
    r = client.get("/v2/screeners/factors?universe=custom&symbols=AAPL")
    assert r.status_code == 503


# ─── punto 8 [minor]: meta.asOf es el dato más nuevo ─────────────────────────

LUNES = 1790087560  # 2026-09-22 14:32:40 UTC, el regularMarketTime de FUNO11.MX en el replay


def test_p8_fibras_fecha_la_tabla_con_el_precio_no_con_la_tasa(monkeypatch):
    tabla = _tabla(monkeypatch, {"FUNO11.MX": fibra(regularMarketTime=LUNES)}, rate=RF_FRED)
    assert tabla["asOf"] == "2026-09-22"


def test_p8_la_formula_magica_fecha_la_tabla_con_el_precio(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"))
    tabla = _magic(monkeypatch, universo, {"AAA": emisora("AAA", info={"regularMarketTime": LUNES})})
    assert tabla["asOf"] == "2026-09-22"
    assert any("2025-12-31" in n for n in tabla["notes"])

