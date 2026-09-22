"""``GET /health``: pública, sin sesión aunque AUTH_REQUIRED esté activo.

Reemplaza al ``/health`` del backend viejo, que respondía ``{"status": "ok"}``: la UI vieja solo
revisa ``status == "ok"``, así que sigue funcionando con la forma nueva.

Tres reglas de esta ruta:

* **Nunca sale a la red.** Render sondea ``/health`` cada pocos segundos y Yahoo limita por tasa: un
  sondeo que llama al proveedor se convierte en la forma más tonta de quemar la cuota. ``yahoo.ok``
  y ``sec.ok`` salen de la señal barata que deja quien ya llamó al proveedor por otra razón
  (``cache.record_provider_call``); mientras nadie haya llamado, valen ``null``, que es la verdad.
  ``banxico``, ``fred`` y ``eodhd`` solo dicen si hay token configurado, que es cuestión de
  configuración, no de red.
* **Anuncia lo que de verdad funciona:** ``capabilities`` es la unión de los ``CAPABILITIES`` de los
  routers montados, y un router solo agrega la suya cuando borra el ``@stub`` de la ruta.
* **Es pública** aunque AUTH_REQUIRED esté activo, porque el frontend la usa para saber si el API es
  v2 antes de tener sesión, y la plataforma la usa como health check. Por eso no lleva ningún dato
  que no se pueda enseñar: ni orígenes, ni usuarios, ni tokens.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from kaizen_api.cache import provider_ok
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
            "yahoo": {"ok": provider_ok("yahoo")},
            "banxico": {"configured": bool(settings.banxico_token)},
            "fred": {"configured": bool(settings.fred_api_key)},
            "sec": {"ok": provider_ok("sec")},
            "eodhd": {"configured": bool(settings.eodhd_api_token)},
        },
        "serverTime": iso_instant(utc_now()),
    }
