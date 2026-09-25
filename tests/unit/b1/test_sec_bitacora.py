"""Revisión de seguridad de fase 4 (stream SEC): la bitácora no acepta renglones inventados.

El reporte está en ``docs/overhaul/notas/fase4-seguridad.md``.
"""

from __future__ import annotations

import logging

from fastapi.testclient import TestClient

from kaizen_api.main import create_app
from kaizen_api.settings import Settings

# ─── bitácora sin renglones inventados ───────────────────────────────────────


def test_a_percent_encoded_newline_in_the_path_cannot_forge_a_log_line(caplog):
    """Antes: la ruta decodificada iba tal cual a la bitácora, así que ``%0A`` partía el renglón.

    Con eso cualquiera, sin sesión, escribía en los logs de Render un renglón con la forma que
    quisiera (``login correcto de ana``, un 200 falso...).
    """
    client = TestClient(create_app(Settings.from_env({})), raise_server_exceptions=False)
    with caplog.at_level(logging.INFO, logger="kaizen_api"):
        r = client.get("/nada%0A2026-09-25%20INFO%20GET%20/auth/login%20200%0D%1b[31m")
    assert r.status_code == 404
    lines = [rec.getMessage() for rec in caplog.records if "/nada" in rec.getMessage()]
    assert lines, "el request se registra"
    for line in lines:
        assert "\n" not in line and "\r" not in line and "\x1b" not in line
        assert "\\n" in line  # se ve escapado, no se pierde
