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
    calls: list[tuple] = []

    def fake_convert(amount, from_ccy, to_ccy, on=None):
        calls.append((amount, from_ccy, to_ccy, on))
        return amount * 18.5

    monkeypatch.setattr(mod, "fx_convert", fake_convert)
    conv = Converter("USD", "MXN")
    assert conv.ok
    assert conv.rate == 18.5
    assert conv.to_price(100.0) == 1850.0
    assert conv.to_price(None) is None
    assert conv.used() == {"pair": "USDMXN", "rate": 18.5, "asOf": None}
    # El tipo de cambio se pide UNA sola vez aunque se conviertan muchos montos.
    assert calls == [(1.0, "USD", "MXN", None)]


def test_without_the_fx_seam_nothing_gets_mixed(monkeypatch):
    def not_yet(amount, from_ccy, to_ccy, on=None):
        raise NotImplementedError("convert entre monedas distintas lo implementa el stream B2")

    monkeypatch.setattr(mod, "fx_convert", not_yet)
    conv = Converter("USD", "MXN")
    assert not conv.ok
    assert conv.to_price(100.0) is None
    assert conv.used() is None
    assert "tipo de cambio USDMXN" in conv.failure


def test_upstream_error_becomes_a_spanish_reason(monkeypatch):
    def upstream(amount, from_ccy, to_ccy, on=None):
        raise ApiError(503, "UPSTREAM_UNAVAILABLE", "Banxico no respondió.")

    monkeypatch.setattr(mod, "fx_convert", upstream)
    conv = Converter("USD", "MXN")
    assert not conv.ok
    assert conv.failure == "Banxico no respondió."


def test_a_rate_of_zero_is_not_a_rate(monkeypatch):
    monkeypatch.setattr(mod, "fx_convert", lambda amount, f, t, on=None: 0.0)
    conv = Converter("USD", "MXN")
    assert not conv.ok
    assert "No se pudo obtener el tipo de cambio USDMXN" in conv.failure


def test_unknown_financial_currency_blocks_the_conversion():
    conv = Converter(None, "MXN")
    assert not conv.ok
    assert conv.pair is None
    assert conv.failure == "Yahoo no dice en qué moneda están los estados financieros."
