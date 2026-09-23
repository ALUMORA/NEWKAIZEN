"""Tasa libre de riesgo del legado: Bono M 10 años (OCDE vía FRED, IRLTLT01MXM156N).

El v2 (``/v2/rates/rf``) usa CETES 28 de Banxico y nunca una referencia fija silenciosa.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

import datetime as _dt

import requests

from kaizen_api.cache import _cache_get, _cache_put
from kaizen_api.domain import _log
from kaizen_api.errors import ApiError
from kaizen_api.provenance import utc_now
from kaizen_api.providers import banxico, fred


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


# ─── v2: tasas de México y serie de la tasa libre de riesgo ──────────────────
#
# Lo de arriba es el legado (Bono M 10 años con referencia fija de respaldo) y se queda para v1.
# Aquí no hay valor fijo silencioso: o sale de Banxico, o sale de FRED marcado como respaldo, o la
# ruta responde 503 diciendo qué falta.

RATE_ORDER = (
    "target",
    "tiie28",
    "tiieFondeo",
    "cetes28",
    "cetes91",
    "cetes182",
    "cetes364",
    "bonoM10",
    "inflationYoY",
    "coreInflationYoY",
    "udi",
    "fix",
)
"""Orden en que se publican los renglones de ``/v2/rates/mx`` (el mismo del contrato)."""

LOOKBACK_DAYS = 420
"""Ventana que se le pide al SIE: alcanza para tener el dato previo hasta de una serie quincenal."""

CETES_SERIES = {28: "cetes28", 91: "cetes91", 182: "cetes182", 364: "cetes364"}

FRED_MX_FALLBACK = {
    "bonoM10": {
        "series": "IRLTLT01MXM156N",
        "label": "Bono M 10 años (serie mensual de la OCDE en FRED)",
        "unit": "fraction",
        "scale": 0.01,
        "maxAgeDays": 70,
    },
}
"""Lo único que FRED puede dar sin mentir cuando no hay token de Banxico.

No se publica la TIIE ni los CETES desde FRED: la serie que existe ahí para México
(``IR3TIB01MXM156N``) es **interbancaria a 3 meses y mensual**, así que no es la TIIE de 28 días ni
los CETES, y ponerla bajo esos ids sería presentar un dato como otro. Esa serie sí se usa, marcada
como respaldo, en ``/v2/rates/rf``, donde el contrato la nombra (``source: "fred_ir3tib"``).
"""

FRED_RF_SERIES = "IR3TIB01MXM156N"
def rf_fallback_note(tenor_days: int) -> str:
    """Aviso del respaldo de FRED, nombrando el plazo que de verdad se pidió.

    La serie es interbancaria a 3 meses pase lo que pase, así que el aviso tiene que decir contra
    qué plazo no corresponde: si alguien pide 364 días, hablarle de 28 no le aclara nada.
    """
    return (
        f"Respaldo: serie interbancaria de México a 3 meses de la OCDE en FRED, mensual. No son CETES"
        f" de {int(tenor_days)} días ni tiene la convención de la subasta; se publica solo mientras no"
        " haya token de Banxico."
    )


def _today() -> _dt.date:
    return utc_now().date()


def _stale(as_of: str | None, max_age_days: int) -> bool:
    if not as_of:
        return True
    try:
        day = _dt.date.fromisoformat(as_of)
    except ValueError:
        return True
    return (_today() - day).days > max_age_days


def _change_bp(value: float, previous: float | None, unit: str) -> float | None:
    """Cambio en puntos base. Solo tiene sentido para tasas (fracciones), no para el FIX ni la UDI."""
    if previous is None or unit != "fraction":
        return None
    return round((value - previous) * 10_000, 2)


def _item(rate_id: str, label: str, unit: str, series_id: str, source: str, dates, values, scale: float) -> dict:
    value = round(values[-1] * scale, 10)
    previous = round(values[-2] * scale, 10) if len(values) >= 2 else None
    return {
        "id": rate_id,
        "label": label,
        "value": value,
        "unit": unit,
        "asOf": dates[-1],
        "seriesId": series_id,
        "source": source,
        "previous": previous,
        "changeBp": _change_bp(value, previous, unit),
    }


def _gate_notes(checked: dict[str, list[str]]) -> list[str]:
    """Avisos de las series que no se publicaron, con la razón: el SIE no las confirmó o nadie las revisó."""
    notes: list[str] = []
    missing = sorted(sid for sid, reasons in checked.items() if reasons == [banxico.NOT_RETURNED])
    if missing:
        notes.append("No se publicaron estas series porque el SIE no las devolvió: " + ", ".join(missing) + ".")
    for sid in sorted(checked):
        if checked[sid] and sid not in missing:
            notes.append(f"No se publicó {sid} porque el SIE no confirmó que sea lo que dice el catálogo: "
                         + "; ".join(checked[sid]) + ".")
    pending = sorted(sid for sid, reasons in checked.items() if not reasons and not banxico.reviewed(sid))
    if pending:
        notes.append(
            "Estas series del SIE todavía no tienen revisión humana (verified: false en el catálogo) y no se"
            " publican hasta que alguien corra tests/unit/b2b/test_banxico_live.py con token: "
            + ", ".join(pending)
            + "."
        )
    return notes


def _banxico_items() -> tuple[list[dict], list[str]]:
    """Renglones del SIE: solo los ids revisados a mano que el propio SIE vuelve a confirmar hoy."""
    catalog = banxico.catalog()
    checked = banxico.verification(list(catalog))
    usable = [sid for sid, reasons in checked.items() if not reasons and banxico.reviewed(sid)]
    notes = _gate_notes(checked)
    if not usable:
        return [], notes
    end = _today()
    series = banxico.fetch_series(usable, (end - _dt.timedelta(days=LOOKBACK_DAYS)).isoformat(), end.isoformat())
    items: list[dict] = []
    for sid in usable:
        info = catalog[sid]
        data = series.get(sid) or {}
        if not data.get("values"):
            continue
        scale = 0.01 if info["sieUnit"] == "percent" else 1.0
        items.append(
            _item(info["rateId"], info["label"], info["unit"], sid, "banxico", data["dates"], data["values"], scale)
        )
    return items, notes


def _fred_items() -> list[dict]:
    """Los pocos renglones que FRED puede dar honestamente, todos marcados como respaldo."""
    items = []
    for rate_id, spec in FRED_MX_FALLBACK.items():
        serie = fred.fetch_series(spec["series"])
        if not serie["values"]:
            continue
        items.append(
            _item(
                rate_id,
                spec["label"],
                spec["unit"],
                spec["series"],
                "fred",
                serie["dates"],
                serie["values"],
                spec["scale"],
            )
        )
    return items


def _max_age(rate_id: str, fallback: bool) -> int:
    if fallback:
        return FRED_MX_FALLBACK.get(rate_id, {}).get("maxAgeDays", 45)
    for info in banxico.catalog().values():
        if info.get("rateId") == rate_id:
            return int(info.get("maxAgeDays") or 14)
    return 14


def get_mx_rates() -> dict:
    """``/v2/rates/mx``: ``{"items", "source", "fallback", "stale", "asOf", "notes"}``.

    Con token de Banxico se publican las series del SIE que el propio SIE confirma. Sin token (o si
    el SIE no responde) se cae al único respaldo honesto de FRED, marcado como ``fallback``. Si no
    queda nada que publicar, levanta 503 diciendo qué falta configurar.
    """
    notes: list[str] = []
    items: list[dict] = []
    fallback = False
    configured = banxico.configured()
    if configured:
        try:
            items, notes = _banxico_items()
        except ApiError as exc:
            notes.append(f"Banxico no respondió ({exc.code}); se usa el respaldo de FRED.")
            items = []
    if not items:
        fallback = True
        items = _fred_items()
        if configured:
            notes.append("Estos datos son de respaldo: no se pudo leer ninguna serie del SIE de Banxico.")
        else:
            notes.append(
                "Falta el token de Banxico (BANXICO_TOKEN), así que no hay tasa objetivo, TIIE, CETES,"
                " inflación, UDI ni FIX. Lo que se muestra viene de FRED y es un respaldo."
            )
    if not items:
        if not configured:
            raise ApiError(
                503,
                "NOT_CONFIGURED",
                "Las tasas de México necesitan el token de Banxico, y el respaldo de FRED tampoco respondió.",
            )
        raise ApiError(503, "UPSTREAM_UNAVAILABLE", "Ni Banxico ni FRED respondieron. Intenta más tarde.")
    order = {rid: i for i, rid in enumerate(RATE_ORDER)}
    items.sort(key=lambda it: order.get(it["id"], len(order)))
    as_of = max(it["asOf"] for it in items)
    stale = any(_stale(it["asOf"], _max_age(it["id"], fallback)) for it in items)
    sources = sorted({it["source"] for it in items})
    return {
        "items": items,
        "source": ",".join(sources),
        "fallback": fallback,
        "stale": stale,
        "asOf": as_of,
        "notes": notes,
    }


def get_rf_series(start: str | None = None, end: str | None = None, tenor_days: int = 28) -> dict:
    """``/v2/rates/rf``: serie de rendimientos anualizados simples act/360, como fracción.

    Primero CETES del plazo pedido desde Banxico (solo si el SIE confirma la serie); si no, la serie
    interbancaria de la OCDE en FRED, con ``fallback`` en ``true`` y ``source`` ``fred_ir3tib``. El
    cliente convierte a tasa por periodo con ``rf_d = (1 + y * plazo / 360) ** (d / plazo) - 1``.
    """
    end_date = _dt.date.fromisoformat(end) if end else _today()
    start_date = _dt.date.fromisoformat(start) if start else end_date - _dt.timedelta(days=3 * 365)
    notes: list[str] = []
    rate_id = CETES_SERIES.get(int(tenor_days))
    series_id = banxico.series_for(rate_id) if rate_id else None
    if banxico.configured() and series_id:
        try:
            # Se pregunta por TODO el catálogo, no solo por esta serie, para compartir la misma
            # entrada de caché que /v2/rates/mx: así el SIE recibe una consulta de metadatos, no dos.
            reasons = banxico.verification(list(banxico.catalog())).get(series_id, ["sin respuesta del SIE"])
            if not reasons and banxico.reviewed(series_id):
                data = banxico.fetch_series([series_id], start_date.isoformat(), end_date.isoformat()).get(series_id)
                if data and data["values"]:
                    return {
                        "tenorDays": int(tenor_days),
                        "dates": data["dates"],
                        "values": [round(v / 100, 8) for v in data["values"]],
                        "source": "banxico",
                        "fallback": False,
                        "asOf": data["dates"][-1],
                        "stale": _stale(data["dates"][-1], 21),
                        "notes": notes,
                    }
                notes.append("Banxico no tiene datos de CETES en ese rango de fechas.")
            elif reasons:
                notes.append(f"El SIE no confirmó la serie {series_id}, así que no se usó: " + "; ".join(reasons) + ".")
            else:
                notes.append(
                    f"La serie {series_id} todavía no tiene revisión humana (verified: false en el catálogo),"
                    " así que no se usó."
                )
        except ApiError as exc:
            notes.append(f"Banxico no respondió ({exc.code}).")
    elif not banxico.configured():
        notes.append("Falta el token de Banxico (BANXICO_TOKEN) para servir CETES del SIE.")
    serie = fred.fetch_series(FRED_RF_SERIES, start_date.isoformat(), end_date.isoformat())
    if not serie["values"]:
        raise ApiError(
            503,
            "UPSTREAM_UNAVAILABLE",
            "No hay serie de tasa libre de riesgo disponible para ese rango. Intenta más tarde.",
        )
    notes.append(rf_fallback_note(tenor_days))
    return {
        "tenorDays": int(tenor_days),
        "dates": serie["dates"],
        "values": [round(v / 100, 8) for v in serie["values"]],
        "source": "fred_ir3tib",
        "fallback": True,
        "asOf": serie["dates"][-1],
        "stale": _stale(serie["dates"][-1], 70),
        "notes": notes,
    }
