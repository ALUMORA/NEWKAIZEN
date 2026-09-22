"""Tasa libre de riesgo del legado: Bono M 10 años (OCDE vía FRED, IRLTLT01MXM156N).

El v2 (``/v2/rates/rf``) usa CETES 28 de Banxico y nunca una referencia fija silenciosa.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

import requests

from kaizen_api.cache import _cache_get, _cache_put
from kaizen_api.domain import _log


def get_rf() -> dict:
    """
    Tasa libre de riesgo: rendimiento del bono de gobierno mexicano a 10 años.
    Fuente: serie mensual de la OCDE publicada en FRED (IRLTLT01MXM156N). Yahoo no tiene
    ningún símbolo de Bonos M; los cuatro que se probaban antes no existen.
    """
    hit, cached = _cache_get("rf")
    if hit:
        return cached
    try:
        resp = requests.get(
            "https://fred.stlouisfed.org/graph/fredgraph.csv?id=IRLTLT01MXM156N", timeout=8
        )
        for line in reversed(resp.text.strip().split("\n")[1:]):
            date, _, val = line.partition(",")
            if val.strip() not in (".", ""):
                rate = float(val) / 100
                if 0.03 < rate < 0.20:   # sanity: 3%-20%
                    y, m = date.split("-")[:2]
                    mes = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][int(m) - 1]
                    result = {"rate": round(rate, 6), "label": f"Bono M 10Y ({mes} {y})", "asOf": date}
                    _cache_put("rf", result, 6 * 3600)
                    return result
                break
    except Exception as e:
        _log(f"get_rf: FRED falló: {e}")
    # La etiqueta lo dice para que la UI no presente la referencia fija como dato en vivo.
    return {"rate": 0.0860, "label": "Bono M 10Y (ref. fija may 2026)", "fallback": True}
