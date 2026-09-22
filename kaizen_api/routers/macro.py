"""Macro de EE. UU.: Tesoro, diferenciales, VIX, DXY y Fed Funds (stream B2b).

Las tasas van como fracción, los diferenciales en puntos base y el VIX y el DXY como nivel. Cada
renglón trae fecha, valor previo y cambio. Movida sin cambios desde ``rates.py`` en M1 (conserva la
etiqueta ``tasas y macro`` en OpenAPI).
"""

from __future__ import annotations

from fastapi import APIRouter

from kaizen_api.domain.macro import get_us_macro
from kaizen_api.provenance import meta
from kaizen_api.routers import ERROR_RESPONSES, cache_control
from kaizen_api.schemas import UsMacroResponse

router = APIRouter(prefix="/v2", tags=["tasas y macro"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["macro.us"]


@router.get(
    "/macro/us",
    response_model=UsMacroResponse,
    dependencies=[cache_control("macro")],
    summary="Tesoro 3M, 2Y y 10Y, diferenciales, VIX, DXY y Fed Funds",
)
def macro_us() -> UsMacroResponse:
    data = get_us_macro()
    return UsMacroResponse(
        items=data["items"],
        meta=meta(
            data["source"],
            as_of=data["asOf"],
            stale=data["stale"],
            fallback=data["fallback"],
            notes=data["notes"],
        ),
    )
