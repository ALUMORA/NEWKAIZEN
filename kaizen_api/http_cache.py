"""``Cache-Control`` por clase de dato (stream B1).

La spec v2 le pone a cada respuesta exitosa un ``Cache-Control: private, max-age=<n>`` según qué
tan seguido cambia el dato, y ``no-store`` a lo que nunca debe guardarse (salud, sesión y todos los
errores, que lo ponen los manejadores de ``errors.py``).

Vive aquí y no en ``routers/__init__.py`` porque la caché HTTP es de **B1** (seguridad y
plataforma), mientras que ``routers/__init__.py`` es una costura congelada que leen los doce
routers. Los routers lo siguen importando desde ``kaizen_api.routers`` (que lo reexporta), así que
B1 puede afinar tiempos o agregar una clase de dato sin abrir el archivo de ningún otro stream.

Agregar una clase de dato: se agrega a ``CACHE_SECONDS`` y se usa con
``dependencies=[cache_control("<clase>")]`` en la ruta. Cuando la clase depende de un parámetro
(``/v2/ohlc`` es ``intraday`` con 5m o 1h e ``history`` con velas diarias), la ruta usa
``cache_control_by("interval", {"5m": "intraday", "1h": "intraday"}, default="history")``.

Clases de la fase 5 (M5):

* ``reference`` (86400 s, un día): calendarios transcritos y datos curados que cambian por
  publicación oficial (calendario económico, valores de referencia de México, industrias de
  Damodaran, Banco Mundial).
* ``intraday`` (60 s): velas de 5 minutos y de 1 hora de ``/v2/ohlc``, que llegan con 20 minutos
  de retraso en la BMV y cambian a cada rato durante la sesión.
* ``curves`` (3600 s): las curvas de rendimiento y sus diferenciales, que cambian una vez al día
  por plazo (en México, solo el día de su subasta).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi import Depends, Request, Response

CACHE_SECONDS: dict[str, int] = {
    "quotes": 30,
    "history": 3600,
    "fundamentals": 21600,
    "macro": 3600,
    "news": 600,
    "screeners": 43200,
    "reference": 86400,
    "intraday": 60,
    "curves": 3600,
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


def cache_control_by(param: str, classes: Mapping[str, str], *, default: str) -> Any:
    """Como ``cache_control`` pero la clase sale del valor de un parámetro de la consulta.

    ``classes`` va de valor a clase y ``default`` aplica a los demás valores (y a la ausencia del
    parámetro). La dependencia se llama ``cache_<clase>|<clase>`` con las clases posibles en orden,
    así la prueba de B1 sigue viendo qué declara cada ruta sin llamarla.
    """
    options = sorted({*classes.values(), default})
    values = {value: f"private, max-age={CACHE_SECONDS[data_class]}" for value, data_class in classes.items()}
    fallback = f"private, max-age={CACHE_SECONDS[default]}"

    def _set_cache_control(request: Request, response: Response) -> None:
        response.headers["Cache-Control"] = values.get(request.query_params.get(param, ""), fallback)

    _set_cache_control.__name__ = "cache_" + "|".join(options)
    return Depends(_set_cache_control)


def no_store(response: Response) -> None:
    """Para respuestas que nunca deben guardarse (salud, sesión)."""
    response.headers["Cache-Control"] = "no-store"
