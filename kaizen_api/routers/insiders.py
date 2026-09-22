"""Operaciones de consejeros y directivos (stream B3a).

Movida sin cambios desde ``screeners.py`` en M1 (conserva la etiqueta ``screeners`` en OpenAPI).

Fuente preferida: la Forma 4 ante la SEC, que trae el código real de la operación (P compra,
S venta, A otorgamiento, M ejercicio) y la casilla del plan 10b5-1. Yahoo queda de respaldo con
su texto libre y sin casilla. El resumen cuenta solo mercado abierto: los premios y los
ejercicios de opción son compensación, no una señal de que alguien esté comprando.
"""

from __future__ import annotations

from fastapi import APIRouter

from kaizen_api.domain.screeners.insiders import get_insiders_v2
from kaizen_api.provenance import meta
from kaizen_api.routers import ERROR_RESPONSES, SymbolPath, cache_control
from kaizen_api.schemas import InsidersResponse

router = APIRouter(prefix="/v2", tags=["screeners"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["insiders"]


@router.get(
    "/insiders/{symbol}",
    response_model=InsidersResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Operaciones de consejeros y directivos",
)
def insiders(symbol: SymbolPath) -> InsidersResponse:
    data = get_insiders_v2(symbol)
    return {
        "items": data["items"],
        "summary": data["summary"],
        "meta": meta(",".join(data["sources"]), as_of=data["as_of"], notes=data["notes"]),
    }
