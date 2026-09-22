"""Errores del API v2: ``ApiError`` y los manejadores que dan SIEMPRE ``{"error": {code, message}}``.

Reglas:

* Status HTTP real (nada de 200 con ``{"error"}``; eso solo existe en las rutas v1).
* ``message`` en español, apto para el usuario. Nunca texto de excepciones ni trazas.
* ``details`` opcional, sin eco de lo que mandó el cliente (podría ser una contraseña).
* Toda respuesta de error lleva ``Cache-Control: no-store``.

Uso en una ruta::

    raise ApiError(503, "UPSTREAM_UNAVAILABLE", "Yahoo no respondió. Intenta más tarde.")
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("kaizen_api")

MESSAGES: dict[str, str] = {
    "VALIDATION_ERROR": "Algún dato de la solicitud no es válido.",
    "INVALID_SYMBOL": "El símbolo no es válido. Usa letras, números y . - ^ = $ (hasta 20).",
    "BAD_REQUEST": "La solicitud no es válida.",
    "UNAUTHORIZED": "Necesitas iniciar sesión para ver esto.",
    "FORBIDDEN": "No tienes permiso para ver esto.",
    "NOT_FOUND": "No encontramos lo que buscas.",
    "METHOD_NOT_ALLOWED": "Esta ruta no acepta ese método.",
    "RATE_LIMITED": "Demasiados intentos. Espera un momento y vuelve a intentarlo.",
    "UPSTREAM_UNAVAILABLE": "La fuente de datos no respondió. Intenta más tarde.",
    "NOT_CONFIGURED": "Esta fuente de datos no está configurada en el servidor.",
    "NOT_IMPLEMENTED": "Esta función todavía no está disponible.",
    "INTERNAL": "Ocurrió un error inesperado. Intenta de nuevo en un momento.",
}

STATUS_CODES: dict[int, str] = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    501: "NOT_IMPLEMENTED",
    502: "UPSTREAM_UNAVAILABLE",
    503: "UPSTREAM_UNAVAILABLE",
}

SYMBOL_PARAMS = frozenset({"symbol", "symbols", "extra"})
"""Parámetros cuyo error de FORMATO se reporta como INVALID_SYMBOL (400) y no como 422."""
_FORMAT_ERRORS = frozenset({"string_pattern_mismatch", "string_too_long", "string_too_short"})

_ERROR_HEADERS = {"Cache-Control": "no-store"}


class ApiError(Exception):
    """Error con status HTTP real y código del contrato. ``message`` ya va en español."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str | None = None,
        details: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
    ):
        super().__init__(code)
        self.status = int(status)
        self.code = code
        self.message = message or MESSAGES.get(code, MESSAGES["INTERNAL"])
        self.details = dict(details) if details else None
        self.headers = dict(headers) if headers else None

    def __repr__(self) -> str:
        return f"ApiError({self.status}, {self.code!r})"


def error_body(code: str, message: str | None = None, details: Mapping[str, Any] | None = None) -> dict:
    err: dict[str, Any] = {"code": code, "message": message or MESSAGES.get(code, MESSAGES["INTERNAL"])}
    if details:
        err["details"] = dict(details)
    return {"error": err}


def error_response(
    status: int,
    code: str,
    message: str | None = None,
    details: Mapping[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    merged = dict(_ERROR_HEADERS)
    if headers:
        merged.update(headers)
    return JSONResponse(status_code=status, content=error_body(code, message, details), headers=merged)


def field_error(field: str, type_: str) -> dict:
    """``details`` de un error de parámetro, con la misma forma que los 422 automáticos."""
    return {"fields": [{"field": field, "type": type_}]}


def invalid_param(field: str, type_: str, message: str | None = None) -> ApiError:
    """422 VALIDATION_ERROR para un parámetro que pasó el tipo pero no la regla de negocio."""
    return ApiError(422, "VALIDATION_ERROR", message, details=field_error(field, type_))


def not_implemented(endpoint: str) -> ApiError:
    """Error estándar de las rutas v2 registradas que un stream B todavía no implementa."""
    return ApiError(501, "NOT_IMPLEMENTED", details={"endpoint": endpoint})


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return error_response(exc.status, exc.code, exc.message, exc.details, exc.headers)


def _field(loc: tuple | list) -> str:
    return ".".join(str(p) for p in loc)


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = list(exc.errors())
    fields = [{"field": _field(e.get("loc", ())), "type": e.get("type", "")} for e in errors]
    symbol_only = bool(errors) and all(
        len(e.get("loc", ())) >= 2
        and e["loc"][0] in ("path", "query")
        and e["loc"][-1] in SYMBOL_PARAMS
        and e.get("type") in _FORMAT_ERRORS
        for e in errors
    )
    if symbol_only:
        return error_response(400, "INVALID_SYMBOL", details={"fields": fields})
    return error_response(422, "VALIDATION_ERROR", details={"fields": fields})


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    status = exc.status_code
    code = STATUS_CODES.get(status) or ("INTERNAL" if status >= 500 else "BAD_REQUEST")
    headers = {k: v for k, v in (exc.headers or {}).items() if k.lower() in ("allow", "retry-after", "www-authenticate")}
    return error_response(status, code, headers=headers)


async def internal_error_handler(request: Request, exc: Exception) -> JSONResponse:
    state = request.scope.get("state")
    rid = state.get("request_id") if isinstance(state, dict) else None
    logger.error("error interno en %s %s rid=%s", request.method, request.url.path, rid, exc_info=exc)
    return error_response(500, "INTERNAL")


def install_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, internal_error_handler)
