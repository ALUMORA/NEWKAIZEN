#!/usr/bin/env python3
"""KAIZEN API: punto de entrada que usan Render y el Procfile (``python backend.py``).

El backend vive en el paquete ``kaizen_api`` (FastAPI). Variables de entorno en
``kaizen_api/settings.py``; mapa del API en ``docs/api-v2.md``.
"""

from kaizen_api.main import run

if __name__ == "__main__":
    run()
