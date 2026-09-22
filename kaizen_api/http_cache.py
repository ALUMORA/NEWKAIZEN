"""``Cache-Control`` por clase de dato (stream B1).

La spec v2 le pone a cada respuesta exitosa un ``Cache-Control: private, max-age=<n>`` según qué
tan seguido cambia el dato, y ``no-store`` a lo que nunca debe guardarse (salud, sesión y todos los
errores, que lo ponen los manejadores de ``errors.py``).

Vive aquí y no en ``routers/__init__.py`` porque la caché HTTP es de **B1** (seguridad y
plataforma), mientras que ``routers/__init__.py`` es una costura congelada que leen los doce
routers. Los routers lo siguen importando desde ``kaizen_api.routers`` (que lo reexporta), así que
B1 puede afinar tiempos o agregar una clase de dato sin abrir el archivo de ningún otro stream.

Agregar una clase de dato: se agrega a ``CACHE_SECONDS`` y se usa con
``dependencies=[cache_control("<clase>")]`` en la ruta.
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends, Response

CACHE_SECONDS: dict[str, int] = {
    "quotes": 30,
    "history": 3600,
    "fundamentals": 21600,
    "macro": 3600,
    "news": 600,
    "screeners": 43200,
}
"""``Cache-Control: private, max-age=<n>`` por clase de dato (spec v2)."""


def cache_control(data_class: str) -> Any:
    """Dependencia que pone ``Cache-Control: private, max-age=<n>`` en la respuesta exitosa.

    Los errores salen con ``no-store`` (lo ponen los manejadores de ``errors.py``).
    """
    seconds = CACHE_SECONDS[data_class]
    value = f"private, max-age={seconds}"

    def _set_cache_control(response: Response) -> None:
        response.headers["Cache-Control"] = value

    _set_cache_control.__name__ = f"cache_{data_class}"
    return Depends(_set_cache_control)


def no_store(response: Response) -> None:
    """Para respuestas que nunca deben guardarse (salud, sesión)."""
    response.headers["Cache-Control"] = "no-store"
