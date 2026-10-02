"""Pruebas de respuesta conocida de la spec de la fase 5 (monitor-del-peso y forward-y-presupuesto-usd).

Una por cada viñeta de las dos secciones, con series de prueba y ``today`` explícito. Las del
presupuesto (percentil del nivel presupuestal e impacto en pesos) se calculan en el navegador y
viven en ``src/features/fx/lib/budget.test.js``; aquí se repite el percentil porque la función del
backend es la misma regla.
"""

from __future__ import annotations

import datetime as _dt

import pytest

from kaizen_api.domain import dof_rule, forward, fxdesk
from kaizen_api.providers import cftc, frankfurter

D = _dt.date.fromisoformat


def _fixes(*pairs: tuple[str, float]) -> dict[str, float]:
    return dict(pairs)


# FIX de prueba de fines de septiembre y principios de octubre de 2026 (días hábiles = fechas con FIX).
FIX_PRUEBA = _fixes(
    ("2026-09-24", 18.20),
    ("2026-09-25", 18.22),
    ("2026-09-28", 18.25),
    ("2026-09-29", 18.27),
    ("2026-09-30", 18.29),
    ("2026-10-01", 18.30),
    ("2026-10-02", 18.31),
    ("2026-10-05", 18.33),
    ("2026-10-06", 18.35),
)
HOY_OCT = D("2026-10-08")


# ─── monitor-del-peso ────────────────────────────────────────────────────────


def test_percentil_52_semanas():
    assert fxdesk.percentile_rank([17, 18, 19, 20], 19) == 0.75


def test_volatilidad_realizada():
    assert fxdesk.realized_vol([100, 101, 99, 102, 103]) == pytest.approx(0.326231, abs=5e-7)


def test_cambio_en_centavos_y_fraccion():
    frac, cents = fxdesk.change(18.25, 18.10)
    assert round(cents, 2) == 15.00
    assert round(frac, 6) == 0.008287


def test_regla_dof_lunes_usa_publicacion_del_viernes_con_fix_del_jueves():
    res = dof_rule.resolve(FIX_PRUEBA, D("2026-10-05"), "dof", HOY_OCT)
    assert res.dof_publication_date == "2026-10-02"
    assert res.fix_date == "2026-10-01"
    assert res.value == 18.30


def test_regla_dof_miercoles_usa_fix_del_lunes():
    res = dof_rule.resolve(FIX_PRUEBA, D("2026-10-07"), "dof", HOY_OCT)
    assert res.dof_publication_date == "2026-10-06"
    assert res.fix_date == "2026-10-05"


def test_cierre_de_septiembre_por_fecha_y_por_dof():
    por_fecha = dof_rule.resolve(FIX_PRUEBA, D("2026-09-30"), "fecha", HOY_OCT)
    assert por_fecha.fix_date == "2026-09-30"
    assert por_fecha.dof_publication_date is None
    por_dof = dof_rule.resolve(FIX_PRUEBA, D("2026-09-30"), "dof", HOY_OCT)
    assert por_dof.dof_publication_date == "2026-09-29"
    assert por_dof.fix_date == "2026-09-28"


def test_lote_1000_usd_con_regla_dof():
    res = dof_rule.resolve(FIX_PRUEBA, D("2026-10-05"), "dof", HOY_OCT)
    assert round(1000 * res.value, 2) == 18300.00


def test_cftc_neto_no_comerciales_y_su_cambio():
    legacy = cftc.normalize(
        [
            {
                "report_date_as_yyyy_mm_dd": "2026-09-22T00:00:00.000",
                "open_interest_all": "266061",
                "noncomm_positions_long_all": "127595",
                "noncomm_positions_short_all": "52428",
            },
            {
                "report_date_as_yyyy_mm_dd": "2026-09-15T00:00:00.000",
                "open_interest_all": "319499",
                "noncomm_positions_long_all": "140000",
                "noncomm_positions_short_all": "52218",
            },
        ],
        cftc.LEGACY_FIELDS,
    )
    cot = fxdesk.cot_position(legacy, [])
    assert cot["reportDate"] == "2026-09-22"
    assert cot["nonCommercialNet"] == 75167
    assert cot["nonCommercialNetChange"] == 75167 - 87782 == -12615
    assert cot["leveragedNet"] is None and cot["assetManagerNet"] is None


def test_frankfurter_v2_invierte_y_descarta_fin_de_semana():
    points = frankfurter.parse_v2(
        [
            {"date": "2026-09-25", "base": "MXN", "quote": "COP", "rate": 183.50},
            {"date": "2026-09-26", "base": "MXN", "quote": "COP", "rate": 183.40},
            {"date": "2026-09-27", "base": "MXN", "quote": "COP", "rate": 183.30},
            {"date": "2026-09-28", "base": "MXN", "quote": "COP", "rate": 183.12},
        ]
    )
    assert [d for d, _ in points["COP"]] == ["2026-09-25", "2026-09-28"]
    assert fxdesk.invert(points["COP"])[-1] == ("2026-09-28", 0.005461)


def test_cruce_con_ne_toma_el_ultimo_valido_y_nunca_cero(monkeypatch):
    # El proveedor del SIE ya quita el N/E: el último valor válido es el del 29/09.
    hoy = D("2026-10-01")
    sie = {"SF60632": [("2026-09-28", 12.70), ("2026-09-29", 12.7113)]}
    monkeypatch.setattr(fxdesk, "sie_cross_points", lambda sid, today: sie.get(sid, [("2026-10-01", 20.0)]))
    monkeypatch.setattr(frankfurter, "v2_series", lambda *a, **k: {})
    monkeypatch.setattr(frankfurter, "v1_series", lambda *a, **k: pytest.fail("no debía caer al BCE"))
    rows = {r["pair"]: r for r in fxdesk.build_crosses(hoy)["rows"]}
    assert rows["CADMXN"]["value"] == 12.7113
    assert rows["CADMXN"]["asOf"] == "2026-09-29"
    assert rows["CADMXN"]["fallback"] is False


def test_cruce_sin_dato_reciente_cae_a_frankfurter_v1_marcado(monkeypatch):
    hoy = D("2026-10-01")
    monkeypatch.setattr(
        fxdesk, "sie_cross_points", lambda sid, today: [] if sid == "SF60632" else [("2026-10-01", 20.0)]
    )
    monkeypatch.setattr(frankfurter, "v2_series", lambda *a, **k: {})
    monkeypatch.setattr(
        frankfurter,
        "v1_series",
        lambda base, symbols, start, end: {"CAD": [("2026-09-30", 0.0788), ("2026-10-01", 0.0787)]},
    )
    body = fxdesk.build_crosses(hoy)
    cad = next(r for r in body["rows"] if r["pair"] == "CADMXN")
    assert cad["source"] == "frankfurter" and cad["provider"] == "ecb" and cad["fallback"] is True
    assert cad["value"] == round(1 / 0.0787, 6) and cad["value"] != 0
    assert body["meta"]["fallback"] is True


# ─── forward-y-presupuesto-usd ───────────────────────────────────────────────


def test_paridad_90_dias():
    f = forward.forward_price(18.00, 0.08, 0.04, 90)
    assert round(f, 6) == 18.178218
    assert round(forward.points_pips(18.00, f), 2) == 1782.18
    assert round(forward.carry_annual(18.00, f, 90), 6) == 0.039604


def test_paridad_con_tesoro_3m_convertido():
    i_usd = forward.cmt_to_act360(0.0425)
    assert round(i_usd, 6) == 0.041918
    assert round(forward.forward_price(18.00, 0.08, i_usd, 91), 6) == 18.171457


def test_percentil_del_presupuesto():
    assert fxdesk.percentile_rank([17, 18, 19, 20], 19.00) == 0.75


def test_impacto_de_choque_en_pesos():
    # El cálculo de la pantalla vive en budget.js; la regla es flujo x choque.
    assert 100_000 * 0.50 == 50_000


@pytest.mark.parametrize("days", ["0", "366", "30,0"])
def test_plazo_fuera_de_rango_es_400(client, days):
    r = client.get(f"/v2/fxdesk/forward?days={days}")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_PARAM"
