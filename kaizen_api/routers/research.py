"""Ficha de emisora, estados financieros y dividendos (stream B3a).

Las otras rutas de B3a viven en ``events.py`` (``/v2/events``) e ``insiders.py``
(``/v2/insiders/{symbol}``); valuación y momentum son de B3b (``valuation.py``).

Lo que estas tres rutas corrigen del v1, y por lo que su ``meta.notes`` a veces trae aviso:

* Ninguna razón mezcla la moneda del precio con la de los estados. Si falta el tipo de cambio, la
  razón sale vacía en vez de salir mal (AAPL.MX cotiza en pesos y reporta en dólares).
* ``debtToEquity`` es una razón: Yahoo la publica en porcentaje y aquí se divide entre 100.
* Los estados son renglones REALES, de la SEC para emisores de EE. UU. y de Yahoo para el resto.
  Un trimestre que la emisora no reportó no aparece; no se fabrica dividiendo el año entre cuatro.
* La beta se calcula contra un referente local en la misma moneda. Si se usa la de Yahoo como
  respaldo, la respuesta lo dice y ``meta.fallback`` queda en ``true``.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.domain.fundamentals import get_dividends, get_instrument
from kaizen_api.domain.statements import get_statements
from kaizen_api.provenance import meta
from kaizen_api.routers import ERROR_RESPONSES, SymbolPath, cache_control
from kaizen_api.schemas import DividendsResponse, InstrumentResponse, StatementsResponse

router = APIRouter(prefix="/v2", tags=["investigación"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["instrument", "statements.real", "dividends"]

YAHOO_DELAY_MINUTES = 15
"""Yahoo publica los precios de la BMV y de EE. UU. con unos 15 minutos de retraso."""


@router.get(
    "/instrument/{symbol}",
    response_model=InstrumentResponse,
    dependencies=[cache_control("quotes")],
    summary="Ficha: cotización, fundamentales en la moneda del precio, beta y cobertura",
)
def instrument(symbol: SymbolPath) -> InstrumentResponse:
    data = get_instrument(symbol)
    notes = data.pop("notes")
    sources = data.pop("sources")
    fallback = data.pop("fallback")
    as_of = data.pop("as_of")
    data["meta"] = meta(
        ",".join(sources),
        as_of=as_of,
        delay_minutes=YAHOO_DELAY_MINUTES,
        fallback=fallback,
        notes=notes,
    )
    return data


@router.get(
    "/instrument/{symbol}/statements",
    response_model=StatementsResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Estados financieros reales (SEC o Yahoo), nunca sintetizados",
)
def statements(
    symbol: SymbolPath,
    freq: Annotated[Literal["annual", "quarterly"], Query(description="Anual o trimestral")] = "annual",
) -> StatementsResponse:
    data = get_statements(symbol, freq)
    notes = data.pop("notes")
    as_of = data.pop("as_of")
    data["meta"] = meta(data["source"], as_of=as_of, notes=notes)
    return data


@router.get(
    "/instrument/{symbol}/dividends",
    response_model=DividendsResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Dividendos pagados, suma de 12 meses y rendimiento",
)
def dividends(symbol: SymbolPath) -> DividendsResponse:
    data = get_dividends(symbol)
    notes = data.pop("notes")
    as_of = data.pop("as_of")
    data["meta"] = meta("yahoo", as_of=as_of, notes=notes)
    return data
