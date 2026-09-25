"""Motivo por renglón en los screeners (pedido F3c-2).

``FibraRow.notes`` dice por qué cada cifra del renglón va en s/d, y ``MagicRow.ebitSource`` de qué
renglón salió el EBIT. Antes la UI lo sacaba del texto de ``meta.notes``; esas notas se conservan
tal cual, porque el frontend todavía las lee.
"""

from __future__ import annotations

import pytest

from kaizen_api import schemas
from kaizen_api.domain.screeners import fibras as FB
from kaizen_api.domain.screeners import magic as M
from kaizen_api.provenance import meta
from tests.unit.b3c import fakes
from tests.unit.b3c.test_fibras import _build as build_fibras
from tests.unit.b3c.test_fibras import _clean_cache, fibra  # noqa: F401  (fixture autouse de fibras)
from tests.unit.b3c.test_magic import _build as build_magic
from tests.unit.b3c.test_magic import emisora, income

RATE = {"rate": 0.0975, "asOf": "2026-09-18", "source": "banxico", "fallback": False}


def _cada_sd_tiene_motivo(fila: dict) -> None:
    texto = " ".join(fila["notes"])
    for campo, nombre in FB.ROW_METRICS.items():
        if fila[campo] is None:
            assert nombre.lower() in texto.lower(), f"{fila['symbol']}: {campo} va en s/d sin motivo en {fila['notes']}"
    assert "—" not in texto and "–" not in texto
    assert all(n.endswith(".") and n[0].isupper() for n in fila["notes"])
    assert not any(fila["symbol"] in n for n in fila["notes"]), "el renglón ya dice de qué FIBRA es"


def test_una_fibra_completa_no_trae_notas(monkeypatch):
    tabla = build_fibras(monkeypatch, {"FUNO11.MX": fibra()}, rate=RATE)
    fila = tabla["rows"][0]
    assert all(fila[c] is not None for c in FB.ROW_METRICS)
    assert fila["notes"] == []


def test_sin_tasa_el_diferencial_dice_por_que(monkeypatch):
    fila = build_fibras(monkeypatch, {"FUNO11.MX": fibra()})["rows"][0]
    assert fila["spreadVsCetes"] is None
    assert fila["notes"] == ["Diferencial contra CETES va en s/d porque el servidor no tiene tasa de referencia de CETES."]


def test_moneda_distinta_explica_sus_razones_y_no_el_ltv(monkeypatch):
    fila = build_fibras(monkeypatch, {"RARA.MX": fibra("RARA.MX", financialCurrency="USD")}, rate=RATE)["rows"][0]
    _cada_sd_tiene_motivo(fila)
    assert fila["ltv"] is not None
    assert len(fila["notes"]) == 1 and "reporta en USD y cotiza en MXN" in fila["notes"][0]
    assert "LTV" not in fila["notes"][0]


def test_estados_ajenos_dan_el_motivo_en_el_renglon_y_meta_notes_sigue_igual(monkeypatch):
    ajena = fibra("FMTY14.MX", industry="Banks - Regional")
    tabla = build_fibras(monkeypatch, {"FMTY14.MX": ajena}, rate=RATE)
    fila = tabla["rows"][0]
    _cada_sd_tiene_motivo(fila)
    assert any("no son de esta FIBRA" in n and "banco" in n for n in fila["notes"])
    # La nota de siempre, con la clave al frente, sigue en meta.notes.
    assert any(n.startswith("FMTY14.MX: LTV, deuda entre capitalización, cap rate y flujo van en s/d") for n in tabla["notes"])


def test_sin_respuesta_del_proveedor_todo_va_en_sd_con_un_solo_motivo(monkeypatch):
    datos = {"FUNO11.MX": fibra(), "MUDA.MX": fakes.symbol("MUDA.MX", error="sin respuesta")}
    tabla = build_fibras(monkeypatch, datos, rate=RATE)
    muda = next(r for r in tabla["rows"] if r["symbol"] == "MUDA.MX")
    _cada_sd_tiene_motivo(muda)
    assert len(muda["notes"]) == 1 and "Yahoo no devolvió datos" in muda["notes"][0]


def test_pagos_ilegibles_o_ausentes_explican_rendimiento_y_diferencial(monkeypatch):
    def dividendos(sym):
        if sym == "FALLA.MX":
            raise RuntimeError("se cayó")
        if sym == "SINPAGO.MX":
            return {"ttm": None, "yield": None, "history": []}
        return {"ttm": 2.4, "yield": 0.08, "history": [{}]}

    monkeypatch.setattr(FB, "get_dividends", dividendos)
    datos = {s: fibra(s) for s in ("FALLA.MX", "SINPAGO.MX")}
    filas = {r["symbol"]: r for r in build_fibras(monkeypatch, datos, rate=RATE)["rows"]}
    for fila in filas.values():
        _cada_sd_tiene_motivo(fila)
    assert "no se pudo leer su historia de pagos" in filas["FALLA.MX"]["notes"][0]
    assert "no publica pagos" in filas["SINPAGO.MX"]["notes"][0]
    assert filas["FALLA.MX"]["notes"][0].startswith("Rendimiento por distribución y diferencial contra CETES van en s/d")


def test_lo_que_ningun_motivo_explica_se_atribuye_al_dato_que_falta(monkeypatch):
    sin_flujo = fibra("SECA.MX")
    sin_flujo = fakes.symbol(
        "SECA.MX", income=sin_flujo.income, balance=sin_flujo.balance, cashflow=None, **sin_flujo.info
    )
    fila = build_fibras(monkeypatch, {"SECA.MX": sin_flujo}, rate=RATE)["rows"][0]
    assert fila["cashFlowYield"] is None
    assert fila["notes"] == ["Flujo va en s/d porque Yahoo no publica el dato con que se calcula."]


def test_el_contrato_acepta_notes_y_un_api_anterior_sin_ellas(monkeypatch):
    tabla = build_fibras(monkeypatch, {"RARA.MX": fibra("RARA.MX", financialCurrency="USD")}, rate=RATE)
    body = schemas.FibrasResponse.model_validate({"rows": tabla["rows"], "cetes28": 0.0975, "meta": meta("yahoo")})
    assert body.rows[0].notes
    viejo = {k: v for k, v in tabla["rows"][0].items() if k != "notes"}
    assert schemas.FibraRow.model_validate(viejo).notes == []


# ─── fórmula mágica: ebitSource ──────────────────────────────────────────────


def test_ebit_source_distingue_utilidad_de_operacion_del_renglon_ebit(monkeypatch):
    universo = fakes.universe(("OPER", "Operación", "Technology"), ("RESP", "Respaldo", "Technology"))
    oper = emisora("OPER")
    oper = fakes.symbol("OPER", income=income(100.0, label="Operating Income"), balance=oper.balance, **oper.info)
    tabla = build_magic(monkeypatch, universo, {"OPER": oper, "RESP": emisora("RESP")})
    fuente = {r["symbol"]: r["ebitSource"] for r in tabla["rows"]}
    assert fuente == {"OPER": "operating_income", "RESP": "ebit_row"}
    assert all("_ebitRow" not in r for r in tabla["rows"])
    # La nota de siempre sigue listando las de respaldo.
    assert any("renglón EBIT de Yahoo" in n and n.endswith("RESP.") for n in tabla["notes"])
    for fila in tabla["rows"]:
        schemas.MagicRow.model_validate(fila)


def test_ebit_source_es_opcional_para_un_api_anterior():
    fila = {
        "symbol": "AAPL", "name": None, "sector": None, "ebit": 1.0, "enterpriseValue": 10.0,
        "earningsYield": 0.1, "returnOnCapital": 0.2, "rankEY": 1, "rankROC": 1, "rank": 2,
        "currency": "USD", "fiscalPeriodEnd": None,
    }
    assert schemas.MagicRow.model_validate(fila).ebitSource is None
    with pytest.raises(ValueError):
        schemas.MagicRow.model_validate({**fila, "ebitSource": "ebitda"})


def test_los_datos_del_modulo_magic_no_cambiaron_de_nombre():
    assert M.OPERATING_INCOME_ROWS[0] == "Operating Income"
    assert "EBIT" in M.EBIT_FALLBACK_ROWS
