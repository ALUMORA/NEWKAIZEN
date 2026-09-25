"""Matemáticas del DCF contra las respuestas conocidas del spec (``docs/overhaul/specs``).

Todas las cifras de este archivo vienen de la tabla de respuestas conocidas de la fase 2 y se
derivaron a mano antes de escribir el código; si alguna cambia, el cambio es el que está mal.
"""

from __future__ import annotations

import math

import pytest

from kaizen_api.domain.valuation import dcf


def test_dos_etapas_da_el_valor_empresa_conocido():
    # FCFF0 100, crece 10 % cinco años, terminal 3 %, WACC 9 %.
    r = dcf.two_stage_fcff(fcff0=100.0, growth=0.10, years=5, terminal_growth=0.03, wacc_value=0.09)
    assert round(r.pv_stage1, 2) == 513.93
    assert round(r.pv_terminal, 2) == 1796.87
    assert round(r.enterprise_value, 2) == 2310.80
    assert r.warnings == []


def test_la_proyeccion_crece_y_descuenta_como_toca():
    r = dcf.two_stage_fcff(fcff0=100.0, growth=0.10, years=5, terminal_growth=0.03, wacc_value=0.09)
    assert [p.year for p in r.projection] == [1, 2, 3, 4, 5]
    assert round(r.projection[0].fcff, 4) == 110.0
    assert round(r.projection[-1].fcff, 4) == round(100 * 1.10**5, 4)
    assert round(r.projection[2].discount_factor, 6) == round(1 / 1.09**3, 6)
    assert all(round(p.pv, 8) == round(p.fcff * p.discount_factor, 8) for p in r.projection)
    # El valor terminal usa el flujo del año 6, no el del 5.
    assert round(r.terminal_value, 4) == round(100 * 1.10**5 * 1.03 / (0.09 - 0.03), 4)
    assert round(r.tv_share, 4) == round(1796.8705 / 2310.7997, 4)


def test_hamada_reapalanca_la_beta():
    assert round(dcf.levered_beta(0.8, 0.5, 0.30), 6) == 1.08
    assert round(dcf.unlevered_beta(1.08, 0.5, 0.30), 6) == 0.8


def test_costo_de_capital_propio_con_riesgo_pais():
    re = dcf.cost_of_equity(rf=0.042, beta_l=1.08, erp=0.045, crp=0.025, lambda_=1.0)
    assert round(re, 6) == 0.1156


def test_wacc_y_su_cambio_de_moneda():
    w = dcf.wacc(re=0.1156, rd=0.07, tax_rate=0.30, equity_weight=2 / 3)
    assert round(w, 4) == 0.0934
    en_pesos = dcf.wacc_in_currency(0.0934, inflation_local=0.035, inflation_base=0.023)
    assert round(en_pesos, 4) == 0.1062


def test_pb_justificado_de_un_banco():
    assert round(dcf.justified_pb(roe=0.15, growth=0.05, cost_equity=0.12), 4) == 1.4286
    assert dcf.justified_pb(roe=0.15, growth=0.13, cost_equity=0.12) is None


def test_la_guarda_recorta_el_crecimiento_terminal_a_la_tasa_libre_de_riesgo():
    r = dcf.two_stage_fcff(100.0, 0.05, 5, terminal_growth=0.055, wacc_value=0.10, rf=0.042)
    assert round(r.terminal_growth, 6) == 0.042
    assert len(r.warnings) == 1
    assert "tasa libre de riesgo" in r.warnings[0]
    assert "—" not in r.warnings[0] and "–" not in r.warnings[0]


def test_la_guarda_exige_dos_puntos_entre_wacc_y_crecimiento():
    r = dcf.two_stage_fcff(100.0, 0.05, 5, terminal_growth=0.055, wacc_value=0.06, rf=0.08)
    assert round(r.terminal_growth, 6) == 0.04
    assert round(r.wacc - r.terminal_growth, 6) == dcf.MIN_SPREAD
    assert any("2 puntos" in w for w in r.warnings)


def test_las_dos_guardas_se_aplican_en_orden():
    # Pide 6 %: primero baja a rf (4.2 %) y luego a WACC − 2 pp (3 %).
    r = dcf.two_stage_fcff(100.0, 0.05, 5, terminal_growth=0.06, wacc_value=0.05, rf=0.042)
    assert round(r.terminal_growth, 6) == 0.03
    assert len(r.warnings) == 2


def test_parametros_invalidos():
    with pytest.raises(ValueError):
        dcf.two_stage_fcff(100.0, 0.05, 0, 0.02, 0.09)
    with pytest.raises(ValueError):
        dcf.two_stage_fcff(100.0, 0.05, 5, 0.02, 0.0)


def test_puente_de_valor_empresa_a_valor_por_accion():
    equity, per_share = dcf.equity_bridge(2310.80, net_debt=300.0, minority_interest=10.8, shares=100.0)
    assert round(equity, 2) == 2000.0
    assert round(per_share, 2) == 20.0
    # Sin acciones no hay valor por acción, pero el capital sí sale.
    equity, per_share = dcf.equity_bridge(2310.80, 300.0, None, None)
    assert round(equity, 2) == 2010.80
    assert per_share is None
    assert dcf.equity_bridge(float("nan"), 0, 0, 1) == (None, None)


def test_la_tabla_de_sensibilidad_tiene_la_forma_del_contrato():
    grid = dcf.sensitivity(
        fcff0=100.0,
        growth=0.10,
        years=5,
        base_wacc=0.09,
        base_terminal_growth=0.03,
        net_debt=0.0,
        minority_interest=0.0,
        shares=100.0,
    )
    assert len(grid["waccs"]) == 5 and len(grid["growths"]) == 5
    assert len(grid["grid"]) == 5 and all(len(row) == 5 for row in grid["grid"])
    # El centro de la tabla es el caso base: EV 2310.80 entre 100 acciones.
    assert round(grid["grid"][2][2], 2) == 23.11
    # Bajar la WACC o subir el crecimiento sube el valor.
    assert grid["grid"][0][2] > grid["grid"][2][2] > grid["grid"][4][2]
    assert grid["grid"][2][0] < grid["grid"][2][2] < grid["grid"][2][4]


def test_la_sensibilidad_deja_vacio_lo_que_viola_la_guarda():
    grid = dcf.sensitivity(
        fcff0=100.0,
        growth=0.05,
        years=5,
        base_wacc=0.045,
        base_terminal_growth=0.035,
        net_debt=0.0,
        minority_interest=0.0,
        shares=100.0,
    )
    vacíos = [(i, j) for i, row in enumerate(grid["grid"]) for j, v in enumerate(row) if v is None]
    assert vacíos, "con WACC 4.5 % y g 3.5 % varios cruces no cumplen los 2 puntos"
    for i, j in vacíos:
        assert grid["waccs"][i] - grid["growths"][j] < dcf.MIN_SPREAD


def test_el_valor_crece_cuando_baja_la_wacc():
    caro = dcf.two_stage_fcff(100.0, 0.10, 5, 0.03, 0.12)
    barato = dcf.two_stage_fcff(100.0, 0.10, 5, 0.03, 0.08)
    assert barato.enterprise_value > caro.enterprise_value
    assert math.isfinite(barato.enterprise_value)


@pytest.mark.parametrize("wacc", [0.0789, 0.0811, 0.0937, 0.1043])
def test_el_centro_de_la_malla_repite_el_caso_base_cuando_g_se_recorto_contra_la_wacc(wacc: float) -> None:
    """Con g recortado a WACC − 2 pp, el redondeo a 6 decimales dejaba el centro en s/d."""
    g = dcf.clamp_terminal_growth(0.08, wacc, None, [])
    base = dcf.two_stage_fcff(100.0, 0.05, 5, 0.08, wacc)
    _, per_share = dcf.equity_bridge(base.enterprise_value, 0.0, 0.0, 10.0)
    grid = dcf.sensitivity(
        fcff0=100.0, growth=0.05, years=5, base_wacc=wacc, base_terminal_growth=g,
        net_debt=0.0, minority_interest=0.0, shares=10.0,
    )["grid"]
    assert grid[2][2] is not None
    assert grid[2][2] == pytest.approx(per_share, rel=1e-4)


def test_el_centro_de_la_malla_no_se_pierde_cuando_g_se_recorto_a_la_tasa_libre_de_riesgo() -> None:
    rf = 0.04123456
    grid = dcf.sensitivity(
        fcff0=100.0, growth=0.05, years=5, base_wacc=0.09, base_terminal_growth=rf,
        net_debt=0.0, minority_interest=0.0, shares=10.0, rf=rf,
    )["grid"]
    assert grid[2][2] is not None
    assert grid[2][3] is None and grid[2][4] is None
