"""Respuestas de error que cada router publica en OpenAPI (stream B1).

``ERROR_RESPONSES`` es lo que los doce routers pasan como ``responses=`` al crear su ``APIRouter``,
así que es la lista de códigos que el contrato v2 anuncia para todas las rutas de datos. Vive aquí
y no en ``routers/__init__.py`` por la misma razón que ``http_cache.py``: la tabla de
``docs/OWNERSHIP.md`` le encarga a **B1** los códigos de estado y los límites de tasa, y eso no se
puede entregar desde un archivo congelado que leen todos. Los routers lo siguen importando desde
``kaizen_api.routers`` (que lo reexporta), así que B1 puede anunciar un código nuevo (por ejemplo el
429 ``RATE_LIMITED`` que documenta ``docs/api-v2.md``) sin abrir el archivo de ningún otro stream.

Ojo: agregar o quitar una entrada CAMBIA el OpenAPI de las 22 rutas de datos. El cuerpo sigue siendo
``schemas.ErrorBody``, que sí está congelado (regla 4 de ``docs/OWNERSHIP.md``): aquí se decide qué
códigos se anuncian, no qué forma tienen.
"""

from __future__ import annotations

from kaizen_api.schemas import ErrorBody


def _error(description: str) -> dict:
    return {"model": ErrorBody, "description": description}


ERROR_RESPONSES: dict[int | str, dict] = {
    400: _error("Símbolo inválido (INVALID_SYMBOL)"),
    401: _error("Falta sesión o expiró (UNAUTHORIZED); solo con AUTH_REQUIRED"),
    422: _error("Parámetro inválido (VALIDATION_ERROR)"),
    500: _error("Error interno (INTERNAL)"),
    501: _error("Todavía no implementado (NOT_IMPLEMENTED)"),
    503: _error(
        "Fuente caída o sin configurar (UPSTREAM_UNAVAILABLE, NOT_CONFIGURED), "
        "o servidor saturado (RATE_LIMITED, con Retry-After)"
    ),
}
"""Códigos de error que anuncia en OpenAPI cada ruta de datos v2."""
