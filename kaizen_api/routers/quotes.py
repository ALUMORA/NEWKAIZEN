"""Cotizaciones y tipo de cambio spot (stream B2a).

``/v2/quotes`` pide hasta 50 símbolos y devuelve los que sí tienen precio; los demás salen en
``missing``, no como error, porque una lista de seguimiento con un símbolo mal escrito no debería
tumbar la pantalla entera.

``/v2/fx`` da el USD/MXN: el FIX de Banxico cuando hay token y, si no, la cotización de mercado de
Yahoo marcada como sustituta. Nunca devuelve el 17.5 fijo del backend viejo: sin dato real contesta
503.
"""

from __future__ import annotations

import datetime as _dt
from typing import Annotated

from fastapi import APIRouter, Query

from kaizen_api.domain import fx as fx_domain
from kaizen_api.domain.universe import sector_label
from kaizen_api.provenance import iso_instant, meta
from kaizen_api.providers.yahoo import prices
from kaizen_api.routers import ERROR_RESPONSES, Symbols, cache_control
from kaizen_api.schemas import FX_PAIR_PATTERN, FxResponse, QuotesResponse

router = APIRouter(prefix="/v2", tags=["cotizaciones"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["quotes", "fx"]

FxPairQuery = Annotated[str, Query(pattern=FX_PAIR_PATTERN, description="Par sin separador", examples=["USDMXN"])]

TYPE_BY_QUOTE_TYPE = {
    "EQUITY": "equity",
    "ETF": "etf",
    "MUTUALFUND": "fund",
    "INDEX": "index",
    "CURRENCY": "fx",
    "CRYPTOCURRENCY": "crypto",
    "FUTURE": "commodity",
}
"""``quoteType`` de Yahoo a los tipos del contrato. Un valor que no esté aquí sale como ``null``."""

FIBRA_PREFIXES = ("FUNO", "FIBRA", "FMTY", "FINN", "FHIPO", "FSHOP", "FNOVA", "DANHOS", "STORAGE", "TERRA")
"""Las FIBRAs cotizan como acción en Yahoo; el contrato sí las distingue."""


def _instrument_type(symbol: str, info: dict) -> str | None:
    quote_type = str(info.get("quoteType") or "").upper()
    kind = TYPE_BY_QUOTE_TYPE.get(quote_type)
    if kind == "equity" and symbol.endswith(".MX") and symbol.startswith(FIBRA_PREFIXES):
        return "fibra"
    return kind


def _text(raw: object) -> str | None:
    """Texto sin espacios sobrantes, o ``None`` si Yahoo lo manda vacío o no lo manda."""
    text = str(raw).strip() if isinstance(raw, str) else ""
    return text or None


def _as_of(info: dict) -> str | None:
    """Instante del último precio, desde el epoch que manda Yahoo."""
    raw = info.get("regularMarketTime")
    if not isinstance(raw, (int, float)) or raw <= 0:
        return None
    return iso_instant(_dt.datetime.fromtimestamp(float(raw), _dt.UTC))


def _quote(symbol: str, info: dict) -> dict | None:
    """Una cotización del contrato, o ``None`` si Yahoo no trae precio para ese símbolo."""
    price = info.get("regularMarketPrice")
    if price is None:
        price = info.get("currentPrice")
    # ``GBp`` y ``ZAc`` son unidades menores: el proveedor ya las normaliza, y aquí se vuelve a
    # pedir el divisor por si el ``info`` llegó crudo. La operación es idempotente.
    currency, divisor = prices.normalize_currency(info.get("currency"))
    if price is None or len(currency) != 3:
        return None
    previous = info.get("regularMarketPreviousClose")
    if previous is None:
        previous = info.get("previousClose")
    price = float(price) / divisor
    previous = float(previous) / divisor if previous is not None else None
    change = price - previous if previous is not None else None
    # El porcentaje se recalcula: Yahoo lo manda en puntos porcentuales y el contrato pide fracción.
    change_pct = (change / previous) if (change is not None and previous) else None
    return {
        "symbol": symbol,
        "name": str(info.get("longName") or info.get("shortName") or symbol),
        "price": price,
        "previousClose": previous,
        "change": change,
        "changePct": change_pct,
        "currency": currency,
        "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "type": _instrument_type(symbol, info),
        "marketState": info.get("marketState"),
        "asOf": _as_of(info),
        # Del mismo ``info`` que trae el precio: el sector no cuesta otra llamada a Yahoo. Va en
        # español, como en los screeners; la industria no tiene catálogo de traducción y va tal cual.
        "sector": sector_label(_text(info.get("sector"))),
        "industry": _text(info.get("industry")),
    }


STALE_AFTER_DAYS = 4
"""Una cotización de más de 4 días naturales se marca ``stale`` (cubre un fin de semana largo)."""


def _stale_symbols(quotes: list[dict]) -> list[str]:
    """Símbolos cuya última cotización ya tiene días. Yahoo a veces sirve un precio viejo sin avisar.

    Pasa de verdad: para ``NAFTRAC.MX`` el resumen de Yahoo devuelve un precio de 2019 aunque su
    histórico esté al día. Publicarlo como "precio de hoy" sería justo lo que este rediseño quiere
    quitar, así que la respuesta sale marcada.
    """
    today = _dt.datetime.now(_dt.UTC).date()
    old = []
    for quote in quotes:
        raw = quote.get("asOf")
        if not raw:
            continue
        day = _dt.date.fromisoformat(raw[:10])
        if (today - day).days > STALE_AFTER_DAYS:
            old.append(quote["symbol"])
    return old


@router.get(
    "/quotes",
    response_model=QuotesResponse,
    dependencies=[cache_control("quotes")],
    summary="Cotización de hasta 50 símbolos",
)
def quotes(symbols: Symbols) -> QuotesResponse:
    infos = prices.fetch_infos(symbols)
    found, missing = [], []
    for symbol in symbols:
        quote = _quote(symbol, infos.get(symbol) or {})
        if quote is None:
            missing.append(symbol)
        else:
            found.append(quote)
    as_of = max((q["asOf"] for q in found if q["asOf"]), default=None)
    notes = []
    if missing:
        notes.append("Yahoo no tiene cotización de " + ", ".join(missing) + ".")
    old = _stale_symbols(found)
    if old:
        notes.append(
            "Yahoo trae la última cotización de " + ", ".join(old) + " con varios días de retraso, "
            "así que no es precio de hoy."
        )
    return {
        "quotes": found,
        "missing": missing,
        "meta": meta("yahoo", as_of=as_of, delay_minutes=prices.DELAY_MINUTES, stale=bool(old), notes=notes),
    }


@router.get(
    "/fx",
    response_model=FxResponse,
    dependencies=[cache_control("quotes")],
    summary="Tipo de cambio spot (FIX de Banxico si hay token, si no Yahoo marcado)",
)
def fx(pair: FxPairQuery = "USDMXN") -> FxResponse:
    quote = fx_domain.spot(pair)
    source = "banxico" if quote.source == fx_domain.BANXICO_FIX_SOURCE else "yahoo"
    return {
        "pair": pair.upper(),
        "rate": quote.rate,
        "asOf": quote.as_of,
        "source": quote.source,
        "stale": quote.stale,
        "meta": meta(
            source,
            as_of=quote.as_of,
            delay_minutes=None if quote.source == fx_domain.BANXICO_FIX_SOURCE else prices.DELAY_MINUTES,
            stale=quote.stale,
            fallback=quote.fallback,
            notes=quote.notes,
        ),
    }
