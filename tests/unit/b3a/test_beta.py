"""Beta contra el referente local: respuesta conocida, emparejado por fecha y reglas de moneda.

La costura ``domain.history.get_series`` es de B2a y hoy levanta ``NotImplementedError``, así que
aquí se finge con series armadas a mano. Eso además deja medir la beta contra una respuesta que se
conoce de antemano, en vez de contra lo que diga el proveedor ese día.
"""

from __future__ import annotations

import datetime as _dt

import pytest

from kaizen_api.domain import fundamentals as mod
from kaizen_api.domain.history import PriceSeries
from kaizen_api.errors import ApiError

MARKET_WEEKLY = [0.012, -0.008, 0.004, 0.021, -0.015, 0.006, -0.002, 0.011, 0.017, -0.009]
"""Diez rendimientos que se repiten hasta llenar la ventana. Suman distinto de cero y varían."""


def _dates(n: int, start: str = "2024-09-30") -> list[str]:
    first = _dt.date.fromisoformat(start)
    return [(first + _dt.timedelta(days=7 * i)).isoformat() for i in range(n)]


def _prices(returns: list[float], base: float = 100.0) -> list[float]:
    out = [base]
    for r in returns:
        out.append(out[-1] * (1.0 + r))
    return out


def _series(symbol: str, currency: str, returns: list[float], dates: list[str] | None = None) -> PriceSeries:
    close = _prices(returns)
    return PriceSeries(
        symbol=symbol,
        currency=currency,
        interval="1wk",
        dates=dates or _dates(len(close)),
        close=close,
        source="yahoo",
    )


def _fake_series(mapping: dict[str, PriceSeries]):
    def get_series(symbol, range="1y", interval="1d", ccy="native"):  # noqa: A002 - firma congelada
        if symbol not in mapping:
            raise ApiError(404, "NOT_FOUND", f"Sin histórico de {symbol}.")
        return mapping[symbol]

    return get_series


def _market_returns(n: int) -> list[float]:
    return [MARKET_WEEKLY[i % len(MARKET_WEEKLY)] for i in range(n)]


def test_beta_matches_the_known_answer(monkeypatch):
    """Rendimientos construidos con beta exacta 0.8: la regresión tiene que devolver 0.8."""
    n = 60
    market = _market_returns(n)
    stock = [0.8 * r + 0.001 for r in market]  # la constante entra al alfa, no a la beta
    monkeypatch.setattr(
        mod._history,
        "get_series",
        _fake_series({
            "WALMEX.MX": _series("WALMEX.MX", "MXN", stock),
            "NAFTRAC.MX": _series("NAFTRAC.MX", "MXN", market),
        }),
    )
    notes: list[str] = []
    beta = mod.compute_beta("WALMEX.MX", "MXN", notes)
    assert beta["value"] == pytest.approx(0.8, abs=1e-9)
    assert beta["adjusted"] == pytest.approx(0.67 * 0.8 + 0.33, abs=1e-9)  # Blume: 0.866
    assert beta["benchmark"] == "NAFTRAC.MX"
    assert beta["currency"] == "MXN"
    assert beta["window"] == "2 años, semanal"
    assert beta["observations"] == n
    assert beta["source"] == "computed"
    assert notes == []


def test_us_symbols_regress_against_spy(monkeypatch):
    n = 60
    market = _market_returns(n)
    stock = [1.4 * r for r in market]
    monkeypatch.setattr(
        mod._history,
        "get_series",
        _fake_series({
            "AAPL": _series("AAPL", "USD", stock),
            "SPY": _series("SPY", "USD", market),
        }),
    )
    beta = mod.compute_beta("AAPL", "USD", [])
    assert beta["benchmark"] == "SPY"
    assert beta["value"] == pytest.approx(1.4, abs=1e-9)


def test_pairs_by_date_not_by_position(monkeypatch):
    """Series que empiezan en semanas distintas: por posición sale otra beta, por fecha sale la buena."""
    n = 60
    market = _market_returns(n)
    stock = [0.8 * r for r in market]
    market_series = _series("NAFTRAC.MX", "MXN", market)
    full = _series("WALMEX.MX", "MXN", stock)
    # La acción arranca cinco semanas después (papel listado más tarde, o un hueco al inicio).
    late = PriceSeries(
        symbol="WALMEX.MX",
        currency="MXN",
        interval="1wk",
        dates=full.dates[5:],
        close=full.close[5:],
        source="yahoo",
    )
    monkeypatch.setattr(
        mod._history,
        "get_series",
        _fake_series({"WALMEX.MX": late, "NAFTRAC.MX": market_series}),
    )
    beta = mod.compute_beta("WALMEX.MX", "MXN", [])
    assert beta["observations"] == len(full.dates) - 6  # 55 semanas en común
    assert beta["value"] == pytest.approx(0.8, abs=1e-9)

    # Lo que habría dado emparejar por posición, que es como lo hacía el legado.
    own = mod._weekly_returns(late)
    mkt = mod._weekly_returns(market_series)
    ys = list(own.values())
    xs = list(mkt.values())[: len(ys)]
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    positional = sum((xs[i] - mx) * (ys[i] - my) for i in range(len(xs))) / sum((x - mx) ** 2 for x in xs)
    assert abs(positional - 0.8) > 0.05, "el emparejado por posición tiene que dar distinto"


def test_currency_mismatch_returns_no_beta(monkeypatch):
    n = 60
    market = _market_returns(n)
    monkeypatch.setattr(
        mod._history,
        "get_series",
        _fake_series({
            "WALMEX.MX": _series("WALMEX.MX", "MXN", [0.8 * r for r in market]),
            "NAFTRAC.MX": _series("NAFTRAC.MX", "USD", market),
        }),
    )
    notes: list[str] = []
    assert mod.compute_beta("WALMEX.MX", "MXN", notes) is None
    assert any("monedas distintas" in note for note in notes)


def test_too_few_observations_returns_no_beta(monkeypatch):
    n = 30
    market = _market_returns(n)
    monkeypatch.setattr(
        mod._history,
        "get_series",
        _fake_series({
            "WALMEX.MX": _series("WALMEX.MX", "MXN", [0.8 * r for r in market]),
            "NAFTRAC.MX": _series("NAFTRAC.MX", "MXN", market),
        }),
    )
    notes: list[str] = []
    assert mod.compute_beta("WALMEX.MX", "MXN", notes) is None
    assert any("al menos 52 semanas" in note for note in notes)


def test_currency_without_a_local_benchmark_says_so():
    notes: list[str] = []
    assert mod.compute_beta("BMW.DE", "EUR", notes) is None
    assert notes == ["No hay un referente local en EUR para calcular la beta."]


def test_while_the_history_seam_is_missing_the_beta_is_none_not_wrong():
    """Hoy ``get_series`` levanta NotImplementedError: se reporta el hueco, no se inventa."""
    notes: list[str] = []
    assert mod.compute_beta("WALMEX.MX", "MXN", notes) is None
    assert notes == ["La serie de precios v2 todavía no está disponible, así que la beta no se calculó."]


def test_yahoo_beta_is_only_a_fallback_for_dollars_and_says_what_it_is():
    notes: list[str] = []
    assert mod._yahoo_beta({"beta": 1.085}, "MXN", notes) is None, "la beta de Yahoo no aplica a la BMV"
    assert notes == []
    fallback = mod._yahoo_beta({"beta": 1.085}, "USD", notes)
    assert fallback["source"] == "yahoo"
    assert fallback["benchmark"] == "^GSPC"
    assert fallback["window"] == "5 años, mensual"
    assert fallback["value"] == 1.085
    assert fallback["adjusted"] == round(0.67 * 1.085 + 0.33, 4)  # 1.057
    assert any("S&P 500" in note for note in notes)
