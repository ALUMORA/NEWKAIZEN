"""SIE de Banxico: catálogo de series, consulta REST con la cabecera ``Bmx-Token`` y verificación.

Sin ``BANXICO_TOKEN`` toda consulta levanta ``ApiError`` 503 ``NOT_CONFIGURED`` y quien llama decide
su respaldo (``domain/rates.py`` cae a FRED y lo marca como ``fallback``). Nunca se inventa un valor.

**Series verificadas.** Solo ``SF43718`` (FIX) y ``SF61745`` (tasa objetivo) vienen marcadas como
verificadas en ``kaizen_api/data/banxico_series.json``. Las demás quedan en ``verified: false`` hasta
que una prueba con un token real las confirme contra el endpoint de metadatos del SIE. Mientras
tanto, con token, :func:`verified_ids` las confirma en caliente contra ese mismo endpoint (24 h de
caché) comparando el título de la serie con las palabras de ``tituloContiene``: una serie que no se
pudo confirmar no se publica.

Cómo confirmarlas de una vez, cuando el dueño saque su token (es gratis en
https://www.banxico.org.mx/SieAPIRest/service/v1/token)::

    export BANXICO_TOKEN=... KAIZEN_LIVE=1
    .venv/bin/python -m pytest -q -p no:cacheprovider -o addopts="" \\
        tests/unit/b2b/test_banxico_live.py

Esa prueba pide los metadatos de cada id del catálogo, comprueba título, unidad y periodicidad, e
imprime la línea exacta que hay que pegar en ``banxico_series.json`` para dejar ``verified: true``.
"""

from __future__ import annotations

import datetime as _dt
import json
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any

import requests

from kaizen_api.cache import _cached, register_reset
from kaizen_api.errors import ApiError
from kaizen_api.settings import get_settings

SIE_BASE_URL = "https://www.banxico.org.mx/SieAPIRest/service/v1"
SERIES_FIX = "SF43718"
SERIES_TARGET = "SF61745"
VERIFIED_IDS = (SERIES_FIX, SERIES_TARGET)
"""Las dos únicas series confirmadas a mano contra el SIE. El resto se confirma con token."""

TIMEOUT = 10
CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "banxico_series.json"

NO_DATA = ("N/E", "N/D", "", "-")
"""Marcas del SIE para "sin dato". ``N/E`` = no existe ese día (feriado, serie sin publicar)."""


# ─── catálogo ────────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def catalog() -> dict[str, dict[str, Any]]:
    """``{idSerie: {rateId, label, unit, verified, tituloContiene, ...}}`` de ``banxico_series.json``."""
    raw = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return {item["id"]: item for item in raw["series"]}


@lru_cache(maxsize=1)
def catalog_notes() -> dict[str, Any]:
    """El resto del archivo del catálogo (cómo verificar, fecha de revisión)."""
    raw = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if k != "series"}


def series_for(rate_id: str) -> str | None:
    """Id del SIE que le toca a un id del contrato (``cetes28`` a ``SF43936``)."""
    for sid, item in catalog().items():
        if item.get("rateId") == rate_id:
            return sid
    return None


@register_reset
def _forget_catalog() -> None:
    catalog.cache_clear()
    catalog_notes.cache_clear()


# ─── formatos del SIE ────────────────────────────────────────────────────────


def parse_amount(raw: Any) -> float | None:
    """``"17,251.23"`` a ``17251.23``; ``"N/E"``, vacío o basura a ``None``.

    El SIE usa la coma como separador de miles y el punto como decimal, y escribe ``N/E`` en los
    días sin dato. Quitar la coma antes de convertir evita el error clásico de leer ``"1,234"``
    como ``1.234``.
    """
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).strip()
    if text.upper() in NO_DATA:
        return None
    text = text.replace(",", "").replace("%", "").strip()
    try:
        value = float(text)
    except ValueError:
        return None
    return value if value == value else None  # descarta NaN


def parse_date(raw: Any) -> str | None:
    """``"22/09/2026"`` a ``"2026-09-22"``. Acepta también una fecha que ya venga en ISO."""
    text = str(raw or "").strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return _dt.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _fold(text: str) -> str:
    """Minúsculas sin acentos, para comparar títulos del SIE sin pelearse con la ortografía."""
    norm = unicodedata.normalize("NFD", str(text or "").lower())
    return "".join(ch for ch in norm if unicodedata.category(ch) != "Mn")


# ─── acceso HTTP ─────────────────────────────────────────────────────────────


def configured() -> bool:
    """¿Hay token del SIE en el entorno?"""
    return bool(get_settings().banxico_token)


def require_token() -> str:
    """Token del SIE o ``ApiError`` 503 NOT_CONFIGURED si no está configurado."""
    token = get_settings().banxico_token
    if not token:
        raise ApiError(503, "NOT_CONFIGURED", "Falta configurar el token de Banxico en el servidor.")
    return token


def _get(path: str) -> dict:
    """GET al SIE con el token en la cabecera (nunca en la URL: la URL sí se graba en los fixtures)."""
    token = require_token()
    url = f"{SIE_BASE_URL}{path}"
    try:
        resp = requests.get(
            url,
            headers={"Bmx-Token": token, "Accept": "application/json"},
            timeout=TIMEOUT,
        )
    except requests.RequestException as exc:
        raise ApiError(503, "UPSTREAM_UNAVAILABLE", "Banxico no respondió. Intenta más tarde.") from exc
    if resp.status_code in (401, 403):
        raise ApiError(
            503,
            "NOT_CONFIGURED",
            "El token de Banxico no es válido o no tiene permiso para estas series.",
        )
    if resp.status_code >= 400:
        raise ApiError(503, "UPSTREAM_UNAVAILABLE", "Banxico no respondió. Intenta más tarde.")
    try:
        body = resp.json()
    except ValueError as exc:
        raise ApiError(503, "UPSTREAM_UNAVAILABLE", "Banxico devolvió una respuesta que no se pudo leer.") from exc
    if not isinstance(body, dict):
        raise ApiError(503, "UPSTREAM_UNAVAILABLE", "Banxico devolvió una respuesta que no se pudo leer.")
    return body


def _series_of(body: dict) -> list[dict]:
    series = ((body or {}).get("bmx") or {}).get("series")
    return [s for s in series if isinstance(s, dict)] if isinstance(series, list) else []


def _ids(series_ids: list[str] | tuple[str, ...]) -> str:
    clean = [str(s).strip().upper() for s in series_ids if str(s).strip()]
    if not clean:
        raise ValueError("banxico: hay que pedir al menos una serie")
    return ",".join(dict.fromkeys(clean))


def fetch_series(
    series_ids: list[str] | tuple[str, ...],
    start: str | None = None,
    end: str | None = None,
) -> dict[str, dict]:
    """Observaciones de una o más series del SIE.

    Devuelve ``{idSerie: {"id", "titulo", "dates": [ISO...], "values": [float...]}}`` en orden
    cronológico y sin los días marcados ``N/E``. Sin ``start`` ni ``end`` pide el dato oportuno
    (el último publicado). Sin token levanta 503 ``NOT_CONFIGURED``.
    """
    ids = _ids(series_ids)
    if start and end:
        path = f"/series/{ids}/datos/{start}/{end}"
    elif start or end:
        raise ValueError("banxico: el rango necesita start y end, o ninguno de los dos")
    else:
        path = f"/series/{ids}/datos/oportuno"
    body = _get(path)
    out: dict[str, dict] = {}
    for serie in _series_of(body):
        sid = str(serie.get("idSerie") or "").upper()
        if not sid:
            continue
        dates: list[str] = []
        values: list[float] = []
        for punto in serie.get("datos") or []:
            if not isinstance(punto, dict):
                continue
            fecha = parse_date(punto.get("fecha"))
            dato = parse_amount(punto.get("dato"))
            if fecha is None or dato is None:
                continue
            dates.append(fecha)
            values.append(dato)
        order = sorted(range(len(dates)), key=lambda i: dates[i])
        out[sid] = {
            "id": sid,
            "titulo": str(serie.get("titulo") or ""),
            "dates": [dates[i] for i in order],
            "values": [values[i] for i in order],
        }
    return out


def fetch_metadata(series_ids: list[str] | tuple[str, ...]) -> dict[str, dict]:
    """Metadatos del SIE: ``{idSerie: {"titulo", "unidad", "periodicidad", "fechaFin", ...}}``."""
    body = _get(f"/series/{_ids(series_ids)}")
    out: dict[str, dict] = {}
    for serie in _series_of(body):
        sid = str(serie.get("idSerie") or "").upper()
        if sid:
            out[sid] = {
                "id": sid,
                "titulo": str(serie.get("titulo") or ""),
                "unidad": str(serie.get("unidad") or ""),
                "periodicidad": str(serie.get("periodicidad") or ""),
                "fechaInicio": parse_date(serie.get("fechaInicio")),
                "fechaFin": parse_date(serie.get("fechaFin")),
            }
    return out


# ─── verificación de ids ─────────────────────────────────────────────────────


def title_matches(titulo: str, expected_words: list[str] | tuple[str, ...]) -> bool:
    """¿El título que devolvió el SIE contiene todas las palabras que esperamos de esa serie?"""
    folded = _fold(titulo)
    return bool(expected_words) and all(_fold(word) in folded for word in expected_words)


def _verify_now(series_ids: tuple[str, ...]) -> dict[str, bool]:
    meta = fetch_metadata(list(series_ids))
    cat = catalog()
    out: dict[str, bool] = {}
    for sid in series_ids:
        info = meta.get(sid)
        expected = (cat.get(sid) or {}).get("tituloContiene") or []
        out[sid] = bool(info) and title_matches(info["titulo"], expected)
    return out


def verified_ids(series_ids: list[str] | tuple[str, ...]) -> dict[str, bool]:
    """¿Cuáles de esas series son de verdad las que dice el catálogo? Con token, se pregunta al SIE.

    Las marcadas ``verified: true`` en el catálogo (SF43718 y SF61745) ya están confirmadas a mano y
    de todos modos se vuelven a comprobar aquí, porque cuesta una sola llamada para todas. El
    resultado se cachea 24 h; si el SIE no responde, ninguna se da por verificada y quien llama cae
    a su respaldo en vez de publicar un dato del que no está seguro.
    """
    ids = tuple(dict.fromkeys(str(s).strip().upper() for s in series_ids if str(s).strip()))
    if not ids:
        return {}
    key = "banxico:verify:" + ",".join(sorted(ids))
    try:
        return _cached(key, lambda: _verify_now(ids), ttl=24 * 3600, ok=lambda r: any(r.values()), fail_ttl=600)
    except ApiError:
        raise
    except Exception:
        return dict.fromkeys(ids, False)
