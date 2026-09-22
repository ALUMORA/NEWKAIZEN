"""Macro de EE. UU.: Tesoro, diferenciales, VIX, DXY y Fed Funds (stream B2b).

Responde 501 NOT_IMPLEMENTED hasta que B2b la implemente; al hacerlo, agrega su capacidad a
``CAPABILITIES``. Movida sin cambios desde ``rates.py`` en M1 (conserva la etiqueta
``tasas y macro`` en OpenAPI).
"""

from __future__ import annotations

from fastapi import APIRouter

from kaizen_api.errors import not_implemented
from kaizen_api.routers import ERROR_RESPONSES, cache_control, stub
from kaizen_api.schemas import UsMacroResponse

router = APIRouter(prefix="/v2", tags=["tasas y macro"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []


@router.get(
    "/macro/us",
    response_model=UsMacroResponse,
    dependencies=[cache_control("macro")],
    summary="Tesoro 3M, 2Y y 10Y, diferenciales, VIX, DXY y Fed Funds",
)
@stub
def macro_us() -> UsMacroResponse:
    raise not_implemented("GET /v2/macro/us")
