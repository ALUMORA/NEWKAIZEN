"""Screener por factores: estadística robusta, cobertura, sectores chicos y pruebas cumple/no cumple."""

from __future__ import annotations

import pytest

from kaizen_api import cache
from kaizen_api.domain.screeners import factors as F
from tests.unit.b3c import fakes


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.reset_state()
    yield
    cache.reset_state()


# ─── respuesta conocida y estadística ────────────────────────────────────────


def test_respuesta_conocida_z_de_18_es_1_349():
    """[10, 12, 14, 16, 18] -> z(18) = 1.349 (mediana 14, MAD 2, escala 1.4826x2)."""
    muestra = [10, 12, 14, 16, 18]
    assert round(F.robust_z(muestra, 18), 3) == 1.349
    assert F.median(muestra) == 14
    assert F.mad(muestra) == 2
    assert F.scaler(muestra).scale == pytest.approx(2.9652)
    assert F.robust_z(muestra, 14) == 0.0
    assert round(F.robust_z(muestra, 10), 3) == -1.349


def test_el_puntaje_se_recorta_a_mas_menos_tres():
    muestra = [10, 12, 14, 16, 18]
    assert F.robust_z(muestra, 1_000_000) == 3.0
    assert F.robust_z(muestra, -1_000_000) == -3.0
    # 14 + 3 x 2.9652 = 22.8956: justo en el borde todavía no se recorta.
    assert F.robust_z(muestra, 14 + 3 * 2.9652) == pytest.approx(3.0)


def test_mad_cero_usa_la_desviacion_estandar():
    """Con más de la mitad de los valores iguales la MAD es 0 y aun así hay que distinguir colas."""
    muestra = [5, 5, 5, 5, 40]
    assert F.mad(muestra) == 0
    escala = F.scaler(muestra)
    assert escala.scale > 0
    assert F.robust_z(muestra, 40) > 0
    # El centro sigue siendo la mediana, así que el valor repetido queda justo en cero.
    assert F.robust_z(muestra, 5) == 0.0
    assert F.robust_z(muestra, 2) < 0


def test_muestra_constante_deja_todos_los_puntajes_en_cero():
    assert F.robust_z([7, 7, 7], 7) == 0.0
    assert F.scaler([]).scale == 0.0


# ─── momento y volatilidad ───────────────────────────────────────────────────


def test_momento_12_1_es_p11_entre_p0():
    """13 cierres de fin de mes: se usa el penúltimo contra el primero, saltando el mes en curso."""
    puntos = [(f"2025-{m:02d}-28", float(100 + m)) for m in range(1, 13)]
    puntos += [("2026-01-28", 500.0)]  # el mes en curso no entra
    assert F.month_end_closes(puntos)[-1] == 500.0
    assert F.momentum_12m1(puntos) == pytest.approx(112 / 101 - 1)


def test_momento_pide_trece_meses():
    puntos = [(f"2025-{m:02d}-28", 100.0) for m in range(1, 13)]
    assert F.momentum_12m1(puntos) is None


def test_volatilidad_anualiza_por_raiz_de_52():
    puntos = [(f"2025-01-{d:02d}", p) for d, p in zip(range(1, 41), [100.0] * 40, strict=False)]
    assert F.annualized_volatility(puntos) == 0.0
    subiendo = fakes.weekly(100.0, 40, step=1.0)
    vol = F.annualized_volatility(subiendo)
    assert vol is not None and vol > 0
    # La misma serie sin suficientes observaciones no publica volatilidad.
    assert F.annualized_volatility(subiendo[:10]) is None


# ─── métricas por emisora ────────────────────────────────────────────────────


def test_los_multiplos_se_vuelven_rendimiento_y_la_perdida_puntua_bajo():
    """Una emisora que pierde dinero tiene rendimiento de utilidades negativo, no un hueco."""
    perdida = fakes.symbol("MALA", trailingEps=-4.0, currentPrice=50.0, bookValue=10.0,
                           enterpriseToEbitda=-8.0, freeCashflow=-1e8, marketCap=1e9)
    m = F.metrics_of(perdida, None)
    assert m["earningsYield"] == pytest.approx(-0.08)
    assert m["ebitdaToEv"] == pytest.approx(-0.125)
    assert m["fcfYield"] == pytest.approx(-0.1)
    assert m["bookToPrice"] == pytest.approx(0.2)

    buena = fakes.symbol("BUENA", trailingEps=5.0, currentPrice=50.0)
    assert F.metrics_of(buena, None)["earningsYield"] == pytest.approx(0.10)
    # La que pierde queda por debajo de la que gana, que es justo lo que el legado no hacía.
    muestra = [-0.08, 0.10]
    assert F.robust_z(muestra, -0.08) < F.robust_z(muestra, 0.10)


def test_deuda_entre_capital_se_convierte_a_razon():
    """Yahoo entrega debtToEquity en porcentaje (78.4); el contrato v2 pide la razón (0.784)."""
    data = fakes.symbol("AAA", debtToEquity=78.4)
    assert F.metrics_of(data, None)["debtToEquity"] == pytest.approx(0.784)


def test_moneda_distinta_deja_las_metricas_de_valor_en_nulo():
    """CEMEXCPO.MX cotiza en pesos y reporta en dólares: dividir una entre otra es el error viejo."""
    mixta = fakes.symbol("CEMEXCPO.MX", currency="MXN", financialCurrency="USD",
                         trailingEps=0.6, currentPrice=17.31, bookValue=14.8,
                         enterpriseToEbitda=79.7, freeCashflow=1e9,
                         returnOnEquity=0.04, operatingMargins=0.13)
    m = F.metrics_of(mixta, None)
    assert m["earningsYield"] is None
    assert m["bookToPrice"] is None
    assert m["ebitdaToEv"] is None
    assert m["fcfYield"] is None
    # Lo que no mezcla monedas sí se publica.
    assert m["returnOnEquity"] == pytest.approx(0.04)
    assert m["operatingMargin"] == pytest.approx(0.13)


def test_cobertura_cuenta_las_doce_metricas():
    vacia = dict.fromkeys(F.METRIC_IDS)
    assert F.coverage_of(vacia) == 0.0
    llena = dict.fromkeys(F.METRIC_IDS, 1.0)
    assert F.coverage_of(llena) == 1.0
    assert len(F.METRIC_IDS) == 12


def test_las_pruebas_son_cumple_o_no_cumple_y_sin_dato_van_en_nulo():
    metricas = dict.fromkeys(F.METRIC_IDS)
    metricas.update({"earningsYield": 0.07, "returnOnEquity": 0.10, "debtToEquity": 0.5})
    por_id = {c["id"]: c for c in F.checks_of(metricas)}
    assert por_id["valor"]["pass"] is True
    assert por_id["valor"]["threshold"] == 0.06
    assert por_id["calidad"]["pass"] is False
    assert por_id["deuda"]["pass"] is True
    assert por_id["momento"]["pass"] is None
    textos = " ".join(c["label"] for c in F.checks_of(metricas)).lower()
    for prohibida in ("compra", "vender", "venta", "recomend"):
        assert prohibida not in textos


# ─── el tablero completo ─────────────────────────────────────────────────────


def _board(monkeypatch, universo, datos, closes=None):
    monkeypatch.setattr(F, "fetch_symbols", lambda syms, **kw: ({s: datos[s] for s in syms if s in datos}, []))
    monkeypatch.setattr(F, "fetch_closes", lambda syms, **kw: closes or {})
    return F.build(universo)


def _rico(sym, sector, **over):
    """Una emisora con las diez métricas que no dependen del histórico."""
    base = dict(
        sector=sector, trailingEps=5.0, currentPrice=50.0, bookValue=20.0,
        enterpriseToEbitda=10.0, freeCashflow=5e7, marketCap=1e9,
        returnOnEquity=0.2, returnOnAssets=0.1, operatingMargins=0.15,
        debtToEquity=50.0, revenueGrowth=0.08, earningsGrowth=0.12,
    )
    base.update(over)
    return fakes.symbol(sym, **base)


def test_una_emisora_sin_datos_queda_fuera_con_motivo(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"), ("BBB", "B", "Technology"))
    datos = {"AAA": _rico("AAA", "Technology"), "BBB": fakes.symbol("BBB", error="sin respuesta")}
    board = _board(monkeypatch, universo, datos)
    por_symbol = {r["symbol"]: r for r in board["rows"]}
    assert por_symbol["BBB"]["excluded"] is True
    assert por_symbol["BBB"]["reason"] == "El proveedor no respondió por esta emisora."
    assert por_symbol["BBB"]["scores"] is None
    assert por_symbol["AAA"]["excluded"] is False


def test_cobertura_baja_excluye_con_el_porcentaje_en_el_motivo(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"), ("POCA", "P", "Technology"))
    pobre = fakes.symbol("POCA", returnOnEquity=0.2, revenueGrowth=0.05)  # 2 de 12
    board = _board(monkeypatch, universo, {"AAA": _rico("AAA", "Technology"), "POCA": pobre})
    fila = next(r for r in board["rows"] if r["symbol"] == "POCA")
    assert fila["excluded"] is True
    assert fila["coverage"] == pytest.approx(2 / 12, abs=1e-4)
    assert "17 %" in fila["reason"]


def test_sector_con_menos_de_cinco_se_compara_contra_el_universo(monkeypatch):
    grandes = [(f"T{i}", f"Tec {i}", "Technology") for i in range(5)]
    chico = [("E1", "Energía 1", "Energy"), ("E2", "Energía 2", "Energy")]
    universo = fakes.universe(*grandes, *chico)
    datos = {s: _rico(s, sec) for s, _, sec in grandes + chico}
    board = _board(monkeypatch, universo, datos)
    energia = [r for r in board["rows"] if r["symbol"].startswith("E")]
    assert all("se compara contra todo el universo" in r["reason"] for r in energia)
    tecnologia = [r for r in board["rows"] if r["symbol"].startswith("T")]
    assert all(r["reason"] is None for r in tecnologia)
    assert any("menos de 5 emisoras" in n for n in board["notes"])
    assert "Energía" in " ".join(board["notes"])


def test_el_puntaje_es_relativo_al_sector_no_al_universo(monkeypatch):
    """Cinco de tecnología caras y cinco de energía baratas: el barato de cada sector gana en el suyo."""
    miembros = [(f"T{i}", f"Tec {i}", "Technology") for i in range(5)]
    miembros += [(f"E{i}", f"Ene {i}", "Energy") for i in range(5)]
    datos = {}
    for i in range(5):
        datos[f"T{i}"] = _rico(f"T{i}", "Technology", trailingEps=1.0 + i, currentPrice=100.0)
        datos[f"E{i}"] = _rico(f"E{i}", "Energy", trailingEps=10.0 + i, currentPrice=100.0)
    board = _board(monkeypatch, fakes.universe(*miembros), datos)
    por_symbol = {r["symbol"]: r for r in board["rows"]}
    # T4 es el más barato de su sector aunque en el universo entero sea de los caros.
    assert por_symbol["T4"]["scores"]["value"] > 0
    assert por_symbol["T0"]["scores"]["value"] < 0
    assert por_symbol["E4"]["scores"]["value"] > 0
    assert all(r["reason"] is None for r in board["rows"])


def test_sin_historico_el_momento_y_la_volatilidad_van_en_nulo_y_se_avisa(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"))
    board = _board(monkeypatch, universo, {"AAA": _rico("AAA", "Technology")})
    fila = board["rows"][0]
    assert fila["metrics"]["momentum12m1"] is None
    assert fila["metrics"]["volatility"] is None
    assert fila["scores"]["momentum"] is None
    assert fila["scores"]["lowVol"] is None
    assert any("histórico" in n for n in board["notes"])
    # Con 10 de 12 métricas sigue siendo comparable y el compuesto existe.
    assert fila["excluded"] is False
    assert fila["scores"]["composite"] is not None


def test_con_historico_se_llenan_momento_y_volatilidad(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"))
    serie = fakes.weekly(100.0, 104, step=0.5, year=2024)
    board = _board(monkeypatch, universo, {"AAA": _rico("AAA", "Technology")}, closes={"AAA": serie})
    fila = board["rows"][0]
    assert fila["metrics"]["momentum12m1"] > 0
    assert fila["metrics"]["volatility"] >= 0
    assert fila["coverage"] == 1.0
    assert board["asOf"] == serie[-1][0]


def test_el_orden_pone_primero_el_compuesto_mas_alto_y_las_excluidas_al_final(monkeypatch):
    miembros = [(f"T{i}", f"Tec {i}", "Technology") for i in range(5)]
    miembros.append(("MALA", "Mala", "Technology"))
    datos = {f"T{i}": _rico(f"T{i}", "Technology", trailingEps=1.0 + i) for i in range(5)}
    datos["MALA"] = fakes.symbol("MALA", error="sin respuesta")
    board = _board(monkeypatch, fakes.universe(*miembros), datos)
    assert board["rows"][-1]["symbol"] == "MALA"
    compuestos = [r["scores"]["composite"] for r in board["rows"] if not r["excluded"]]
    assert compuestos == sorted(compuestos, reverse=True)


def test_el_compuesto_pide_al_menos_tres_factores(monkeypatch):
    """Solo con valor y calidad no hay compuesto: sería un promedio de dos cosas y no se dice."""
    universo = fakes.universe(("AAA", "A", "Technology"))
    parcial = fakes.symbol(
        "AAA", trailingEps=5.0, currentPrice=50.0, bookValue=20.0,
        enterpriseToEbitda=10.0, freeCashflow=5e7, marketCap=1e9,
        returnOnEquity=0.2, returnOnAssets=0.1,
    )
    board = _board(monkeypatch, universo, {"AAA": parcial})
    fila = board["rows"][0]
    assert fila["scores"]["value"] is not None
    assert fila["scores"]["quality"] is not None
    assert fila["scores"]["growth"] is None
    assert fila["scores"]["composite"] is None


def test_el_sector_curado_le_gana_al_de_yahoo(monkeypatch):
    """Yahoo clasifica a Fibra Mty como banco; el universo curado manda."""
    universo = fakes.universe(("FMTY14.MX", "Fibra Mty", "Real Estate"), uid="mx")
    datos = {"FMTY14.MX": _rico("FMTY14.MX", "Financial Services")}
    board = _board(monkeypatch, universo, datos)
    assert board["rows"][0]["sector"] == "Bienes raíces"
    assert board["rows"][0]["name"] == "Fibra Mty"


def test_el_texto_del_metodo_no_lleva_guiones_largos_ni_lenguaje_de_compraventa():
    assert "—" not in F.METHOD and "–" not in F.METHOD
    bajo = F.METHOD.lower()
    for prohibida in ("comprar", "vender", "recomendamos"):
        assert prohibida not in bajo
    assert "no son recomendación de inversión" in bajo


def test_el_tablero_se_cachea_por_universo(monkeypatch):
    universo = fakes.universe(("AAA", "A", "Technology"))
    llamadas = []

    def contar(syms, **kw):
        llamadas.append(syms)
        return {"AAA": _rico("AAA", "Technology")}, []

    monkeypatch.setattr(F, "fetch_symbols", contar)
    monkeypatch.setattr(F, "fetch_closes", lambda syms, **kw: {})
    F.get_factors(universo)
    F.get_factors(universo)
    assert len(llamadas) == 1
