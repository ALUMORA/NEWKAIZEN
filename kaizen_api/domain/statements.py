"""Estados financieros reales de ``/v2/instrument/{symbol}/statements`` (stream B3a).

Dos fuentes y ninguna inventada:

* **SEC (``source="sec"``)** para emisores registrados en EE. UU.: hechos XBRL de ``companyfacts``.
  Un periodo existe solo si la SEC publicó un hecho para ese cierre. Los anuales son los flujos de
  350 a 380 días y los saldos con ese mismo cierre; los trimestrales, los flujos de 80 a 100 días.
  El cuarto trimestre de un emisor que no lo reporta simplemente NO aparece: el legado lo fabricaba
  dividiendo el año entre cuatro y multiplicándolo por factores inventados, y eso es justo lo que
  aquí no se hace.
* **Yahoo (``source="yahoo"``)** para todo lo demás, incluida la BMV: los ``DataFrame`` de
  ``income_stmt``, ``balance_sheet`` y ``cashflow`` (y sus versiones trimestrales) tal como vienen.

Sin datos, ``periods`` y ``rows`` salen vacíos: el contrato lo permite y la UI muestra "s/d".

Convención de signos: ``capex`` y ``dividendsPaid`` se entregan NEGATIVOS, porque son salidas de
efectivo. Yahoo ya los da así; los conceptos de la SEC son pagos positivos y aquí se les cambia el
signo. ``freeCashFlow`` se calcula como flujo operativo más capex (capex ya negativo) cuando la
fuente no publica el renglón, y esa derivación se anota en ``meta.notes``.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any

import pandas as pd

from kaizen_api.domain import safe
from kaizen_api.domain.currency import normalize_currency, scale_minor
from kaizen_api.providers.sec_edgar import get_companyfacts, get_edgar_financials
from kaizen_api.providers.yahoo import fundamentals as yahoo_fundamentals

__all__ = ["ROW_IDS", "ROW_LABELS", "get_edgar_financials", "get_statements"]

ROW_LABELS: dict[str, str] = {
    "revenue": "Ingresos totales",
    "grossProfit": "Utilidad bruta",
    "operatingIncome": "Utilidad operativa",
    "netIncome": "Utilidad neta",
    "eps": "UPA diluida",
    "totalAssets": "Activos totales",
    "totalDebt": "Deuda total",
    "cash": "Efectivo y equivalentes",
    "equity": "Capital contable",
    "operatingCashFlow": "Flujo de efectivo operativo",
    "capex": "Inversión en activo fijo",
    "freeCashFlow": "Flujo de efectivo libre",
    "dividendsPaid": "Dividendos pagados",
}
ROW_IDS = tuple(ROW_LABELS)
"""Orden en el que salen los renglones. Es el mismo ``StatementRowId`` del contrato."""

MAX_ANNUAL = 6
MAX_QUARTERLY = 8

# ─── SEC: conceptos us-gaap por renglón ──────────────────────────────────────

SEC_CONCEPTS: dict[str, tuple[str, ...]] = {
    "revenue": (
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
    ),
    "grossProfit": ("GrossProfit",),
    "operatingIncome": ("OperatingIncomeLoss",),
    "netIncome": ("NetIncomeLoss", "ProfitLoss"),
    "eps": ("EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"),
    "totalAssets": ("Assets",),
    "cash": (
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ),
    "equity": (
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ),
    "operatingCashFlow": (
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ),
    "capex": (
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
    ),
    "dividendsPaid": ("PaymentsOfDividendsCommonStock", "PaymentsOfDividends"),
}
"""Renglón del contrato a conceptos us-gaap, en orden de preferencia."""

SEC_DEBT_COMPONENTS = ("LongTermDebtCurrent", "LongTermDebtNoncurrent", "CommercialPaper")
"""``totalDebt`` se suma de sus partes: la SEC no publica un concepto único confiable."""

SEC_NEGATE = frozenset({"capex", "dividendsPaid"})
"""Conceptos que la SEC reporta como pagos positivos y el contrato entrega negativos."""

SEC_FORMS = ("10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F")

# ─── Yahoo: etiquetas de renglón por estado ──────────────────────────────────

YAHOO_ROWS: dict[str, tuple[str, tuple[str, ...]]] = {
    "revenue": ("income", ("Total Revenue", "Operating Revenue")),
    "grossProfit": ("income", ("Gross Profit",)),
    "operatingIncome": ("income", ("Operating Income", "Total Operating Income As Reported", "EBIT")),
    "netIncome": ("income", ("Net Income", "Net Income Common Stockholders", "Net Income From Continuing Operations")),
    "eps": ("income", ("Diluted EPS", "Basic EPS")),
    "totalAssets": ("balance", ("Total Assets",)),
    "totalDebt": ("balance", ("Total Debt", "Net Debt")),
    "cash": ("balance", ("Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments")),
    "equity": (
        "balance",
        ("Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"),
    ),
    "operatingCashFlow": ("cash", ("Operating Cash Flow", "Cash Flow From Continuing Operating Activities")),
    "capex": ("cash", ("Capital Expenditure", "Purchase Of PPE")),
    "freeCashFlow": ("cash", ("Free Cash Flow",)),
    "dividendsPaid": ("cash", ("Cash Dividends Paid", "Common Stock Dividend Paid")),
}
"""Renglón del contrato al estado de Yahoo y a las etiquetas que lo pueden traer."""


def _drop_empty_periods(periods: list[dict], rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Quita las columnas sin un solo dato. Un cierre que ningún renglón reporta no es un periodo."""
    keep = [i for i in range(len(periods)) if any(row["values"][i] is not None for row in rows)]
    if len(keep) == len(periods):
        return periods, rows
    periods = [periods[i] for i in keep]
    rows = [{**row, "values": [row["values"][i] for i in keep]} for row in rows]
    return periods, [row for row in rows if any(v is not None for v in row["values"])]


def _period_fiscal_year(end: str) -> int:
    """Año fiscal del cierre. Un cierre en la primera semana de enero es del ejercicio anterior."""
    year, month, day = int(end[:4]), int(end[5:7]), int(end[8:10])
    return year - 1 if (month == 1 and day <= 7) else year


SEC_ORIGINAL_FILING_DAYS = 150
"""Un hecho presentado a más de 150 días de su cierre ya no es el del expediente que lo estrenó."""


def _fiscal_year(source_fact: dict | None, end: str) -> int:
    """Año fiscal del periodo: el ``fy`` de la SEC si el hecho es del expediente original.

    En ``companyfacts`` el ``fy`` es el ejercicio del DOCUMENTO, no del periodo. En el expediente
    que estrena un cierre los dos coinciden (el 10-Q de Apple a diciembre de 2024 dice fy 2025, fp
    Q1), pero un cierre que solo aparece como comparativo en el 10-K del año siguiente trae el fy
    de ese 10-K. Por eso solo se confía en ``fy`` si el hecho se presentó a 150 días o menos del
    cierre (un 10-K se presenta a más tardar a 90 días y un 10-Q a 45); si no, se usa la regla de
    la fecha, que es lo único que queda.
    """
    fact = source_fact or {}
    fy, filed = fact.get("fy"), fact.get("filed")
    if isinstance(fy, int) and not isinstance(fy, bool) and isinstance(filed, str):
        try:
            lag = (_dt.date.fromisoformat(filed[:10]) - _dt.date.fromisoformat(end)).days
        except ValueError:
            lag = None
        if lag is not None and 0 <= lag <= SEC_ORIGINAL_FILING_DAYS:
            return fy
    return _period_fiscal_year(end)


def _duration_days(fact: dict) -> int | None:
    start, end = fact.get("start"), fact.get("end")
    if not start or not end:
        return None
    try:
        return (_dt.date.fromisoformat(end) - _dt.date.fromisoformat(start)).days
    except ValueError:
        return None


def _wanted_duration(fact: dict, freq: str) -> bool:
    days = _duration_days(fact)
    if days is None:
        return True  # saldo (instante): vale para cualquier frecuencia
    return 350 <= days <= 380 if freq == "annual" else 80 <= days <= 100


def _iter_facts(facts: dict, concept: str) -> tuple[list[dict], str | None]:
    """Hechos de un concepto y la unidad en la que vienen (``USD`` o ``USD/shares``)."""
    node = (facts.get("facts", {}).get("us-gaap") or {}).get(concept)
    if not node:
        return [], None
    units = node.get("units") or {}
    unit = "USD/shares" if "USD/shares" in units else ("USD" if "USD" in units else next(iter(units), None))
    if not unit:
        return [], None
    return [f for f in units[unit] if f.get("end") and f.get("form") in SEC_FORMS], unit


def _sec_series(facts: dict, concept: str, freq: str) -> dict[str, tuple[dict, dict]]:
    """``{cierre: (hecho más reciente, hecho más viejo)}`` de un concepto.

    El VALOR se toma del reportado más tarde, porque una reexpresión corrige al original. La
    etiqueta del periodo (``fy``, ``fp``, ``form``) se toma del reportado más TEMPRANO, porque el
    primer expediente que publica un cierre es el que lo cubre: los que vienen después lo traen
    como comparativo con el ``fp`` de SU trimestre, y ahí es donde se confunden los trimestres.
    """
    rows, _unit = _iter_facts(facts, concept)
    best: dict[str, dict] = {}
    first: dict[str, dict] = {}
    for fact in rows:
        if not _wanted_duration(fact, freq):
            continue
        end = fact["end"]
        prev = best.get(end)
        if prev is None or str(fact.get("filed", "")) > str(prev.get("filed", "")):
            best[end] = fact
        older = first.get(end)
        if older is None or str(fact.get("filed", "")) < str(older.get("filed", "")):
            first[end] = fact
    return {end: (fact, first.get(end, fact)) for end, fact in best.items()}


def _sec_value(series: dict[str, dict[str, tuple[dict, dict]]], row_id: str, end: str):
    """Valor del renglón para ese cierre, del hecho reportado más tarde. ``None`` si no existe."""
    pair = series.get(row_id, {}).get(end)
    return None if pair is None else pair[0].get("val")


def _sec_currency(facts: dict) -> str | None:
    for concept in ("Assets", "Revenues", "NetIncomeLoss"):
        _rows, unit = _iter_facts(facts, concept)
        if unit:
            code = unit.split("/")[0]
            iso, _div = normalize_currency(code)
            if iso:
                return iso
    return "USD"


def _sec_statements(symbol: str, freq: str) -> dict[str, Any] | None:
    facts = get_companyfacts(symbol)
    if not facts:
        return None
    notes: list[str] = []
    series: dict[str, dict[str, tuple[dict, dict]]] = {}
    for row_id, concepts in SEC_CONCEPTS.items():
        merged: dict[str, tuple[dict, dict]] = {}
        for concept in concepts:
            for end, pair in _sec_series(facts, concept, freq).items():
                merged.setdefault(end, pair)
        if merged:
            series[row_id] = merged
    debt: dict[str, float] = {}
    for concept in SEC_DEBT_COMPONENTS:
        for end, (fact, _first) in _sec_series(facts, concept, freq).items():
            value = safe(fact.get("val"))
            if value is None:
                continue
            debt[end] = debt.get(end, 0.0) + value
    if debt:
        notes.append("La deuda total suma papel comercial y deuda de largo plazo, corriente y no corriente.")

    # El eje de periodos sale de los renglones de resultados y flujo, que son los que tienen
    # duración: un saldo suelto de un trimestre comparativo no debe crear una columna.
    drivers = ("revenue", "netIncome", "operatingCashFlow", "operatingIncome")
    ends: set[str] = set()
    for row_id in drivers:
        ends |= set(series.get(row_id, {}))
    if not ends:
        ends = set(series.get("totalAssets", {}))
    if not ends:
        return None
    limit = MAX_ANNUAL if freq == "annual" else MAX_QUARTERLY
    chosen = sorted(ends)[-limit:]

    periods = []
    for end in chosen:
        source_fact = None
        for row_id in drivers:
            pair = series.get(row_id, {}).get(end)
            if pair is not None:
                source_fact = pair[1]
                break
        fp = str((source_fact or {}).get("fp") or "")
        quarter = int(fp[1]) if len(fp) == 2 and fp[0] == "Q" and fp[1].isdigit() else None
        periods.append({
            "end": end,
            "fiscalYear": _fiscal_year(source_fact, end),
            "fiscalQuarter": quarter if freq == "quarterly" else None,
            "form": (source_fact or {}).get("form"),
        })

    rows = []
    for row_id in ROW_IDS:
        if row_id == "totalDebt":
            values = [safe(debt.get(end)) for end in chosen]
        elif row_id == "freeCashFlow":
            values = []
            for end in chosen:
                ocf = safe(_sec_value(series, "operatingCashFlow", end))
                capex = safe(_sec_value(series, "capex", end))
                values.append(None if ocf is None or capex is None else ocf - capex)
        else:
            sign = -1.0 if row_id in SEC_NEGATE else 1.0
            values = []
            for end in chosen:
                value = safe(_sec_value(series, row_id, end))
                values.append(None if value is None else value * sign)
        if any(v is not None for v in values):
            rows.append({"id": row_id, "label": ROW_LABELS[row_id], "values": values})
    if any(r["id"] == "freeCashFlow" for r in rows):
        notes.append("El flujo libre es flujo operativo menos inversión en activo fijo.")
    if freq == "quarterly" and any(
        r["id"] in ("operatingCashFlow", "capex", "freeCashFlow", "dividendsPaid") and any(v is None for v in r["values"])
        for r in rows
    ):
        notes.append(
            "En EE. UU. el flujo de efectivo se reporta acumulado en el año, así que solo el primer "
            "trimestre trae cifra propia. Los huecos se dejan vacíos en vez de restarlos o repartirlos."
        )
    notes.append("Renglones tomados de los hechos XBRL que la emisora reportó a la SEC.")
    periods, rows = _drop_empty_periods(periods, rows)
    return {
        "currency": _sec_currency(facts),
        "source": "sec",
        "periods": periods,
        "rows": rows,
        "notes": notes,
        "as_of": chosen[-1] if chosen else None,
    }


# ─── Yahoo ───────────────────────────────────────────────────────────────────


def _column_date(column: Any) -> str | None:
    try:
        stamp = pd.Timestamp(column)
    except Exception:
        return None
    if pd.isna(stamp):
        return None
    return stamp.date().isoformat()


def _row_values(frame: pd.DataFrame | None, labels: tuple[str, ...], columns: list[Any]) -> list[float | None] | None:
    if frame is None:
        return None
    for label in labels:
        if label in frame.index:
            series = frame.loc[label]
            if isinstance(series, pd.DataFrame):  # etiqueta repetida
                series = series.iloc[0]
            return [safe(series.get(col)) for col in columns]
    return None


def _yahoo_statements(symbol: str, freq: str, currency: str | None = None) -> dict[str, Any] | None:
    frames = {kind: yahoo_fundamentals.get_statement(symbol, kind, freq) for kind in ("income", "balance", "cash")}
    if not any(frame is not None for frame in frames.values()):
        return None
    columns: list[Any] = []
    seen: set[str] = set()
    for frame in frames.values():
        if frame is None:
            continue
        for col in frame.columns:
            iso = _column_date(col)
            if iso and iso not in seen:
                seen.add(iso)
                columns.append(col)
    columns.sort(key=lambda c: _column_date(c) or "")
    limit = MAX_ANNUAL if freq == "annual" else MAX_QUARTERLY
    columns = columns[-limit:]
    if not columns:
        return None
    ends = [_column_date(col) for col in columns]

    notes: list[str] = []
    iso, divisor = normalize_currency(currency)
    rows = []
    for row_id in ROW_IDS:
        kind, labels = YAHOO_ROWS[row_id]
        frame = frames.get(kind)
        values = None
        if frame is not None:
            # Las columnas de un estado pueden no ser las mismas que las del eje: se pide por fecha.
            by_date = {(_column_date(c) or ""): c for c in frame.columns}
            wanted = [by_date.get(end) for end in ends]
            values = _row_values(frame, labels, wanted)
        if values is None and row_id == "freeCashFlow":
            ocf = next((r["values"] for r in rows if r["id"] == "operatingCashFlow"), None)
            capex = next((r["values"] for r in rows if r["id"] == "capex"), None)
            if ocf and capex:
                values = [None if o is None or c is None else o + c for o, c in zip(ocf, capex, strict=True)]
                notes.append("El flujo libre es flujo operativo menos inversión en activo fijo.")
        if values is None or not any(v is not None for v in values):
            continue
        if row_id != "eps" and divisor != 1.0:
            values = [scale_minor(v, divisor) for v in values]
        rows.append({"id": row_id, "label": ROW_LABELS[row_id], "values": values})

    periods = [
        {
            "end": end,
            "fiscalYear": _period_fiscal_year(end),
            "fiscalQuarter": None,
            "form": None,
        }
        for end in ends
    ]
    if freq == "quarterly":
        notes.append("Yahoo no publica el trimestre fiscal ni el documento de origen de cada cierre.")
    notes.append("Renglones tomados de los estados que publica Yahoo, sin rellenar ni estimar nada.")
    periods, rows = _drop_empty_periods(periods, rows)
    ends = [p["end"] for p in periods]
    return {
        "currency": iso,
        "source": "yahoo",
        "periods": periods,
        "rows": rows,
        "notes": notes,
        "as_of": ends[-1] if ends else None,
    }


def get_statements(symbol: str, freq: str = "annual", financial_currency: str | None = None) -> dict[str, Any]:
    """Estados reales del símbolo, listos para ``StatementsResponse`` (sin ``meta``).

    Primero la SEC para emisores de EE. UU. y, si no hay expediente, Yahoo. Sin ninguna de las dos,
    devuelve ``periods`` y ``rows`` vacíos con la nota de por qué, nunca cifras inventadas.
    """
    symbol = symbol.upper()
    freq = freq if freq in ("annual", "quarterly") else "annual"
    payload = _sec_statements(symbol, freq)
    if payload is None:
        if financial_currency is None:
            financial_currency = yahoo_fundamentals.get_info(symbol).get("financialCurrency")
        payload = _yahoo_statements(symbol, freq, financial_currency)
    if payload is None:
        iso, _div = normalize_currency(financial_currency)
        payload = {
            "currency": iso,
            "source": "yahoo",
            "periods": [],
            "rows": [],
            "notes": ["No hay estados financieros publicados para este símbolo."],
            "as_of": None,
        }
    payload["symbol"] = symbol
    payload["freq"] = freq
    return payload
