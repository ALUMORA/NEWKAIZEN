"""EODHD (stream B3), proveedor opcional. Por ahora solo el control de configuración."""

from __future__ import annotations

from kaizen_api.errors import ApiError
from kaizen_api.settings import get_settings


def require_token() -> str:
    """Token de EODHD o ``ApiError`` 503 NOT_CONFIGURED si no está configurado."""
    token = get_settings().eodhd_api_token
    if not token:
        raise ApiError(503, "NOT_CONFIGURED", "Falta configurar el token de EODHD en el servidor.")
    return token


def fetch_fundamentals(symbol: str) -> dict:
    """Fundamentales de EODHD. Los implementa B3 (con ``requests``)."""
    require_token()
    raise NotImplementedError("EODHD lo implementa el stream B3")
