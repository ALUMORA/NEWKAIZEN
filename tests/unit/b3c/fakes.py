"""Datos de mentira para las pruebas de B3c.

Las costuras de B3a (fundamentales) y B2a (precios) todavía las está escribiendo otro stream, así
que aquí se arman ``SymbolData`` y estados financieros a mano. Lo que se prueba es la cuenta, no
que Yahoo conteste.
"""

from __future__ import annotations

import pandas as pd

from kaizen_api.domain.universe import Member, SymbolData, Universe


def info(**over) -> dict:
    """Un ``info`` de Yahoo con lo mínimo y lo que se quiera encima."""
    base = {
        "currency": "USD",
        "financialCurrency": "USD",
        "longName": "Empresa de prueba",
        "sector": "Technology",
        "marketCap": 1_000_000_000.0,
        "currentPrice": 100.0,
    }
    base.update(over)
    return base


def frame(rows: dict[str, list[float]], dates: list[str]) -> pd.DataFrame:
    """Un estado financiero como los que entrega yfinance: renglones por concepto, columnas por año."""
    return pd.DataFrame(rows, index=[pd.Timestamp(d) for d in dates]).T


def symbol(sym: str, *, income=None, balance=None, cashflow=None, error=None, **over) -> SymbolData:
    return SymbolData(
        symbol=sym,
        info={} if error else info(**over),
        income=income,
        balance=balance,
        cashflow=cashflow,
        error=error,
    )


def universe(*members: tuple[str, str, str], uid: str = "prueba") -> Universe:
    """``universe(("AAPL", "Apple", "Technology"), ...)``."""
    return Universe(
        id=uid,
        name="Universo de prueba",
        currency="USD",
        members=tuple(Member(symbol=s, name=n, sector=sec) for s, n, sec in members),
    )


def weekly(start: float, weeks: int, step: float = 1.0, first_month: int = 1, year: int = 2025) -> list[tuple[str, float]]:
    """Serie semanal sintética: una observación cada 7 días, subiendo ``step`` por semana."""
    out = []
    day = pd.Timestamp(year=year, month=first_month, day=6)
    for i in range(weeks):
        out.append((day.date().isoformat(), start + i * step))
        day = day + pd.Timedelta(days=7)
    return out
