"""KAIZEN API: backend de datos financieros (FastAPI) para inversionistas de México y EE. UU.

Mapa del paquete:

* ``main``: ``create_app()`` y ``run()``; ``settings``, ``errors``, ``cache``, ``provenance``.
* ``schemas``: el contrato v2 (CONGELADO). ``routers``: HTTP v2 y ``legacy_v1``.
* ``providers``: Yahoo, Banxico, FRED, SEC, RSS, EODHD. ``domain``: la lógica sin HTTP.

``reset_state()`` vacía todos los cachés del proceso (lo usan las pruebas de replay).
"""

__version__ = "2.0.0"


def reset_state() -> None:
    """Vacía cachés y estado en memoria del proceso."""
    from kaizen_api.cache import reset_state as _reset

    _reset()
