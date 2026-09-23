"""Screeners: factores, Fórmula Mágica y FIBRAs (stream B3c).

Las tres rutas leen los mismos proveedores (``info`` de Yahoo y, según el caso, estados
financieros o una descarga en lote de cierres), por eso comparten la clase de caché
``screeners`` (12 h): son datos que no cambian intradía y cada consulta cuesta decenas de llamadas.

Ninguna de las tres emite lenguaje de compra o venta. El screener de factores publica pruebas
"cumple / no cumple" contra umbrales escritos, la fórmula mágica publica lugares y las FIBRAs una
señal descriptiva de precio contra valor en libros. ``/v2/insiders/{symbol}`` es de B3a y vive en
``insiders.py``.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.domain.screeners import factors as factors_domain
from kaizen_api.domain.screeners import fibras as fibras_domain
from kaizen_api.domain.screeners import magic as magic_domain
from kaizen_api.domain.universe import custom_universe, fetch_symbols, get_universe
from kaizen_api.errors import ApiError, invalid_param
from kaizen_api.provenance import meta
from kaizen_api.routers import ERROR_RESPONSES, cache_control, parse_symbols
from kaizen_api.schemas import FactorsResponse, FibrasResponse, MagicResponse

router = APIRouter(prefix="/v2", tags=["screeners"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["screeners.factors", "screeners.magic", "screeners.fibras"]

MAX_CUSTOM_UNIVERSE = 50
MAX_FIBRAS_EXTRA = 20

DELAY_MINUTES = 15
"""Yahoo publica los precios con unos 15 minutos de retraso en las dos plazas."""


def _unknown_symbols(symbols: list[str]) -> list[str]:
    """De un universo propio que no dio datos, los símbolos que Yahoo dice no conocer.

    Solo se llama cuando ninguna emisora trajo datos, para separar "no existe" (404) de "el
    proveedor no contestó" (503). Pide solo el ``info``, que es lo que distingue los dos casos.
    """
    fetched, _pending = fetch_symbols(symbols)
    return [s for s in symbols if fetched.get(s) is not None and fetched[s].not_found]


def _upstream_down(what: str) -> ApiError:
    return ApiError(
        503,
        "UPSTREAM_UNAVAILABLE",
        f"No pudimos leer los datos de {what}. Vuelve a intentar en unos minutos.",
    )


@router.get(
    "/screeners/factors",
    response_model=FactorsResponse,
    dependencies=[cache_control("screeners")],
    summary="Puntajes por factor (valor, calidad, momentum, baja volatilidad, crecimiento)",
)
def factors(
    universe: Annotated[Literal["mx", "us", "custom"], Query(description="custom exige symbols")] = "mx",
    symbols: Annotated[str | None, Query(max_length=MAX_CUSTOM_UNIVERSE * 21, description="Solo con universe=custom")] = None,
) -> FactorsResponse:
    if universe == "custom":
        if not symbols:
            raise invalid_param("query.symbols", "missing", "Con universe=custom indica los símbolos.")
        chosen = custom_universe(parse_symbols(symbols, limit=MAX_CUSTOM_UNIVERSE))
    elif symbols:
        raise invalid_param("query.symbols", "extra_forbidden", "symbols solo aplica con universe=custom.")
    else:
        chosen = get_universe(universe)

    board = factors_domain.get_factors(chosen)
    if not any(row["coverage"] > 0 for row in board["rows"]):
        if universe == "custom":
            unknown = _unknown_symbols(chosen.symbols)
            if unknown and len(unknown) == len(chosen.symbols):
                raise ApiError(
                    404,
                    "NOT_FOUND",
                    "No encontramos datos de " + ", ".join(unknown) + ". Revisa los símbolos.",
                )
        raise _upstream_down("las emisoras del universo")
    return {
        "universe": board["universe"],
        "method": board["method"],
        "rows": board["rows"],
        "meta": meta(
            "yahoo,computed",
            as_of=board["asOf"],
            delay_minutes=DELAY_MINUTES,
            notes=board["notes"],
        ),
    }


@router.get(
    "/screeners/magic",
    response_model=MagicResponse,
    dependencies=[cache_control("screeners")],
    summary="Fórmula Mágica de Greenblatt con EBIT reportado",
)
def magic(universe: Annotated[Literal["us", "mx"], Query(description="Universo")] = "us") -> MagicResponse:
    table = magic_domain.get_magic(universe)
    if not table["rows"] and table["partial"]:
        raise _upstream_down("las emisoras del universo")
    return {
        "universe": table["universe"],
        "rows": table["rows"],
        "excluded": table["excluded"],
        "partial": table["partial"],
        "meta": meta(
            "yahoo,computed",
            as_of=table["asOf"],
            delay_minutes=DELAY_MINUTES,
            notes=table["notes"],
        ),
    }


@router.get(
    "/screeners/fibras",
    response_model=FibrasResponse,
    dependencies=[cache_control("screeners")],
    summary="FIBRAs: rendimiento de distribución, P/NAV, LTV y diferencial contra CETES",
)
def fibras(
    extra: Annotated[str | None, Query(max_length=MAX_FIBRAS_EXTRA * 21, description="FIBRAs extra separadas por coma")] = None,
) -> FibrasResponse:
    more = parse_symbols(extra, limit=MAX_FIBRAS_EXTRA, param="extra") if extra else []
    table = fibras_domain.get_fibras_v2(more)
    if not any(row["price"] is not None for row in table["rows"]):
        raise _upstream_down("las FIBRAs")
    source = "yahoo,computed"
    if table.get("rateSource"):
        source += "," + table["rateSource"]
    return {
        "rows": table["rows"],
        "cetes28": table["cetes28"],
        "meta": meta(
            source,
            as_of=table["asOf"],
            delay_minutes=DELAY_MINUTES,
            stale=bool(table.get("rateStale")),
            fallback=bool(table.get("rateFallback")),
            notes=table["notes"],
        ),
    }
