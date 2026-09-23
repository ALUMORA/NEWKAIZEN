"""SIE de Banxico: catálogo de series, consulta REST con la cabecera ``Bmx-Token`` y verificación.

Sin ``BANXICO_TOKEN`` toda consulta levanta ``ApiError`` 503 ``NOT_CONFIGURED`` y quien llama decide
su respaldo (``domain/rates.py`` cae a FRED y lo marca como ``fallback``). Nunca se inventa un valor.

**Series verificadas.** Solo ``SF43718`` (FIX) y ``SF61745`` (tasa objetivo) vienen marcadas como
verificadas en ``kaizen_api/data/banxico_series.json``. Las demás quedan en ``verified: false`` hasta
que una prueba con un token real las confirme contra el endpoint de metadatos del SIE, y mientras
estén en ``false`` no se publican, aunque haya token. Eso es lo que pide el spec: cada id distinto
de esos dos se verifica en una prueba antes de usarse.

Además, con token, :func:`verified_ids` vuelve a preguntar los metadatos al SIE (24 h de caché) y
pasa cada serie por :func:`mismatches`: el título tiene que traer las palabras de
``tituloContiene`` y ninguna de ``tituloExcluye``, la periodicidad tiene que ser la del catálogo y
la unidad tiene que cuadrar con ``sieUnit`` (por ciento o pesos). Una serie que no pase no se
publica, aunque esté marcada ``verified: true``.

Cómo confirmarlas de una vez, cuando el dueño saque su token (es gratis en
https://www.banxico.org.mx/SieAPIRest/service/v1/token)::

    export BANXICO_TOKEN=... KAIZEN_LIVE=1
    .venv/bin/python -m pytest -q -p no:cacheprovider -o addopts="" \\
        tests/unit/b2b/test_banxico_live.py -s

Esa prueba pide los metadatos de cada id del catálogo, los pasa por :func:`classify` (el mismo
candado de título, periodicidad y unidad que usa el servidor) e imprime la lista de ids que se
pueden dejar en ``verified: true``.
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


NOT_RETURNED = "el SIE no devolvió esta serie"

UNIT_WORDS = {"percent": ("por ciento", "porcentaje", "%"), "mxn": ("peso",)}
"""Lo que tiene que decir la ``unidad`` del SIE según el ``sieUnit`` del catálogo."""
UNIT_NAMES = {"percent": "por ciento", "mxn": "pesos"}


def mismatches(info: dict | None, item: dict) -> list[str]:
    """Por qué una serie del SIE NO es la que dice el catálogo; lista vacía si sí lo es.

    Compara título (palabras que tiene que traer y palabras que no), periodicidad y unidad. El
    título solo no alcanza: "Cetes a 28 días, tasa de descuento, promedio mensual" trae "cetes" y
    "28" y es otra serie, y un precio en pesos del Bono M trae "bonos" y "10".
    """
    if not info:
        return [NOT_RETURNED]
    reasons: list[str] = []
    titulo = str(info.get("titulo") or "")
    expected = item.get("tituloContiene") or []
    if not title_matches(titulo, expected):
        reasons.append(f'el título "{titulo[:90]}" no trae todas estas palabras: {", ".join(expected)}')
    folded = _fold(titulo)
    banned = [word for word in item.get("tituloExcluye") or [] if _fold(word) in folded]
    if banned:
        reasons.append(f'el título trae "{", ".join(banned)}", que no corresponde a esta serie')
    want = str(item.get("periodicidad") or "")
    got = str(info.get("periodicidad") or "")
    if not want or _fold(got).strip() != _fold(want).strip():
        reasons.append(f'la periodicidad es "{got}" y el catálogo dice "{want}"')
    unidad = str(info.get("unidad") or "")
    words = UNIT_WORDS.get(str(item.get("sieUnit") or ""), ())
    if not any(word in _fold(unidad) for word in words):
        esperada = UNIT_NAMES.get(str(item.get("sieUnit") or ""), "la del catálogo")
        reasons.append(f'la unidad es "{unidad}" y el catálogo espera {esperada}')
    return reasons


def classify(cat: dict[str, dict], meta: dict[str, dict]) -> dict[str, list]:
    """Reparte los ids del catálogo en confirmados, desconocidos y distintos (con sus razones).

    Es lo que imprime la prueba en vivo para decidir qué se marca ``verified: true``, y usa
    exactamente el mismo candado que el servidor.
    """
    out: dict[str, list] = {"confirmados": [], "desconocidos": [], "distintos": []}
    for sid, item in sorted(cat.items()):
        info = meta.get(sid)
        if info is None:
            out["desconocidos"].append(sid)
            continue
        reasons = mismatches(info, item)
        if reasons:
            out["distintos"].append((sid, reasons))
        else:
            out["confirmados"].append(sid)
    return out


def reviewed(series_id: str) -> bool:
    """¿Una persona ya confirmó este id con la prueba en vivo (``verified: true`` en el catálogo)?"""
    return bool((catalog().get(series_id) or {}).get("verified"))


def _verify_now(series_ids: tuple[str, ...]) -> dict[str, list[str]]:
    meta = fetch_metadata(list(series_ids))
    cat = catalog()
    return {sid: mismatches(meta.get(sid), cat.get(sid) or {}) for sid in series_ids}


def verification(series_ids: list[str] | tuple[str, ...]) -> dict[str, list[str]]:
    """Razones por las que cada serie no cuadra con el catálogo, según el SIE (vacío = confirmada).

    Se cachea 24 h. Si el SIE no responde con algo legible, ninguna se da por buena.
    """
    ids = tuple(dict.fromkeys(str(s).strip().upper() for s in series_ids if str(s).strip()))
    if not ids:
        return {}
    key = "banxico:verify:" + ",".join(sorted(ids))
    try:
        return _cached(
            key,
            lambda: _verify_now(ids),
            ttl=24 * 3600,
            ok=lambda r: any(not reasons for reasons in r.values()),
            fail_ttl=600,
        )
    except ApiError:
        raise
    except Exception:
        return dict.fromkeys(ids, ["no se pudo leer la respuesta de metadatos del SIE"])


def verified_ids(series_ids: list[str] | tuple[str, ...]) -> dict[str, bool]:
    """¿Cuáles de esas series son de verdad las que dice el catálogo? Con token, se pregunta al SIE.

    Pasa por :func:`mismatches` (título, periodicidad y unidad). Las marcadas ``verified: true``
    también se vuelven a comprobar, porque cuesta una sola llamada para todas. Esto NO basta para
    publicar: además hace falta :func:`reviewed`, la revisión humana del catálogo.
    """
    return {sid: not reasons for sid, reasons in verification(series_ids).items()}
