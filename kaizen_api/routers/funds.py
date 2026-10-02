"""ETF por dentro: clases de activo, sectores y principales posiciones (stream V5PF).

Un símbolo mal formado responde 400 ``INVALID_SYMBOL``; uno sin composición en Yahoo (NAFTRAC y
los ETF de la BMV, o una acción) responde 404 ``NOT_FOUND`` con ``details.reason`` 'sin datos de
fondo'. La lógica vive en ``kaizen_api/domain/funds.py``.
"""

from __future__ import annotations

from fastapi import APIRouter

from kaizen_api.domain.funds import get_fund
from kaizen_api.http_cache import cache_control
from kaizen_api.provenance import meta, utc_now
from kaizen_api.routers import ERROR_RESPONSES, SymbolPath
from kaizen_api.schemas import FundResponse

router = APIRouter(prefix="/v2", tags=["fondos"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["funds"]


@router.get(
    "/funds/{symbol}",
    response_model=FundResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Qué tiene adentro un ETF: comisión, clases de activo, sectores y 10 principales posiciones",
)
def fund(symbol: SymbolPath) -> FundResponse:
    data = get_fund(symbol, utc_now().date().isoformat())
    notes = data.pop("notes")
    as_of = data.pop("as_of")
    return {**data, "meta": meta("yahoo", as_of=as_of, notes=notes)}
