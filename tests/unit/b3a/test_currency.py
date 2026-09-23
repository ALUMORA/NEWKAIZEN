"""Unidades menores y conversión de la moneda de los estados a la del precio."""

from __future__ import annotations

import pytest

from kaizen_api.domain import currency as mod
from kaizen_api.domain.currency import Converter, normalize_currency, scale_minor
from kaizen_api.errors import ApiError


@pytest.mark.parametrize(
    "code,expected",
    [
        ("GBp", ("GBP", 100.0)),
        ("GBX", ("GBP", 100.0)),
        ("ZAc", ("ZAR", 100.0)),
        ("ILA", ("ILS", 100.0)),
        ("GBP", ("GBP", 1.0)),
        ("mxn", ("MXN", 1.0)),
        ("usd", ("USD", 1.0)),
        ("", (None, 1.0)),
        (None, (None, 1.0)),
        ("PESOS", (None, 1.0)),
        (17.5, (None, 1.0)),
    ],
)
def test_normalize_currency(code, expected):
    assert normalize_currency(code) == expected


def test_scale_minor_divides_pennies_into_pounds():
    _iso, divisor = normalize_currency("GBp")
    assert scale_minor(12345.0, divisor) == 123.45
    assert scale_minor(None, divisor) is None
    assert scale_minor("nada", divisor) is None
    assert scale_minor(10.0, 1.0) == 10.0


def test_same_currency_is_the_identity_and_reports_no_conversion():
    conv = Converter("MXN", "MXN")
    assert conv.same and conv.ok
    assert conv.to_price(1_000.0) == 1_000.0
    assert conv.used() is None
    assert conv.failure is None


def test_converts_with_the_fx_seam_and_reports_the_rate(monkeypatch):
    calls: list[int] = []

    def fake_spot():
        calls.append(1)
        return _quote(18.5, "2026-09-21")

    monkeypatch.setattr(mod, "fx_spot", fake_spot)
    conv = Converter("USD", "MXN")
    assert conv.ok
    assert conv.rate == 18.5
    assert conv.to_price(100.0) == 1850.0
    assert conv.to_price(None) is None
    assert conv.used() == {"pair": "USDMXN", "rate": 18.5, "asOf": "2026-09-21"}
    # El tipo de cambio se pide UNA sola vez aunque se conviertan muchos montos.
    assert calls == [1]


def test_without_the_fx_seam_nothing_gets_mixed(monkeypatch):
    def not_yet():
        raise NotImplementedError("el tipo de cambio lo implementa el stream B2")

    monkeypatch.setattr(mod, "fx_spot", not_yet)
    conv = Converter("USD", "MXN")
    assert not conv.ok
    assert conv.to_price(100.0) is None
    assert conv.used() is None
    assert conv.fallback is False
    assert "tipo de cambio USDMXN" in conv.failure


def test_upstream_error_becomes_a_spanish_reason(monkeypatch):
    def upstream():
        raise ApiError(503, "UPSTREAM_UNAVAILABLE", "Banxico no respondió.")

    monkeypatch.setattr(mod, "fx_spot", upstream)
    conv = Converter("USD", "MXN")
    assert not conv.ok
    assert conv.failure == "Banxico no respondió."


def test_an_unsupported_pair_is_a_reason_not_a_crash(monkeypatch):
    monkeypatch.setattr(mod, "fx_spot", lambda: _quote(18.5, "2026-09-21"))
    conv = Converter("GBP", "USD")
    assert not conv.ok
    assert "GBPUSD" in conv.failure


def test_a_rate_of_zero_is_not_a_rate(monkeypatch):
    monkeypatch.setattr(mod, "fx_spot", lambda: _quote(0.0, "2026-09-21"))
    conv = Converter("USD", "MXN")
    assert not conv.ok
    assert "No se pudo obtener el tipo de cambio USDMXN" in conv.failure


def test_unknown_financial_currency_blocks_the_conversion():
    conv = Converter(None, "MXN")
    assert not conv.ok
    assert conv.pair is None
    assert conv.failure == "Yahoo no dice en qué moneda están los estados financieros."


def _quote(rate: float, as_of: str, source: str = "banxico_fix", fallback: bool = False, stale: bool = False):
    from kaizen_api.domain.fx import FxQuote

    notes = ["El FIX de Banxico no está disponible, así que este dato viene del mercado en Yahoo."] if fallback else []
    return FxQuote(rate=rate, as_of=as_of, source=source, stale=stale, fallback=fallback, notes=notes)


def test_used_says_which_day_the_rate_is_from(monkeypatch):
    """``fxUsed.asOf`` es la fecha de la barra de FX que se usó, no ``null``."""
    monkeypatch.setattr(mod, "fx_spot", lambda: _quote(18.5, "2026-09-19"))
    conv = Converter("USD", "MXN")
    assert conv.used() == {"pair": "USDMXN", "rate": 18.5, "asOf": "2026-09-19"}
    assert conv.to_price(100.0) == 1850.0
    assert conv.fallback is False
    assert conv.stale is False


def test_a_yahoo_rate_is_a_fallback_and_says_so(monkeypatch):
    monkeypatch.setattr(mod, "fx_spot", lambda: _quote(17.3, "2026-09-22", source="yahoo", fallback=True))
    conv = Converter("USD", "MXN")
    assert conv.used()["asOf"] == "2026-09-22"
    assert conv.fallback is True
    assert conv.source == "yahoo"
    assert any("Yahoo" in note for note in conv.notes)


def test_the_inverse_pair_divides_by_the_same_bar(monkeypatch):
    """Estados en pesos y precio en dólares: el tipo es 1/USDMXN y la fecha es la misma."""
    monkeypatch.setattr(mod, "fx_spot", lambda: _quote(20.0, "2026-09-18", stale=True))
    conv = Converter("MXN", "USD")
    assert conv.used() == {"pair": "MXNUSD", "rate": 0.05, "asOf": "2026-09-18"}
    assert conv.stale is True
