"""FRED (Reserva Federal de St. Louis): series públicas por ``fredgraph.csv``.

``_fred_rate`` no usa llave. ``FRED_API_KEY`` (settings) queda para la API oficial en B2.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

import requests


def _fred_rate(series_id: str):
    """Obtiene la tasa más reciente de FRED (API pública de la Reserva Federal)."""
    try:
        # Sin _session y con el User-Agent default de requests: FRED deja colgada la conexión
        # con uno que imita a un navegador, y también con uno propio no reconocido.
        resp = requests.get(
            f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}",
            timeout=8
        )
        for line in reversed(resp.text.strip().split("\n")[1:]):
            parts = line.split(",")
            if len(parts) == 2 and parts[1].strip() not in (".", ""):
                return float(parts[1].strip())
    except Exception:
        pass
    return None
