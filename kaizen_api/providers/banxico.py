"""SIE de Banxico (stream B2). Por ahora solo el control de configuración.

Series conocidas: SF43718 (FIX) y SF61745 (tasa objetivo). Cualquier otra se verifica contra el
endpoint de metadatos del SIE en una prueba antes de usarse.
"""

from __future__ import annotations

from kaizen_api.errors import ApiError
from kaizen_api.settings import get_settings

SIE_BASE_URL = "https://www.banxico.org.mx/SieAPIRest/service/v1"
SERIES_FIX = "SF43718"
SERIES_TARGET = "SF61745"


def require_token() -> str:
    """Token del SIE o ``ApiError`` 503 NOT_CONFIGURED si no está configurado."""
    token = get_settings().banxico_token
    if not token:
        raise ApiError(503, "NOT_CONFIGURED", "Falta configurar el token de Banxico en el servidor.")
    return token


def fetch_series(series_ids: list[str], start: str | None = None, end: str | None = None) -> dict:
    """Observaciones de una o más series del SIE. La implementa B2 (con ``requests``)."""
    require_token()
    raise NotImplementedError("La consulta al SIE de Banxico la implementa el stream B2")
