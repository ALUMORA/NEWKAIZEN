"""Momentum 12-1: la fórmula, el mes en curso que no cuenta y la referencia en la misma moneda."""

from __future__ import annotations

import datetime as dt

import pytest

from kaizen_api.domain.history import PriceSeries
from kaizen_api.domain.screeners import momentum as mom


def serie(n: int, inicio: float = 100.0, paso: float = 1.0) -> list[float]:
    return [inicio + paso * i for i in range(n)]


def test_12_1_es_p11_entre_p0_sobre_trece_cierres():
    precios = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 132, 500]
    # P11 = 132 y P0 = 100; el último (500) es el mes t y NO entra en el 12-1.
    assert mom.r12m1(precios) == pytest.approx(0.32)


def test_12_1_usa_solo_los_ultimos_trece_cierres():
    largo = [1, 2, 3, *[100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 132, 500]]
    assert mom.r12m1(largo) == pytest.approx(0.32)


def test_sin_trece_cierres_no_hay_12_1():
    assert mom.r12m1(serie(12)) is None
    assert mom.r12m1([]) is None


def test_rendimientos_de_seis_y_tres_meses():
    precios = serie(13, inicio=100.0, paso=10.0)  # 100, 110, ... 220
    assert mom._return_between(precios, 6) == pytest.approx(220 / 160 - 1)
    assert mom._return_between(precios, 3) == pytest.approx(220 / 190 - 1)
    assert mom._return_between(precios, 20) is None


def test_el_mes_en_curso_no_cuenta(monkeypatch):
    class Hoy(dt.date):
        @classmethod
        def today(cls):
            return dt.date(2026, 9, 22)

    monkeypatch.setattr(mom._dt, "date", Hoy)
    fechas = ["2026-07-01", "2026-08-01", "2026-09-01"]
    cierres = [10.0, 11.0, 12.0]
    d, c = mom._drop_current_month(fechas, cierres)
    assert d == fechas[:-1] and c == cierres[:-1]
    # Si el último cierre ya es de un mes cerrado, no se quita nada.
    d, c = mom._drop_current_month(fechas[:-1], cierres[:-1])
    assert d == fechas[:-1] and c == cierres[:-1]


def test_la_referencia_va_en_la_misma_moneda():
    assert mom.BENCHMARK_BY_CURRENCY["MXN"] == "NAFTRAC.MX"
    assert mom.BENCHMARK_BY_CURRENCY["USD"] == "SPY"


def test_usa_la_costura_de_b2a_cuando_ya_existe(monkeypatch):
    serie_falsa = PriceSeries(
        symbol="FAKE",
        currency="USD",
        interval="1mo",
        dates=[f"2025-{m:02d}-01" for m in range(1, 13)] + ["2026-01-01", "2026-02-01"],
        close=[float(100 + i) for i in range(14)],
        source="yahoo",
    )
    llamadas = []

    def falsa(symbol, range="1y", interval="1d", ccy="native"):
        llamadas.append((symbol, range, interval, ccy))
        return serie_falsa

    monkeypatch.setattr(mom, "get_series", falsa)
    monkeypatch.setattr(mom._dt, "date", type("H", (dt.date,), {"today": classmethod(lambda cls: dt.date(2026, 3, 1))}))
    fechas, cierres = mom.monthly_closes("FAKE")
    assert llamadas == [("FAKE", "2y", "1mo", "native")]
    assert len(cierres) == 14 and fechas[-1] == "2026-02-01"


def test_sin_historico_lanza_su_error(monkeypatch, replay_b3b):
    with pytest.raises(mom.NoHistory):
        mom.monthly_closes("ZZZNOTREAL")


# ─── con las grabaciones ─────────────────────────────────────────────────────


def test_momentum_de_una_emisora_de_eeuu(replay_b3b):
    r = mom.get_momentum_v2("AAPL")
    assert r["currency"] == "USD" and r["benchmark"] == "SPY"
    assert r["r12m1"] == pytest.approx(0.33447, abs=1e-5)
    assert r["benchmarkR12m1"] == pytest.approx(0.170928, abs=1e-5)
    assert r["relative12m1"] == pytest.approx(r["r12m1"] - r["benchmarkR12m1"], abs=1e-9)
    assert -1 < r["r6m"] < 5 and -1 < r["r3m"] < 5
    assert r["_asOf"] == "2026-08-01", "el último cierre es de agosto: septiembre todavía no cierra"


def test_momentum_de_una_emisora_mexicana_usa_naftrac(replay_b3b):
    r = mom.get_momentum_v2("WALMEX.MX")
    assert r["currency"] == "MXN" and r["benchmark"] == "NAFTRAC.MX"
    assert r["r12m1"] == pytest.approx(-0.071011, abs=1e-5)
    assert r["benchmarkR12m1"] == pytest.approx(0.176112, abs=1e-5)
    assert r["relative12m1"] < 0


def test_la_misma_empresa_en_dos_plazas_se_mide_contra_su_propia_referencia(replay_b3b):
    usd = mom.get_momentum_v2("AAPL")
    mxn = mom.get_momentum_v2("AAPL.MX")
    assert usd["benchmark"] == "SPY" and mxn["benchmark"] == "NAFTRAC.MX"
    assert usd["currency"] == "USD" and mxn["currency"] == "MXN"
    # No son iguales justamente porque el peso se movió contra el dólar.
    assert usd["r12m1"] != pytest.approx(mxn["r12m1"], abs=1e-4)


def test_la_referencia_contra_si_misma_da_cero(replay_b3b):
    r = mom.get_momentum_v2("SPY")
    assert r["relative12m1"] == 0.0
    assert any("ES la referencia" in n for n in r["_notes"])


def test_las_notas_explican_la_moneda_y_el_mes_en_curso(replay_b3b):
    r = mom.get_momentum_v2("FUNO11.MX")
    assert any("la misma moneda" in n for n in r["_notes"])
    assert any("mes en curso" in n for n in r["_notes"])
    for n in r["_notes"]:
        assert "—" not in n and "–" not in n


def test_la_nota_de_moneda_no_habla_de_pesos_cuando_el_activo_va_en_dolares(replay_b3b):
    """La nota es la misma para las dos plazas, así que no puede nombrar una sola moneda."""
    usd = mom.get_momentum_v2("AAPL")
    nota = next(n for n in usd["_notes"] if "la misma moneda" in n)
    assert "en USD" in nota
    assert "pesos" not in nota.lower() and "dólares" not in nota.lower()
    mxn = mom.get_momentum_v2("WALMEX.MX")
    assert "en MXN" in next(n for n in mxn["_notes"] if "la misma moneda" in n)
