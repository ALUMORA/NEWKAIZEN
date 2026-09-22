"""Routers HTTP. Aquí van las piezas compartidas por todos: caché HTTP, validación de símbolos,
respuestas de error para OpenAPI y el registro de capacidades.

Cada router v2 expone:

* ``router``: el ``APIRouter`` con sus rutas (todas con ``response_model`` de ``schemas``).
* ``CAPABILITIES``: lista de capacidades (``schemas.KNOWN_CAPABILITIES``) que YA funcionan en ese
  router. ``/health`` las anuncia. Una ruta que todavía responde 501 no se anuncia.
"""

from __future__ import annotations

import datetime as _dt
import re
from typing import Annotated, Any

from fastapi import Depends, Path, Query, Response

from kaizen_api.errors import ApiError, field_error, invalid_param
from kaizen_api.schemas import ISO_DATE_PATTERN, SYMBOL_PATTERN, ErrorBody

CACHE_SECONDS: dict[str, int] = {
    "quotes": 30,
    "history": 3600,
    "fundamentals": 21600,
    "macro": 3600,
    "news": 600,
    "screeners": 43200,
}
"""``Cache-Control: private, max-age=<n>`` por clase de dato (spec v2)."""

MAX_SYMBOLS = 50
_SYMBOL_RE = re.compile(SYMBOL_PATTERN)


def cache_control(data_class: str) -> Any:
    """Dependencia que pone ``Cache-Control: private, max-age=<n>`` en la respuesta exitosa.

    Los errores salen con ``no-store`` (lo ponen los manejadores de ``errors.py``).
    """
    seconds = CACHE_SECONDS[data_class]
    value = f"private, max-age={seconds}"

    def _set_cache_control(response: Response) -> None:
        response.headers["Cache-Control"] = value

    _set_cache_control.__name__ = f"cache_{data_class}"
    return Depends(_set_cache_control)


def no_store(response: Response) -> None:
    """Para respuestas que nunca deben guardarse (salud, sesión)."""
    response.headers["Cache-Control"] = "no-store"


def _error(description: str) -> dict:
    return {"model": ErrorBody, "description": description}


ERROR_RESPONSES: dict[int | str, dict] = {
    400: _error("Símbolo inválido (INVALID_SYMBOL)"),
    401: _error("Falta sesión o expiró (UNAUTHORIZED); solo con AUTH_REQUIRED"),
    422: _error("Parámetro inválido (VALIDATION_ERROR)"),
    500: _error("Error interno (INTERNAL)"),
    501: _error("Todavía no implementado (NOT_IMPLEMENTED)"),
    503: _error("Fuente caída o sin configurar (UPSTREAM_UNAVAILABLE, NOT_CONFIGURED)"),
}

SymbolPath = Annotated[
    str,
    Path(
        pattern=SYMBOL_PATTERN,
        description="Símbolo (se pasa a mayúsculas). `.MX` = BMV/SIC en MXN.",
        examples=["WALMEX.MX"],
    ),
]


def parse_symbols(raw: str, *, limit: int = MAX_SYMBOLS, param: str = "symbols") -> list[str]:
    """``"a,B, c"`` a ``["A", "B", "C"]`` sin duplicados y en orden.

    Símbolo mal formado: ``ApiError`` 400 INVALID_SYMBOL. Lista vacía o de más de ``limit``:
    422 VALIDATION_ERROR.
    """
    items: list[str] = []
    bad: list[str] = []
    for part in raw.split(","):
        sym = part.strip()
        if not sym:
            continue
        if not _SYMBOL_RE.fullmatch(sym):
            bad.append(sym[:25])
            continue
        up = sym.upper()
        if up not in items:
            items.append(up)
    if bad:
        raise ApiError(400, "INVALID_SYMBOL", details=field_error(f"query.{param}", "string_pattern_mismatch"))
    if not items:
        raise invalid_param(f"query.{param}", "missing", "Indica al menos un símbolo.")
    if len(items) > limit:
        raise invalid_param(f"query.{param}", "too_long", f"Puedes pedir hasta {limit} símbolos a la vez.")
    return items


def symbols_query(
    symbols: Annotated[
        str,
        Query(
            min_length=1,
            max_length=MAX_SYMBOLS * 21,
            description=f"Símbolos separados por coma (hasta {MAX_SYMBOLS})",
            examples=["WALMEX.MX,AAPL"],
        ),
    ],
) -> list[str]:
    return parse_symbols(symbols)


Symbols = Annotated[list[str], Depends(symbols_query)]


IsoDateQuery = Annotated[
    str | None,
    Query(pattern=ISO_DATE_PATTERN, description="Fecha YYYY-MM-DD", examples=["2026-01-02"]),
]


def check_date_range(start: str | None, end: str | None) -> tuple[_dt.date | None, _dt.date | None]:
    """Convierte ``start``/``end`` a fechas reales y exige ``start <= end`` (si no, 422)."""
    parsed: list[_dt.date | None] = []
    for name, value in (("start", start), ("end", end)):
        if value is None:
            parsed.append(None)
            continue
        try:
            parsed.append(_dt.date.fromisoformat(value))
        except ValueError as exc:
            raise invalid_param(f"query.{name}", "date_invalid", "La fecha no existe.") from exc
    first, last = parsed
    if first and last and first > last:
        raise invalid_param("query.start", "date_order", "La fecha inicial es posterior a la final.")
    return first, last
