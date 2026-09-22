"""Lógica de dominio de KAIZEN, sin HTTP.

Aquí viven los helpers numéricos del legado que comparten varios módulos: ``safe`` (float
finito o None), ``pct`` (fracción a porcentaje con 2 decimales), ``r2`` (2 decimales) y ``_log``
(aviso a stderr). El código v2 nuevo no debe usar ``pct``: el contrato v2 entrega fracciones.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

import math
import sys


def _log(msg: str):
    """Errores que cambian el dato devuelto: a stderr para que salgan en los logs de Render."""
    print(f"  [warn] {msg}", file=sys.stderr, flush=True)


def safe(v):
    if v is None: return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except Exception:
        return None

def pct(v):
    s = safe(v)
    return round(s * 100, 2) if s is not None else None

def r2(v):
    s = safe(v)
    return round(s, 2) if s is not None else None
