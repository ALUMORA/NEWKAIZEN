"""Estados financieros (stream B3).

Hoy solo reexporta ``get_edgar_financials`` del legado (vive en ``providers/sec_edgar.py``, que es
quien habla con la SEC). El v2 (``/v2/instrument/{symbol}/statements``) se escribe aquí: renglones
reales de la SEC para emisores de EE. UU. y de Yahoo para el resto, nunca sintetizados.
"""

from kaizen_api.providers.sec_edgar import get_edgar_financials

__all__ = ["get_edgar_financials"]
