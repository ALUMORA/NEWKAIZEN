"""Routers HTTP. Aquí van las piezas compartidas por todos: validación de símbolos y fechas,
la marca de las rutas que todavía son stub y el registro de capacidades.

Este archivo está congelado bajo O: lo leen los doce routers y cambiarlo se pide en
``docs/requests/<stream>.md``. Dos cosas que SÍ cambian durante la fase 2 salieron de aquí a
archivos de B1, y se reexportan para que ningún router cambie sus imports:

* la caché HTTP (``CACHE_SECONDS``, ``cache_control``, ``no_store``) vive en
  ``kaizen_api/http_cache.py``;
* las respuestas de error de OpenAPI (``ERROR_RESPONSES``) viven en ``kaizen_api/http_responses.py``.

Cada router v2 expone:

* ``router``: el ``APIRouter`` con sus rutas (todas con ``response_model`` de ``schemas``).
* ``CAPABILITIES``: lista de capacidades (``schemas.KNOWN_CAPABILITIES``) que YA funcionan en ese
  router. ``/health`` las anuncia. Una ruta que todavía responde 501 no se anuncia.

Cada ruta que todavía responde 501 lleva ``@stub`` debajo del decorador del router. Es un dato, no
un comentario: ``tests/contract/test_schemas.py`` lo lee para saber a qué rutas exigirles el cuerpo
de error del contrato. Al implementar una ruta se borra esa línea junto con su
``raise not_implemented(...)`` y se agrega la capacidad a ``CAPABILITIES``.
"""

from __future__ import annotations

import datetime as _dt
import re
from collections.abc import Callable
from typing import Annotated, TypeVar

from fastapi import Depends, Path, Query

from kaizen_api.errors import ApiError, field_error, invalid_param
from kaizen_api.http_cache import CACHE_SECONDS, cache_control, no_store
from kaizen_api.http_responses import ERROR_RESPONSES
from kaizen_api.schemas import ISO_DATE_PATTERN, SYMBOL_PATTERN

__all__ = [
    "CACHE_SECONDS",
    "ERROR_RESPONSES",
    "MAX_SYMBOLS",
    "IsoDateQuery",
    "SymbolPath",
    "Symbols",
    "cache_control",
    "check_date_range",
    "is_stub",
    "no_store",
    "parse_symbols",
    "stub",
]

MAX_SYMBOLS = 50
_SYMBOL_RE = re.compile(SYMBOL_PATTERN)

_F = TypeVar("_F", bound=Callable)


def stub(endpoint: _F) -> _F:
    """Marca la función de una ruta que todavía no está implementada (levanta ``not_implemented``).

    Va debajo del ``@router.get(...)`` y devuelve la MISMA función, así que no cambia la firma ni el
    OpenAPI: solo le cuelga ``__kaizen_stub__``. Las pruebas de contrato leen esa marca en vez de
    adivinar por el texto del código, que daba un falso positivo si la ruta ya implementada
    conservaba un ``not_implemented(...)`` para una rama no soportada.

    Al implementar la ruta se borra esta línea y se agrega la capacidad a ``CAPABILITIES``; si se
    deja puesta junto con la capacidad, la prueba de contrato lo dice con nombre y apellido en vez
    de llamar a la ruta (que saldría a los proveedores).
    """
    endpoint.__kaizen_stub__ = True  # type: ignore[attr-defined]
    return endpoint


def is_stub(endpoint: Callable) -> bool:
    """¿La función de esta ruta lleva la marca ``@stub``?"""
    return getattr(endpoint, "__kaizen_stub__", False) is True


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
