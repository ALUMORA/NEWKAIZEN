"""Tipo de cambio: ``get_fx`` del legado y la costura v2 ``convert``.

Costura CONGELADA: ``convert(amount_or_series, from_ccy, to_ccy, on=None)``.

* ``amount_or_series``: un número (monto en ``from_ccy``) o una ``pandas.Series`` indexada por
  fecha. Con una serie, cada punto se convierte con el tipo de cambio de SU fecha (FIX de Banxico
  cuando hay token, si no Yahoo, marcado como sustituto), rellenando hacia adelante a lo más 3 días.
* ``on``: fecha (``date`` o ``YYYY-MM-DD``) del tipo de cambio para un número; ``None`` es el
  más reciente.
* Misma moneda: devuelve la entrada tal cual (ya implementado).
* Sin tipo de cambio real lanza ``ApiError`` 503 ``UPSTREAM_UNAVAILABLE``. Nunca usa 17.5 fijo.

B2 implementa la conversión entre monedas distintas; mientras tanto lanza ``NotImplementedError``.
El ``get_fx`` legado (con su referencia fija marcada ``fallback``) solo lo usan las rutas v1.
"""

from datetime import date

from kaizen_api.domain import _log
from kaizen_api.providers.yahoo.session import yft


def convert(amount_or_series, from_ccy: str, to_ccy: str, on: date | str | None = None):
    """Convierte montos o series entre monedas (ver el docstring del módulo)."""
    if str(from_ccy).upper() == str(to_ccy).upper():
        return amount_or_series
    raise NotImplementedError("convert entre monedas distintas lo implementa el stream B2")


def get_fx() -> dict:
    """Retorna tipo de cambio USD/MXN actual desde Yahoo Finance."""
    try:
        hist = yft("USDMXN=X").history(period="2d")
        if not hist.empty:
            return {"USDMXN": round(float(hist["Close"].iloc[-1]), 4)}
    except Exception as e:
        _log(f"fx: USDMXN=X falló ({e}), se devuelve la referencia fija")
    # Referencia fija: el flag avisa que no es cotización en vivo
    return {"USDMXN": 17.5, "fallback": True}
