"""SEC EDGAR: índice ticker a CIK y hechos XBRL (companyfacts). Solo emisores de EE. UU.

El caché del índice (``_edgar_ticker_cache``) vive en ``kaizen_api.cache`` para que
``reset_state()`` lo limpie junto con lo demás.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

import time

import requests

from kaizen_api.cache import _cached, _edgar_ticker_cache

# La API de EDGAR exige un User-Agent descriptivo con contacto (política de acceso justo de la SEC).
_edgar_session = requests.Session()
_edgar_session.headers.update({
    "User-Agent": "KAIZEN Investment Group research@kaizeninvestments.app",
    "Accept-Encoding": "gzip, deflate",
})


_EDGAR_ERR_CONN = "No se pudo conectar con SEC EDGAR."
_EDGAR_ERR_BAD  = "Respuesta inválida de SEC EDGAR."


def _edgar_ticker_map() -> dict:
    """Mapa TICKER -> CIK (10 dígitos), desde el índice oficial de la SEC. Cache 24h."""
    now = time.time()
    if _edgar_ticker_cache["data"] and now - _edgar_ticker_cache["ts"] < 86400:
        return _edgar_ticker_cache["data"]
    try:
        resp = _edgar_session.get("https://www.sec.gov/files/company_tickers.json", timeout=10)
        raw = resp.json()
        mapping = {row["ticker"].upper(): str(row["cik_str"]).zfill(10) for row in raw.values()}
        _edgar_ticker_cache["data"] = mapping
        _edgar_ticker_cache["ts"] = now
        return mapping
    except Exception:
        return _edgar_ticker_cache["data"] or {}


EDGAR_CONCEPTS = [
    ("Revenues", "Ingresos totales"),
    ("RevenueFromContractWithCustomerExcludingAssessedTax", "Ingresos totales"),
    ("CostOfGoodsAndServicesSold", "Costo de ventas"),
    ("GrossProfit", "Utilidad bruta"),
    ("OperatingIncomeLoss", "Utilidad operativa"),
    ("NetIncomeLoss", "Utilidad neta"),
    ("EarningsPerShareDiluted", "UPA diluida (USD)"),
    ("Assets", "Activos totales"),
    ("Liabilities", "Pasivos totales"),
    ("StockholdersEquity", "Capital contable"),
    ("CashAndCashEquivalentsAtCarryingValue", "Efectivo y equivalentes"),
    ("LongTermDebtNoncurrent", "Deuda de largo plazo"),
    ("NetCashProvidedByUsedInOperatingActivities", "Flujo de efectivo operativo"),
]


def get_edgar_financials(ticker: str) -> dict:
    def _fetch():
        base = ticker.split(".")[0].upper()  # tickers .MX (BMV) no aplican, EDGAR es solo EE. UU.
        mapping = _edgar_ticker_map()
        if not mapping:
            # El índice de la SEC no bajó: no es que el ticker no exista
            return {"available": False, "error": _EDGAR_ERR_CONN}
        cik = mapping.get(base)
        if not cik:
            return {"available": False, "error": f'"{ticker}" no está registrado ante la SEC — EDGAR solo cubre emisores que reportan en EE. UU.'}
        try:
            resp = _edgar_session.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", timeout=15)
        except Exception:
            return {"available": False, "error": _EDGAR_ERR_CONN}
        if resp.status_code == 404:
            return {"available": False, "error": "SEC EDGAR no tiene expediente XBRL para este emisor."}
        if resp.status_code != 200:
            # 429/5xx son pasajeros (límite de tasa de la SEC), no "no hay expediente"
            return {"available": False, "error": _EDGAR_ERR_CONN}
        try:
            data = resp.json()
        except Exception:
            return {"available": False, "error": _EDGAR_ERR_BAD}
        gaap = data.get("facts", {}).get("us-gaap", {})
        from datetime import date as _date

        def _period_fy(end: str) -> int:
            # Año fiscal del PERIODO, no del 10-K: un 10-K trae comparativos de años previos
            # con el mismo "fy" del reporte. Cierres en la primera semana de enero (años de
            # 52-53 semanas) pertenecen al ejercicio anterior.
            y, m, d = int(end[:4]), int(end[5:7]), int(end[8:10])
            return y - 1 if (m == 1 and d <= 7) else y

        def _is_annual(v) -> bool:
            # Conceptos de flujo traen start: exigir ~un año para descartar trimestres
            # que también aparecen dentro del 10-K. Los de saldo (sin start) pasan.
            if not v.get("start"):
                return True
            try:
                days = (_date.fromisoformat(v["end"]) - _date.fromisoformat(v["start"])).days
            except Exception:
                return False
            return 350 <= days <= 380

        # Por etiqueta se queda el concepto con el dato más reciente: Apple, por ejemplo,
        # dejó "Revenues" en 2018 y siguió con RevenueFromContractWithCustomer...
        best_by_label = {}
        for concept, label in EDGAR_CONCEPTS:
            node = gaap.get(concept)
            if not node:
                continue
            units = node.get("units", {})
            unit_key = "USD/shares" if "USD/shares" in units else ("USD" if "USD" in units else next(iter(units), None))
            if not unit_key:
                continue
            annual = [v for v in units[unit_key]
                      if v.get("form") == "10-K" and v.get("fp") == "FY" and v.get("end") and _is_annual(v)]
            by_year = {}
            for v in annual:
                fy = _period_fy(v["end"])
                # Si hay varias cifras para el mismo periodo, gana la presentada más tarde (reexpresiones)
                if fy not in by_year or v.get("filed", "") > by_year[fy].get("filed", ""):
                    by_year[fy] = v
            values = sorted(({"fy": fy, "end": v["end"], "val": v["val"]} for fy, v in by_year.items()), key=lambda x: x["fy"])[-6:]
            if not values:
                continue
            prev = best_by_label.get(label)
            if prev is None or values[-1]["end"] > prev["values"][-1]["end"]:
                best_by_label[label] = {"concept": concept, "label": label, "unit": unit_key, "values": values}
        # Mismo orden de EDGAR_CONCEPTS
        series, seen_labels = [], set()
        for _, label in EDGAR_CONCEPTS:
            if label in best_by_label and label not in seen_labels:
                series.append(best_by_label[label])
                seen_labels.add(label)
        if not series:
            return {"available": False, "error": "La SEC no reporta series anuales (10-K) para este emisor."}
        return {
            "available": True,
            "ticker": ticker.upper(),
            "cik": cik,
            "name": data.get("entityName"),
            "series": series,
            "source": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-K",
        }
    # Errores de red se guardan solo 60 s; "no registrado" o "sin 10-K" sí duran 6 h
    return _cached(f"edgar:{ticker.upper()}", _fetch, ttl=6 * 3600,
                   ok=lambda r: r.get("error") not in (_EDGAR_ERR_CONN, _EDGAR_ERR_BAD))


# ─── v2: hechos XBRL y Formas 4 (stream B3a) ─────────────────────────────────
#
# Lo de arriba es el legado (``get_edgar_financials``) y no se toca: los goldens lo fijan.
# De aquí para abajo vive lo que usan ``/v2/instrument/{symbol}/statements`` y
# ``/v2/insiders/{symbol}``. Todo sale por ``_edgar_session``, así que el replay lo graba.

SEC_FACTS_TTL = 6 * 3600
SEC_FORM4_TTL = 6 * 3600
FORM4_MAX = 20
"""Cuántas Formas 4 recientes se leen. Cada una es un XML chico; la SEC pide no pasar de 10 req/s."""


def cik_for(symbol: str) -> str | None:
    """CIK de 10 dígitos del símbolo, o ``None`` si no reporta ante la SEC.

    Los símbolos ``.MX`` no aplican: EDGAR solo cubre emisores de EE. UU. Se devuelve ``None``
    sin salir a la red, igual que hace el legado al cortar por el punto.
    """
    base = symbol.split(".")[0].upper()
    if symbol.upper().endswith(".MX"):
        return None
    mapping = _edgar_ticker_map()
    return mapping.get(base) if mapping else None


def get_companyfacts(symbol: str) -> dict | None:
    """``companyfacts`` XBRL del emisor, o ``None`` si no está registrado o la SEC no respondió.

    El resultado es el JSON tal cual lo publica la SEC (``{"entityName", "facts": {...}}``).
    """
    cik = cik_for(symbol)
    if not cik:
        return None

    def fetch() -> dict | None:
        try:
            resp = _edgar_session.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", timeout=15)
        except Exception:
            return None
        if resp.status_code != 200:
            return None
        try:
            data = resp.json()
        except Exception:
            return None
        if not isinstance(data, dict) or not data.get("facts"):
            return None
        data["cik"] = cik
        return data

    return _cached(f"v2:sec:facts:{cik}", fetch, ttl=SEC_FACTS_TTL, ok=lambda d: bool(d))


def _submissions(cik: str) -> dict | None:
    def fetch() -> dict | None:
        try:
            resp = _edgar_session.get(f"https://data.sec.gov/submissions/CIK{cik}.json", timeout=15)
        except Exception:
            return None
        if resp.status_code != 200:
            return None
        try:
            return resp.json()
        except Exception:
            return None

    return _cached(f"v2:sec:subs:{cik}", fetch, ttl=SEC_FACTS_TTL, ok=lambda d: bool(d))


def recent_filings(symbol: str, form: str = "4", limit: int = FORM4_MAX) -> list[dict]:
    """Últimos expedientes de un tipo (``form``) del emisor: accession, fechas y documento."""
    cik = cik_for(symbol)
    if not cik:
        return []
    data = _submissions(cik)
    if not data:
        return []
    recent = (data.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    out: list[dict] = []
    for i, kind in enumerate(forms):
        if kind != form:
            continue
        accession = (recent.get("accessionNumber") or [None] * (i + 1))[i]
        document = (recent.get("primaryDocument") or [None] * (i + 1))[i]
        if not accession or not document:
            continue
        out.append({
            "cik": cik,
            "accession": accession,
            "document": document,
            "filingDate": (recent.get("filingDate") or [None] * (i + 1))[i],
            "reportDate": (recent.get("reportDate") or [None] * (i + 1))[i],
        })
        if len(out) >= limit:
            break
    return out


def get_filing_document(cik: str, accession: str, document: str) -> str | None:
    """Texto del documento principal de un expediente (para la Forma 4, su XML)."""
    folder = accession.replace("-", "")
    url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{folder}/{document}"

    def fetch() -> str | None:
        try:
            resp = _edgar_session.get(url, timeout=15)
        except Exception:
            return None
        if resp.status_code != 200:
            return None
        return resp.text or None

    return _cached(f"v2:sec:doc:{folder}:{document}", fetch, ttl=SEC_FORM4_TTL, ok=lambda t: bool(t))


def raw_document_name(document: str) -> str:
    """Quita la carpeta ``xsl.../`` del documento principal para quedarse con el XML de verdad.

    ``primaryDocument`` de una Forma 4 apunta a la versión RENDERIZADA
    (``xslF345X06/form4.xml``), que es HTML con hojas de estilo y no se puede parsear como XML.
    El archivo fuente vive al lado, en la misma carpeta del expediente (``form4.xml``).
    """
    parts = str(document).split("/")
    if len(parts) > 1 and parts[0].lower().startswith("xsl"):
        return "/".join(parts[1:])
    return str(document)


def get_form4_documents(symbol: str, limit: int = FORM4_MAX) -> list[dict]:
    """Las Formas 4 recientes del emisor con su XML ya descargado.

    Devuelve ``[{accession, filingDate, xml}]``. Lista vacía cuando el símbolo no es de un emisor
    registrado ante la SEC (toda la BMV) o cuando EDGAR no respondió.
    """
    out: list[dict] = []
    for filing in recent_filings(symbol, "4", limit):
        document = raw_document_name(filing["document"])
        if not document.lower().endswith(".xml"):
            continue
        xml = get_filing_document(filing["cik"], filing["accession"], document)
        if not xml:
            continue
        out.append({"accession": filing["accession"], "filingDate": filing["filingDate"], "xml": xml})
    return out
