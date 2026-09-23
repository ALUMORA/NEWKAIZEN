"""Momentum 12-1: la fórmula, el mes en curso que no cuenta y la referencia en la misma moneda."""

from __future__ import annotations

import datetime as dt

import pytest

from kaizen_api.domain.history import PriceSeries
from kaizen_api.domain.screeners import momentum as mom


def meses(n: int, hasta: str = "2026-08") -> list[str]:
    """``n`` fechas mensuales (día 1, como las fecha Yahoo) que terminan en ``hasta``."""
    año, mes = int(hasta[:4]), int(hasta[5:7])
    fechas = []
    for k in range(n):
        idx = año * 12 + mes - 1 - k
        fechas.append(f"{idx // 12:04d}-{idx % 12 + 1:02d}-01")
    return fechas[::-1]


def test_12_1_es_p11_entre_p0_sobre_trece_cierres():
    precios = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 132, 500]
    # Ago 2025 = 100 (t − 12) y jul 2026 = 132 (t − 1); agosto de 2026 (500) es el mes t y NO entra.
    assert mom.momentum_12_1(dates=meses(13), closes=precios, as_of="2026-09-22") == pytest.approx(0.32)


def test_12_1_usa_solo_los_meses_de_su_ventana():
    precios = [1, 2, 3, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 132, 500]
    assert mom.momentum_12_1(dates=meses(16), closes=precios, as_of="2026-09-22") == pytest.approx(0.32)


def test_sin_los_meses_de_la_ventana_no_hay_12_1():
    assert mom.momentum_12_1(dates=meses(12), closes=[100.0 + i for i in range(12)], as_of="2026-09-22") is None
    assert mom.momentum_12_1(dates=[], closes=[], as_of="2026-09-22") is None


def test_la_ventana_la_fija_el_calendario_no_el_ultimo_dato():
    # Si la serie se quedó en junio, el 12-1 de septiembre no es el de junio: falta julio.
    assert mom.momentum_12_1(dates=meses(13, "2026-06"), closes=[1.0] * 13, as_of="2026-09-22") is None


def test_el_mes_de_referencia_es_el_ultimo_que_ya_cerro():
    assert mom.reference_month("2026-09-22") == "2026-08"
    assert mom.reference_month("2026-01-05") == "2025-12"
    assert mom.reference_month("2026-09-30") == "2026-08"


def test_el_mes_en_curso_no_cuenta(monkeypatch):
    class Hoy(dt.date):
        @classmethod
        def today(cls):
            return dt.date(2026, 9, 22)

    monkeypatch.setattr(mom._dt, "date", Hoy)
    serie_falsa = PriceSeries(
        symbol="FAKE", currency="USD", interval="1mo",
        dates=["2026-07-01", "2026-08-01", "2026-09-01"], close=[10.0, 11.0, 12.0], source="yahoo",
    )
    monkeypatch.setattr(mom, "get_series", lambda *a, **k: serie_falsa)
    fechas, cierres = mom.monthly_closes("FAKE")
    assert fechas == ["2026-07-31", "2026-08-31"] and cierres == [10.0, 11.0]


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
    assert len(cierres) == 14 and fechas[-1] == "2026-02-27", "último día hábil de febrero de 2026"


def test_sin_historico_lanza_su_error(monkeypatch, replay_b3b):
    # Desde M2 la costura de B2a existe: un símbolo inexistente ya no se queda sin serie, el
    # proveedor contesta que no hay tal emisora. Las dos son la misma respuesta para el usuario.
    from kaizen_api.errors import ApiError

    with pytest.raises((mom.NoHistory, ApiError)):
        mom.monthly_closes("ZZZNOTREAL")


# ─── con las grabaciones ─────────────────────────────────────────────────────


@pytest.fixture
def hoy(monkeypatch):
    """Las grabaciones son del 22 de septiembre de 2026: "hoy" se fija ahí para que el mes t no se mueva."""
    monkeypatch.setattr(mom._dt, "date", type("H", (dt.date,), {"today": classmethod(lambda cls: dt.date(2026, 9, 22))}))


def test_momentum_de_una_emisora_de_eeuu(replay_b3b, hoy):
    r = mom.get_momentum_v2("AAPL")
    assert r["currency"] == "USD" and r["benchmark"] == "SPY"
    assert r["r12m1"] == pytest.approx(0.33447, abs=1e-5)
    assert r["benchmarkR12m1"] == pytest.approx(0.170928, abs=1e-5)
    assert r["relative12m1"] == pytest.approx(r["r12m1"] - r["benchmarkR12m1"], abs=1e-9)
    assert -1 < r["r6m"] < 5 and -1 < r["r3m"] < 5
    assert r["_asOf"] == "2026-08-31", "el último cierre es el 31 de agosto: septiembre todavía no cierra"
    assert r["_stale"] is False


def test_momentum_de_una_emisora_mexicana_usa_naftrac(replay_b3b, hoy):
    r = mom.get_momentum_v2("WALMEX.MX")
    assert r["currency"] == "MXN" and r["benchmark"] == "NAFTRAC.MX"
    assert r["r12m1"] == pytest.approx(-0.071011, abs=1e-5)
    assert r["benchmarkR12m1"] == pytest.approx(0.176112, abs=1e-5)
    assert r["relative12m1"] < 0


def test_la_misma_empresa_en_dos_plazas_se_mide_contra_su_propia_referencia(replay_b3b, hoy):
    usd = mom.get_momentum_v2("AAPL")
    mxn = mom.get_momentum_v2("AAPL.MX")
    assert usd["benchmark"] == "SPY" and mxn["benchmark"] == "NAFTRAC.MX"
    assert usd["currency"] == "USD" and mxn["currency"] == "MXN"
    # No son iguales justamente porque el peso se movió contra el dólar.
    assert usd["r12m1"] != pytest.approx(mxn["r12m1"], abs=1e-4)


def test_la_referencia_contra_si_misma_da_cero(replay_b3b, hoy):
    r = mom.get_momentum_v2("SPY")
    assert r["relative12m1"] == 0.0
    assert any("ES la referencia" in n for n in r["_notes"])


def test_las_notas_explican_la_moneda_y_el_mes_en_curso(replay_b3b, hoy):
    r = mom.get_momentum_v2("FUNO11.MX")
    assert any("la misma moneda" in n for n in r["_notes"])
    assert any("mes en curso" in n for n in r["_notes"])
    for n in r["_notes"]:
        assert "—" not in n and "–" not in n


def test_la_nota_de_moneda_no_habla_de_pesos_cuando_el_activo_va_en_dolares(replay_b3b, hoy):
    """La nota es la misma para las dos plazas, así que no puede nombrar una sola moneda."""
    usd = mom.get_momentum_v2("AAPL")
    nota = next(n for n in usd["_notes"] if "la misma moneda" in n)
    assert "en USD" in nota
    assert "pesos" not in nota.lower() and "dólares" not in nota.lower()
    mxn = mom.get_momentum_v2("WALMEX.MX")
    assert "en MXN" in next(n for n in mxn["_notes"] if "la misma moneda" in n)
