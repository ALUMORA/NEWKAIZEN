"""Mesa de tipo de cambio: monitor del peso, cruces, FIX por fecha y forward teórico (stream V5FX).

M5 dejó las rutas registradas con sus validaciones: plazo de 0 días o mayor a 365 y fecha fuera de
rango responden 400 ``INVALID_PARAM``; un parámetro con forma o valor inválido, 422
``VALIDATION_ERROR``. V5FX las implementó en ``domain/fxdesk.py`` (monitor, cruces y FIX),
``domain/dof_rule.py`` (regla del DOF) y ``domain/forward.py``. "Hoy" es la fecha de la Ciudad de
México y se le pasa al dominio como ``today``.
"""

from __future__ import annotations

import datetime as _dt
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from kaizen_api.domain import forward as forward_domain
from kaizen_api.domain import fxdesk as desk
from kaizen_api.errors import ApiError, field_error, invalid_param
from kaizen_api.http_cache import cache_control
from kaizen_api.routers import ERROR_RESPONSES, IsoDateQuery, check_date_range
from kaizen_api.schemas import (
    ISO_DATE_PATTERN,
    FixLookupResponse,
    FixTableResponse,
    FxCrossesResponse,
    FxForwardResponse,
    FxMonitorResponse,
)

router = APIRouter(prefix="/v2", tags=["tipo de cambio"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["fxdesk", "fxdesk.crosses", "fxdesk.fix", "fxdesk.forward"]

MONITOR_YEARS = (1, 3, 5, 10)
FIX_FIRST_DATE = _dt.date(1991, 11, 12)
"""Primer FIX publicado en el SIE (SF43718). Antes de esa fecha no hay nada que buscar."""
FIX_TABLE_MAX_DAYS = 3 * 366
FORWARD_DEFAULT_DAYS = (30, 91, 182, 365)
FORWARD_MAX_DAYS = 365
_MX = ZoneInfo("America/Mexico_City")


def out_of_range(field: str, message: str) -> ApiError:
    """400 ``INVALID_PARAM``: el parámetro tiene buena forma pero cae fuera de lo que el contrato admite."""
    return ApiError(400, "INVALID_PARAM", message, details=field_error(field, "out_of_range"))


def today_mx() -> _dt.date:
    return _dt.datetime.now(_MX).date()


def check_monitor_params(years: int) -> None:
    if years not in MONITOR_YEARS:
        raise invalid_param("query.years", "enum", "Los años pueden ser 1, 3, 5 o 10.")


def check_fix_date(date: str) -> _dt.date:
    day, _ = check_date_range(date, None)
    assert day is not None
    if day < FIX_FIRST_DATE:
        raise out_of_range("query.date", "No hay FIX antes del 12 de noviembre de 1991.")
    return day


def check_fix_table_params(start: str, end: str) -> tuple[_dt.date, _dt.date]:
    first, last = check_date_range(start, end)
    assert first is not None and last is not None
    if first < FIX_FIRST_DATE:
        raise out_of_range("query.start", "No hay FIX antes del 12 de noviembre de 1991.")
    if (last - first).days > FIX_TABLE_MAX_DAYS:
        raise out_of_range("query.end", "La tabla del FIX abarca hasta 3 años por consulta.")
    return first, last


def check_forward_params(days: str | None, date: str | None, *, today: _dt.date | None = None) -> list[int]:
    """Plazos en días del forward, ya validados.

    ``days`` y ``date`` no van juntos (422). Cada plazo va de 1 a 365 días y la fecha tiene que caer
    en ese mismo rango desde hoy; si no, 400 ``INVALID_PARAM``. Sin ninguno de los dos: 30, 91, 182
    y 365 días.
    """
    if days is not None and date is not None:
        raise invalid_param("query.date", "exclusive", "Pide plazos (days) o una fecha (date), no los dos.")
    if date is not None:
        target, _ = check_date_range(date, None)
        assert target is not None
        span = (target - (today or today_mx())).days
        if span < 1 or span > FORWARD_MAX_DAYS:
            raise out_of_range("query.date", "La fecha tiene que caer entre mañana y dentro de 365 días.")
        return [span]
    if days is None:
        return list(FORWARD_DEFAULT_DAYS)
    tenors: list[int] = []
    for part in days.split(","):
        tenor = int(part)
        if tenor < 1 or tenor > FORWARD_MAX_DAYS:
            raise out_of_range("query.days", "Cada plazo va de 1 a 365 días.")
        if tenor not in tenors:
            tenors.append(tenor)
    return sorted(tenors)


@router.get(
    "/fxdesk/monitor",
    response_model=FxMonitorResponse,
    dependencies=[cache_control("macro")],
    summary="Monitor del peso: FIX, rango de 52 semanas, cambios, volatilidad y posicionamiento CFTC",
)
def fx_monitor(
    years: Annotated[
        int, Query(description="Años de historia de la serie", json_schema_extra={"enum": list(MONITOR_YEARS)})
    ] = 1,
) -> FxMonitorResponse:
    check_monitor_params(years)
    return FxMonitorResponse.model_validate(desk.build_monitor(years, today_mx()))


@router.get(
    "/fxdesk/crosses",
    response_model=FxCrossesResponse,
    dependencies=[cache_control("macro")],
    summary="Cruces del peso contra otras monedas (canasta del SIE y latinoamericanas)",
)
def fx_crosses() -> FxCrossesResponse:
    return FxCrossesResponse.model_validate(desk.build_crosses(today_mx()))


@router.get(
    "/fxdesk/fix",
    response_model=FixLookupResponse,
    dependencies=[cache_control("macro")],
    summary="El FIX que aplica a una fecha, por fecha o con la regla del DOF (art. 20 del CFF)",
)
def fx_fix(
    date: Annotated[str, Query(pattern=ISO_DATE_PATTERN, description="Fecha YYYY-MM-DD", examples=["2026-09-30"])],
    rule: Annotated[Literal["fecha", "dof"], Query(description="fecha = el FIX de ese día; dof = regla del DOF")] = "fecha",
) -> FixLookupResponse:
    day = check_fix_date(date)
    return FixLookupResponse.model_validate(desk.lookup_fix(day, rule, today_mx()))


@router.get(
    "/fxdesk/fix-table",
    response_model=FixTableResponse,
    dependencies=[cache_control("macro")],
    summary="Tabla del FIX por fecha (hasta 3 años) con cierres y promedios de mes",
)
def fx_fix_table(
    start: Annotated[str, Query(pattern=ISO_DATE_PATTERN, description="Fecha inicial YYYY-MM-DD")],
    end: Annotated[str, Query(pattern=ISO_DATE_PATTERN, description="Fecha final YYYY-MM-DD")],
    rule: Annotated[Literal["fecha", "dof"], Query(description="fecha = el FIX de ese día; dof = regla del DOF")] = "fecha",
    month_end: Annotated[bool, Query(alias="monthEnd", description="true: rows trae solo el cierre de cada mes; monthEnds viene siempre")] = False,
) -> FixTableResponse:
    first, last = check_fix_table_params(start, end)
    return FixTableResponse.model_validate(desk.fix_table(first, last, rule, month_end, today_mx()))


@router.get(
    "/fxdesk/forward",
    response_model=FxForwardResponse,
    dependencies=[cache_control("macro")],
    summary="Forward teórico USD/MXN por paridad de tasas, sin margen bancario",
)
def fx_forward(
    days: Annotated[
        str | None,
        Query(pattern=r"^\d{1,9}(,\d{1,9}){0,11}$", description="Plazos en días separados por coma (1 a 365)"),
    ] = None,
    date: IsoDateQuery = None,
    mxn: Annotated[Literal["tiie", "cetes", "fondeo"], Query(description="Tasa de referencia en pesos")] = "tiie",
    usd: Annotated[Literal["ust", "sofr"], Query(description="Tasa de referencia en dólares")] = "ust",
) -> FxForwardResponse:
    today = today_mx()
    tenors = check_forward_params(days, date, today=today)
    return FxForwardResponse.model_validate(forward_domain.build_forward(tenors, mxn, usd, today))
