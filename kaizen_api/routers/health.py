"""``GET /health``: pública, sin sesión aunque AUTH_REQUIRED esté activo.

Reemplaza al ``/health`` del backend viejo, que respondía ``{"status": "ok"}``: la UI vieja solo
revisa ``status == "ok"``, así que sigue funcionando con la forma nueva.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from kaizen_api.provenance import iso_instant, utc_now
from kaizen_api.routers import no_store
from kaizen_api.schemas import HealthResponse
from kaizen_api.security.auth import app_settings

router = APIRouter(tags=["plataforma"])
CAPABILITIES: list[str] = []


@router.get(
    "/health",
    response_model=HealthResponse,
    dependencies=[Depends(no_store)],
    summary="Estado del API, versión y capacidades disponibles hoy",
)
async def health(request: Request) -> dict:
    settings = app_settings(request)
    return {
        "status": "ok",
        "apiVersion": 2,
        "version": settings.version,
        "commit": settings.commit,
        "authRequired": settings.auth_required,
        "capabilities": list(getattr(request.app.state, "capabilities", [])),
        "providers": {
            "yahoo": {"ok": None},
            "banxico": {"configured": bool(settings.banxico_token)},
            "fred": {"configured": bool(settings.fred_api_key)},
            "sec": {"ok": None},
            "eodhd": {"configured": bool(settings.eodhd_api_token)},
        },
        "serverTime": iso_instant(utc_now()),
    }
