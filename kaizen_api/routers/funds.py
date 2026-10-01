"""ETF por dentro: clases de activo, sectores y principales posiciones (stream V5PF).

Lo dejó M5 con la ruta del contrato registrada y en ``@stub`` (un símbolo mal formado ya responde
400 ``INVALID_SYMBOL``). V5PF borra ``@stub`` y el ``raise not_implemented(...)`` al implementarla y
agrega ``funds`` a ``CAPABILITIES``.
"""

from __future__ import annotations

from fastapi import APIRouter

from kaizen_api.errors import not_implemented
from kaizen_api.http_cache import cache_control
from kaizen_api.routers import ERROR_RESPONSES, SymbolPath, stub
from kaizen_api.schemas import FundResponse

router = APIRouter(prefix="/v2", tags=["fondos"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []


@router.get(
    "/funds/{symbol}",
    response_model=FundResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Qué tiene adentro un ETF: comisión, clases de activo, sectores y 10 principales posiciones",
)
@stub
def fund(symbol: SymbolPath) -> FundResponse:
    raise not_implemented("GET /v2/funds/{symbol}")
