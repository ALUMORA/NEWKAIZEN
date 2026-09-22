"""Fórmula Mágica v2: valor de empresa completo, capital empleado sin efectivo y empates estables."""

from __future__ import annotations

import pytest

from kaizen_api import cache
from kaizen_api.domain.screeners import magic as M
from tests.unit.b3c import fakes

AÑOS = ["2025-12-31", "2024-12-31"]


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.reset_state()
    yield
    cache.reset_state()


def balance(**over) -> object:
    filas = {
        "Total Assets": [1_000.0, 900.0],
        "Total Debt": [200.0, 180.0],
        "Cash And Cash Equivalents": [50.0, 40.0],
        "Current Assets": [300.0, 280.0],
        "Current Liabilities": [150.0, 140.0],
        "Current Debt": [40.0, 30.0],
        "Net PPE": [500.0, 480.0],
    }
    for clave, valor in over.items():
        filas[clave] = [valor, valor]
    return fakes.frame(filas, AÑOS)


def income(ebit: float = 100.0, label: str = "EBIT") -> object:
    return fakes.frame({label: [ebit, ebit * 0.9], "Total Revenue": [1_000.0, 900.0]}, AÑOS)


def emisora(sym: str, *, ebit: float = 100.0, cap: float = 1_000.0, info=None, **over):
    """``over`` cambia renglones del balance; ``info`` cambia campos del ``info`` de Yahoo."""
    return fakes.symbol(sym, income=income(ebit), balance=balance(**over), marketCap=cap, **(info or {}))


# ─── respuesta conocida ──────────────────────────────────────────────────────


def test_respuesta_conocida_el_orden_es_1_3_2():
    """EY [.10, .08, .12] y ROC [.50, .30, .20] -> la 1, la 3 y la 2, en ese orden."""
    ey = [("A", 0.10), ("B", 0.08), ("C", 0.12)]
    roc = [("A", 0.50), ("B", 0.30), ("C", 0.20)]
    rank_ey = M.competition_ranks(ey)
    rank_roc = M.competition_ranks(roc)
    assert rank_ey == {"C": 1, "A": 2, "B": 3}
    assert rank_roc == {"A": 1, "B": 2, "C": 3}
    suma = {s: rank_ey[s] + rank_roc[s] for s in ("A", "B", "C")}
    assert suma == {"A": 3, "C": 4, "B": 5}
    orden = sorted(suma, key=lambda s: (suma[s], rank_ey[s], s))
    assert orden == ["A", "C", "B"]


def test_los_empates_reciben_el_mismo_lugar_y_el_siguiente_salta():
    """Ranking de competencia 1-2-2-4: el resultado depende del número, no de quién contestó antes."""
    pares = [("A", 0.10), ("B", 0.20), ("C", 0.10), ("D", 0.05)]
    assert M.competition_ranks(pares) == {"B": 1, "A": 2, "C": 2, "D": 4}
    # El mismo conjunto en otro orden da exactamente lo mismo.
    assert M.competition_ranks(list(reversed(pares))) == {"B": 1, "A": 2, "C": 2, "D": 4}


# ─── las dos cuentas ─────────────────────────────────────────────────────────


def test_el_valor_de_empresa_suma_minoritario_y_preferentes_y_resta_efectivo():
    bal = balance()
    bal.loc["Minority Interest"] = [70.0, 60.0]
    bal.loc["Preferred Stock"] = [30.0, 20.0]
    # 1000 + 200 + 70 + 30 - 50
    assert M.enterprise_value(1_000.0, bal) == pytest.approx(1_250.0)


def test_sin_renglon_de_deuda_total_se_suman_largo_y_corto_plazo():
    bal = balance()
    bal = bal.drop(index=["Total Debt"])
    bal.loc["Long Term Debt"] = [160.0, 150.0]
    assert M.enterprise_value(1_000.0, bal) == pytest.approx(1_000.0 + 160.0 + 40.0 - 50.0)


def test_el_capital_empleado_deja_fuera_efectivo_y_deuda_de_corto_plazo():
    """(300 - 50) - (150 - 40) + 500 = 640; con el capital de trabajo simple daría 650."""
    assert M.capital_employed(balance()) == pytest.approx(640.0)


def test_sin_balance_no_hay_capital_ni_valor_de_empresa():
    assert M.capital_employed(None) is None
    assert M.enterprise_value(1_000.0, None) is None


# ─── exclusiones ─────────────────────────────────────────────────────────────


def _build(monkeypatch, universo, datos):
    monkeypatch.setattr(M, "fetch_symbols", lambda syms, **kw: ({s: datos[s] for s in syms if s in datos}, []))
    return M.build(universo)


def test_fuera_bancos_y_servicios_publicos(monkeypatch):
    universo = fakes.universe(
        ("AAA", "A", "Technology"),
        ("BANCO", "Banco", "Financial Services"),
        ("LUZ", "Luz", "Utilities"),
    )
    datos = {m.symbol: emisora(m.symbol) for m in universo.members}
    tabla = _build(monkeypatch, universo, datos)
    fuera = {e["symbol"]: e["reason"] for e in tabla["excluded"]}
    assert set(fuera) == {"BANCO", "LUZ"}
    assert "Servicios financieros" in fuera["BANCO"]
    assert "Servicios públicos" in fuera["LUZ"]
    assert [r["symbol"] for r in tabla["rows"]] == ["AAA"]


def test_sin_ebit_reportado_la_emisora_sale_y_nunca_se_estima(monkeypatch):
    """El legado usaba EBITDA por 0.85 cuando no había EBIT; aquí eso es motivo de exclusión."""
    universo = fakes.universe(("AAA", "A", "Technology"), ("SINEBIT", "Sin EBIT", "Technology"))
    sin_ebit = fakes.symbol(
        "SINEBIT",
        income=fakes.frame({"Total Revenue": [1_000.0, 900.0], "EBITDA": [200.0, 180.0]}, AÑOS),
        balance=balance(),
        marketCap=1_000.0,
        ebitda=200.0,
        enterpriseToEbitda=8.0,
    )
    tabla = _build(monkeypatch, universo, {"AAA": emisora("AAA"), "SINEBIT": sin_ebit})
    fuera = {e["symbol"]: e["reason"] for e in tabla["excluded"]}
    assert "no se estima" in fuera["SINEBIT"]
    assert [r["symbol"] for r in tabla["rows"]] == ["AAA"]


def test_moneda_de_reporte_distinta_a_la_de_cotizacion_excluye(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"), ("CEMEXCPO.MX", "Cemex", "Basic Materials"))
    mixta = fakes.symbol(
        "CEMEXCPO.MX", income=income(), balance=balance(), marketCap=2.5e11,
        currency="MXN", financialCurrency="USD",
    )
    tabla = _build(monkeypatch, universo, {"AAA": emisora("AAA"), "CEMEXCPO.MX": mixta})
    fuera = {e["symbol"]: e["reason"] for e in tabla["excluded"]}
    assert "tipo de cambio" in fuera["CEMEXCPO.MX"]


def test_capital_empleado_no_positivo_excluye(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"), ("NEG", "Neg", "Technology"))
    negativa = fakes.symbol("NEG", income=income(), balance=balance(**{"Net PPE": 0.0, "Current Liabilities": 900.0}), marketCap=1_000.0)
    tabla = _build(monkeypatch, universo, {"AAA": emisora("AAA"), "NEG": negativa})
    fuera = {e["symbol"]: e["reason"] for e in tabla["excluded"]}
    assert "capital empleado no es positivo" in fuera["NEG"]


def test_piso_de_capitalizacion_por_universo(monkeypatch):
    universo = fakes.universe(("CHICA", "Chica", "Technology"), uid="us")
    tabla = _build(monkeypatch, universo, {"CHICA": emisora("CHICA", cap=1e8)})
    assert tabla["rows"] == []
    assert "piso del universo" in tabla["excluded"][0]["reason"]


def test_una_emisora_que_no_respondio_marca_la_tabla_como_parcial(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"), ("MUDA", "Muda", "Technology"))
    tabla = _build(monkeypatch, universo, {"AAA": emisora("AAA"), "MUDA": fakes.symbol("MUDA", error="timeout")})
    assert tabla["partial"] is True
    assert any("proveedor" in e["reason"].lower() for e in tabla["excluded"])


# ─── la tabla ────────────────────────────────────────────────────────────────


def test_la_tabla_publica_fracciones_moneda_y_cierre_fiscal(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"))
    tabla = _build(monkeypatch, universo, {"AAA": emisora("AAA", ebit=100.0, cap=1_000.0)})
    fila = tabla["rows"][0]
    # EV = 1000 + 200 - 50 = 1150; EY = 100/1150; ROC = 100/640
    assert fila["enterpriseValue"] == pytest.approx(1_150.0)
    assert fila["earningsYield"] == pytest.approx(100 / 1_150)
    assert fila["returnOnCapital"] == pytest.approx(100 / 640)
    assert fila["currency"] == "USD"
    assert fila["fiscalPeriodEnd"] == "2025-12-31"
    assert fila["rank"] == fila["rankEY"] + fila["rankROC"]
    assert fila["sector"] == "Tecnología"
    assert tabla["partial"] is False


def test_el_orden_de_la_tabla_es_por_suma_de_lugares(monkeypatch):
    universo = fakes.universe(*[(s, s, "Technology") for s in ("A", "B", "C")])
    # EY: A .10, B .08, C .12 con EV fijo de 1000; ROC: A .50, B .30, C .20.
    datos = {}
    for sym, ebit_ey, capital in (("A", 100.0, 200.0), ("B", 80.0, 266.67), ("C", 120.0, 600.0)):
        bal = balance(**{"Total Debt": 50.0, "Cash And Cash Equivalents": 0.0})
        # Capital empleado = (300 - 0) - (150 - 40) + PPE  ->  PPE para que dé el capital buscado.
        bal.loc["Net PPE"] = [capital - 190.0, capital - 190.0]
        datos[sym] = fakes.symbol(sym, income=income(ebit_ey), balance=bal, marketCap=950.0)
    tabla = _build(monkeypatch, universo, datos)
    assert [r["symbol"] for r in tabla["rows"]] == ["A", "C", "B"]
    assert [r["rank"] for r in tabla["rows"]] == [3, 4, 5]


def test_la_tabla_se_cachea_por_universo(monkeypatch):
    llamadas = []
    monkeypatch.setattr(M, "get_universe", lambda uid: fakes.universe(("AAA", "A", "Technology"), uid=uid))

    def contar(syms, **kw):
        llamadas.append(syms)
        return {"AAA": emisora("AAA")}, []

    monkeypatch.setattr(M, "fetch_symbols", contar)
    M.get_magic("us")
    M.get_magic("us")
    assert len(llamadas) == 1


def test_a_los_sectores_excluidos_ni_se_les_pregunta(monkeypatch):
    """Cada emisora cuesta tres llamadas a Yahoo: a un banco del universo curado no se le pide nada."""
    universo = fakes.universe(
        ("AAA", "A", "Technology"),
        ("BANCO", "Banco", "Financial Services"),
        ("LUZ", "Luz", "Utilities"),
    )
    preguntados = []

    def espiar(syms, **kw):
        preguntados.extend(syms)
        return {s: emisora(s) for s in syms}, []

    monkeypatch.setattr(M, "fetch_symbols", espiar)
    tabla = M.build(universo)
    assert preguntados == ["AAA"]
    assert {e["symbol"] for e in tabla["excluded"]} == {"BANCO", "LUZ"}
    assert tabla["partial"] is False
