"""Operaciones de consejeros y directivos: el legado y el v2 de ``/v2/insiders/{symbol}``.

``get_insiders`` viene sin cambios de backend.py (fase S1): los goldens de tests/goldens_legacy
fijan su comportamiento, defectos incluidos, y por eso no se toca. El v2 (``get_insiders_v2``)
está escrito al lado, más abajo, y sí corrige esos defectos.
"""

import math
import xml.etree.ElementTree as ET

from kaizen_api.domain import safe
from kaizen_api.providers.sec_edgar import FORM4_MAX, cik_for, get_form4_documents
from kaizen_api.providers.yahoo import fundamentals as _yahoo
from kaizen_api.providers.yahoo.session import yft


def get_insiders(ticker: str) -> dict:
    """Insider transactions + top institutional holders."""
    try:
        t = yft(ticker)
        result = {"transactions": [], "institutions": []}

        # Insider transactions
        try:
            ins = t.insider_transactions
            if ins is not None and not ins.empty:
                ins = ins.head(15)
                for _, row in ins.iterrows():
                    shares_val = row.get("Shares") or row.get("shares") or 0
                    val        = row.get("Value") or row.get("value") or 0
                    text       = row.get("Text") or row.get("text") or row.get("Transaction") or ""
                    name       = row.get("Insider") or row.get("insider") or row.get("Name") or "—"
                    date_raw   = row.get("Start Date") or row.get("startDate") or row.get("Date") or ""
                    try:
                        date_str = str(date_raw)[:10]
                    except Exception:
                        date_str = ""
                    # Yahoo da Shares siempre positivo, así que "shares > 0" marcaba toda venta como BUY.
                    # El sentido sale del texto; premios, grants y ejercicios son adquisiciones.
                    tl = str(text).lower()
                    action = ("SELL" if ("sale" in tl or "sell" in tl or "disposition" in tl)
                              else "GIFT" if "gift" in tl else "BUY")
                    result["transactions"].append({
                        "name":   str(name),
                        "action": action,
                        "shares": int(safe(shares_val) or 0),
                        "value":  int(safe(val) or 0),
                        "date":   date_str,
                        "text":   str(text)[:80],
                    })
        except Exception:
            pass

        # Institutional holders
        try:
            inst = t.institutional_holders
            if inst is not None and not inst.empty:
                for _, row in inst.head(8).iterrows():
                    holder = row.get("Holder") or row.get("holder") or "—"
                    shares_val = row.get("Shares") or row.get("shares") or 0
                    pct_held   = row.get("% Out") or row.get("pctHeld") or 0
                    result["institutions"].append({
                        "name":   str(holder),
                        "shares": int(safe(shares_val) or 0),
                        "pct":    round(float(pct_held) * 100, 2) if pct_held else 0,
                    })
        except Exception:
            pass

        return result
    except Exception as e:
        return {"error": str(e), "transactions": [], "institutions": []}


# ─── v2: /v2/insiders/{symbol} (stream B3a) ──────────────────────────────────
#
# El legado marcaba BUY por omisión, así que premios, ejercicios de opción y hasta los renglones
# sin texto contaban como compra de un directivo. Lo informativo es la compra DISCRECIONAL en el
# mercado abierto, no la mecánica de compensación, y una venta preprogramada con un plan 10b5-1
# dice mucho menos que una venta decidida esa semana.
#
# Por eso aquí la fuente preferida es la Forma 4 de la SEC, que trae el CÓDIGO de la operación y,
# desde 2023, la casilla del plan 10b5-1. Yahoo queda de respaldo con su texto libre y sin casilla
# (``planned10b5_1`` en ``None``, que es "no sabemos", no "no"). La BMV no tiene Forma 4: sus
# emisoras salen con lista vacía y la nota que lo explica.

FORM4_CODES: dict[str, str] = {
    "P": "compra",       # compra en mercado abierto
    "S": "venta",        # venta en mercado abierto
    "A": "otorgamiento",  # premio, acción restringida
    "M": "ejercicio",    # ejercicio o conversión de un derivado
    "C": "ejercicio",
    "X": "ejercicio",
    "F": "otro",         # entrega de acciones para pagar impuestos
    "G": "otro",         # regalo
    "D": "otro",         # disposición a favor de la emisora
}
"""Código de la Forma 4 al tipo del contrato. Lo que no está aquí es ``otro``."""

OPEN_MARKET = ("compra", "venta")
"""Los únicos dos tipos que cuentan para el resumen: lo demás es compensación."""

YAHOO_TEXT_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("purchase",), "compra"),
    (("sale", "sell"), "venta"),
    (("award", "grant"), "otorgamiento"),
    (("exercise", "conversion"), "ejercicio"),
)
"""Reglas sobre el texto libre de Yahoo. Sin coincidencia es ``otro``, nunca ``compra``."""

MAX_ITEMS = 40


def _text(node) -> str:
    return "" if node is None or node.text is None else node.text.strip()


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find(parent, name: str):
    for child in parent.iter():
        if _local(child.tag) == name:
            return child
    return None


def _value_of(parent, name: str) -> str:
    node = _find(parent, name)
    if node is None:
        return ""
    inner = node.find("value")
    return _text(inner) if inner is not None else _text(node)


def _truthy(text: str) -> bool | None:
    low = text.strip().lower()
    if low in ("1", "true", "yes", "y"):
        return True
    if low in ("0", "false", "no", "n"):
        return False
    return None


def _owner(root) -> tuple[str, str | None]:
    """Nombre y papel del directivo, en español."""
    name = _value_of(root, "rptOwnerName") or "s/d"
    roles: list[str] = []
    relationship = _find(root, "reportingOwnerRelationship")
    if relationship is not None:
        if _truthy(_value_of(relationship, "isDirector")):
            roles.append("Consejero")
        title = _value_of(relationship, "officerTitle")
        if _truthy(_value_of(relationship, "isOfficer")):
            roles.append(f"Directivo: {title}" if title else "Directivo")
        if _truthy(_value_of(relationship, "isTenPercentOwner")):
            roles.append("Accionista con 10 % o más")
        if _truthy(_value_of(relationship, "isOther")) and not roles:
            roles.append("Otra relación con la emisora")
    return name, ", ".join(roles) or None


def _planned(transaction, root) -> bool | None:
    """La casilla del plan 10b5-1 de la operación, la del documento, o ``None`` si no viene.

    Antes de abril de 2023 la casilla no existía; en esos expedientes se busca la mención en las
    notas al pie que cita la propia operación. Sin nada de eso, ``None`` es "no sabemos".
    """
    # Primero la casilla de ESTA operación; luego la del documento, que son solo los hijos
    # directos de la raíz. Buscarla con ``root.iter()`` tomaría la casilla de otra operación y le
    # pondría plan a una que no lo declara.
    for nodes in (transaction.iter(), iter(root)):
        for node in nodes:
            if _local(node.tag) != "aff10b5One":
                continue
            inner = node.find("value")
            flag = _truthy(_text(inner) if inner is not None else _text(node))
            if flag is not None:
                return flag
    footnotes = {}
    node = _find(root, "footnotes")
    if node is not None:
        for foot in node:
            footnotes[foot.attrib.get("id", "")] = "".join(foot.itertext()).lower()
    for ref in transaction.iter():
        if _local(ref.tag) != "footnoteId":
            continue
        if "10b5-1" in footnotes.get(ref.attrib.get("id", ""), ""):
            return True
    return None


def parse_form4(xml: str) -> list[dict]:
    """Operaciones no derivadas y derivadas de una Forma 4, ya clasificadas."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    insider, role = _owner(root)
    out: list[dict] = []
    for node in root.iter():
        tag = _local(node.tag)
        if tag not in ("nonDerivativeTransaction", "derivativeTransaction"):
            continue
        code = _value_of(node, "transactionCode").upper()
        kind = FORM4_CODES.get(code, "otro")
        if tag == "derivativeTransaction" and kind in OPEN_MARKET:
            # Una compra o venta de un derivado no es una operación en el mercado de la acción.
            kind = "ejercicio" if code == "M" else "otro"
        shares = safe(_value_of(node, "transactionShares"))
        price = safe(_value_of(node, "transactionPricePerShare"))
        out.append({
            "date": _value_of(node, "transactionDate")[:10] or None,
            "insider": insider,
            "role": role,
            "type": kind,
            "shares": shares,
            "value": None if shares is None or price is None else round(shares * price, 2),
            "planned10b5_1": _planned(node, root),
        })
    return out


def _yahoo_type(text: str) -> str:
    low = text.lower()
    for needles, kind in YAHOO_TEXT_RULES:
        if any(needle in low for needle in needles):
            return kind
    return "otro"


def _clean_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    return str(value)


def _from_yahoo(symbol: str) -> list[dict]:
    frame = _yahoo.get_insider_transactions(symbol)
    if frame is None:
        return []
    out: list[dict] = []
    for _index, row in frame.head(MAX_ITEMS).iterrows():
        text = _clean_text(row.get("Text") or row.get("Transaction"))
        raw_date = row.get("Start Date") or row.get("Date")
        date = None
        if raw_date is not None and not (isinstance(raw_date, float) and math.isnan(raw_date)):
            date = str(raw_date)[:10] or None
        out.append({
            "date": date,
            "insider": _clean_text(row.get("Insider") or row.get("Name")) or "s/d",
            "role": _clean_text(row.get("Position")) or None,
            "type": _yahoo_type(text),
            "shares": safe(row.get("Shares")),
            "value": safe(row.get("Value")),
            "planned10b5_1": None,
        })
    return out


def get_insiders_v2(symbol: str) -> dict:
    """Operaciones de consejeros y directivos para ``/v2/insiders/{symbol}``.

    Devuelve ``{"items", "summary", "notes", "sources", "as_of"}``; el router arma ``meta``.
    ``summary`` cuenta SOLO mercado abierto: premios, ejercicios y retenciones no son señal.
    """
    symbol = symbol.upper()
    notes: list[str] = []
    items: list[dict] = []
    sources = ["sec"]
    if cik_for(symbol):
        for filing in get_form4_documents(symbol, FORM4_MAX):
            items.extend(parse_form4(filing["xml"]))
        if items:
            notes.append(
                f"Códigos de la Forma 4 ante la SEC: P es compra y S venta en mercado abierto; "
                f"A otorgamiento y M ejercicio son compensación. Se leyeron los últimos "
                f"{FORM4_MAX} expedientes."
            )
            if all(item["planned10b5_1"] is None for item in items):
                notes.append("Ninguno de estos expedientes marca la casilla del plan 10b5-1.")
        else:
            notes.append("La SEC no tiene Formas 4 recientes de esta emisora.")
    else:
        sources = ["yahoo"]
        items = _from_yahoo(symbol)
        if symbol.endswith(".MX"):
            notes.append(
                "La Forma 4 solo existe en EE. UU., así que no hay operaciones de consejeros para "
                "emisoras de la BMV."
            )
        elif items:
            notes.append(
                "Datos de Yahoo, que solo trae el texto de la operación: no se sabe si hubo un plan "
                "10b5-1 y por eso ese campo va vacío."
            )
        else:
            notes.append("No hay operaciones de consejeros publicadas para este símbolo.")
    items.sort(key=lambda row: (row["date"] or "", row["insider"]), reverse=True)
    items = items[:MAX_ITEMS]
    summary = {
        "openMarketBuys": sum(1 for item in items if item["type"] == "compra"),
        "openMarketSells": sum(1 for item in items if item["type"] == "venta"),
    }
    dates = [item["date"] for item in items if item["date"]]
    return {
        "items": items,
        "summary": summary,
        "notes": notes,
        "sources": sources,
        "as_of": max(dates) if dates else None,
    }
