"""Caché en memoria con TTL y single-flight, y el único lugar con estado mutable del proceso.

Viene de backend.py con un cambio: el candado por llave ya no se poda en ``_cache_put``.
En el legado, ``_cache_put`` borraba de ``_key_locks`` los candados libres de llaves fuera del
caché. Entre el ``setdefault`` de un hilo y su ``acquire`` el candado estaba libre, así que otro
hilo podía podarlo y un tercero crear uno nuevo: dos hilos calculaban la misma llave a la vez y
el single-flight se rompía. Ahora cada candado lleva un conteo de quienes lo usan y lo borra el
último en soltarlo, así que ``_key_locks`` solo contiene llaves en vuelo y nunca crece sin límite.

Todo estado mutable (caché de datos, caché del índice de la SEC y lo que registren otros
módulos con ``register_reset``) se limpia con ``reset_state()``, que es lo que usan las pruebas
de replay antes de cada llamada.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any

# Acotado a _CACHE_MAX entradas: con tickers arbitrarios en la URL crecería sin límite.
_CACHE_MAX = 500
_cache: dict = {}  # key -> (valor, timestamp, ttl); orden de inserción = antigüedad
_cache_lock = threading.Lock()
_key_locks: dict = {}  # key -> [Lock, usuarios]; solo llaves con un cálculo en vuelo

# Índice ticker -> CIK de la SEC (providers/sec_edgar.py), cache de 24 h. Se muta en su lugar.
_edgar_ticker_cache = {"data": None, "ts": 0}

_reset_hooks: list[Callable[[], None]] = []


def _cache_get(key: str):
    with _cache_lock:
        entry = _cache.get(key)
        if entry and time.time() - entry[1] < entry[2]:
            return True, entry[0]
    return False, None


def _cache_put(key: str, val, ttl: int):
    with _cache_lock:
        _cache.pop(key, None)
        _cache[key] = (val, time.time(), ttl)
        if len(_cache) > _CACHE_MAX:
            now = time.time()
            for k in [k for k, (_, ts, t) in _cache.items() if now - ts >= t]:
                del _cache[k]
            while len(_cache) > _CACHE_MAX:
                del _cache[next(iter(_cache))]  # el más viejo


def _acquire_key_lock(key: str) -> list:
    """Registra al llamador en el candado de ``key`` (lo crea si no existe) y lo devuelve."""
    with _cache_lock:
        entry = _key_locks.get(key)
        if entry is None:
            entry = [threading.Lock(), 0]
            _key_locks[key] = entry
        entry[1] += 1
        return entry


def _release_key_lock(key: str, entry: list) -> None:
    """Quita al llamador; el último en salir borra el candado."""
    with _cache_lock:
        entry[1] -= 1
        if entry[1] <= 0 and _key_locks.get(key) is entry:
            del _key_locks[key]


def _cached(key: str, fn, ttl: int = 300, ok=None, fail_ttl: int = 60):
    """
    Cache con TTL y single-flight: si dos hilos piden la misma key, solo uno calcula
    y el otro espera el resultado. Si ok(resultado) es falso, se guarda solo fail_ttl
    segundos para no servir un fallo durante horas.
    """
    hit, val = _cache_get(key)
    if hit:
        return val
    entry = _acquire_key_lock(key)
    try:
        with entry[0]:
            hit, val = _cache_get(key)  # otro hilo pudo calcularlo mientras esperábamos
            if hit:
                return val
            result = fn()
            good = True
            if ok is not None:
                try:
                    good = bool(ok(result))
                except Exception:
                    good = False
            _cache_put(key, result, ttl if good else fail_ttl)
            return result
    finally:
        _release_key_lock(key, entry)


def register_reset(hook: Callable[[], None]) -> Callable[[], None]:
    """Registra una función que limpia estado de otro módulo; ``reset_state()`` la llama.

    Úsalo para cachés propios de un proveedor (por ejemplo una lista de símbolos cargada en
    memoria). Devuelve la misma función para poder usarlo como decorador.
    """
    if hook not in _reset_hooks:
        _reset_hooks.append(hook)
    return hook


def reset_state() -> None:
    """Vacía todos los cachés del proceso. Seguro de llamar entre pruebas o requests."""
    with _cache_lock:
        _cache.clear()
        _key_locks.clear()
        _edgar_ticker_cache.update({"data": None, "ts": 0})
    for hook in list(_reset_hooks):
        hook()


def cache_stats() -> dict[str, Any]:
    """Tamaños actuales, para diagnóstico y pruebas."""
    with _cache_lock:
        return {"entries": len(_cache), "inflight": len(_key_locks), "max": _CACHE_MAX}
