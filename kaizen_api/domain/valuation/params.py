"""Parámetros de mercado para valuar: Damodaran enero 2026, riesgo país y tasa libre de riesgo.

Dos cosas viven aquí:

1. **El dataset de Damodaran** (``kaizen_api/data/damodaran_2026.json``), descargado de
   ``pages.stern.nyu.edu/~adamodar`` el 22 de septiembre de 2026, vintage de enero de 2026. Trae
   94 industrias por mercado (``US`` y ``EM``) con P/U, P/VL, EV/EBITDA, beta desapalancada,
   crecimiento esperado a 5 años y costo de deuda, más la prima de riesgo de mercado maduro, el
   riesgo país y la tasa de impuesto estatutaria de México y Estados Unidos. Los números se copian
   tal cual del archivo: aquí no se inventa ninguno, y lo que Damodaran no publica (P/FCF por
   industria) queda marcado como faltante en ``missing``.

   La referencia POR SECTOR es la **mediana** de las industrias mapeadas a ese sector en
   ``sectorIndustries``, porque Yahoo clasifica por sector (12 valores) y Damodaran por industria
   (94). El mapa y el método salen en la respuesta para que se pueda auditar.

2. **La tasa libre de riesgo del DCF**, que es el bono gubernamental a 10 años de ESA moneda:
   ``DGS10`` de FRED para el dólar e ``IRLTLT01MXM156N`` (OCDE vía FRED) para el peso. Al
   rendimiento se le resta el diferencial de incumplimiento soberano del país (Damodaran) para
   quedarse con una tasa de verdad libre de riesgo, que es lo que pide el CAPM.

   La costura de B2b (``domain/rates.py``) es CETES 28: la tasa correcta para Sharpe, no para
   descontar diez años. Por eso aquí es el RESPALDO y no la fuente principal, y cuando se usa la
   respuesta sale con ``fallback=true`` y la nota que lo dice. Ver ``docs/requests/B3b.md``.
"""

from __future__ import annotations

import datetime as _dt
import json
import statistics
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import requests

from kaizen_api.domain import _log

DATA_FILE = Path(__file__).resolve().parents[2] / "data" / "damodaran_2026.json"

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"

LONG_RATE_SERIES = {
    "USD": ("DGS10", "Bono del Tesoro de EE. UU. a 10 años (FRED DGS10)"),
    "MXN": ("IRLTLT01MXM156N", "Bono gubernamental de México a 10 años (OCDE vía FRED)"),
}
"""Serie de FRED con el rendimiento del bono largo de cada moneda que sabemos descontar."""

RATE_FREQUENCY = {"DGS10": "daily", "IRLTLT01MXM156N": "monthly"}
"""``DGS10`` es diaria. La de México es el PROMEDIO MENSUAL que publica la OCDE, fechado el día 1."""

RF_STALE_DAYS = 7
"""Días naturales que puede tener el último dato de una serie diaria antes de marcarse ``stale``.
FRED publica ``DGS10`` con un día hábil de rezago; siete días cubren un fin de semana largo."""

RF_STALE_MONTHS = 2
"""Meses que puede quedarse atrás una serie mensual. En septiembre lo normal es tener el promedio de
agosto (un mes); si solo hay el de julio o uno más viejo, la tasa viene atrasada."""

COUNTRY_BY_CURRENCY = {"USD": "United States", "MXN": "Mexico"}

COUNTRY_LABELS = {"Mexico": "México", "United States": "Estados Unidos"}
"""Nombre del país para el texto visible. En el archivo de Damodaran vienen en inglés."""

INFLATION_ANCHORS = {
    "MXN": {
        "value": 0.03,
        "source": "Banxico, objetivo permanente de inflación",
        "asOf": "2026-01-01",
    },
    "USD": {
        "value": 0.02,
        "source": "Reserva Federal, meta de inflación de largo plazo",
        "asOf": "2026-01-01",
    },
}
"""Inflación esperada de largo plazo por moneda: la META del banco central, que es un dato público y
verificable, no un pronóstico nuestro. Se usa para pasar una WACC de una moneda a otra cuando no
hay tasa larga de esa moneda, y como ancla del crecimiento terminal por omisión."""

# ─── supuestos por omisión del DCF (revisión de B3b, punto 6) ───────────────
#
# Antes el crecimiento terminal por omisión era la tasa libre de riesgo (o 6 %) y la etapa 1 crecía
# todo el horizonte al crecimiento de UPA de analistas del sector. Con WALMEX, CEMEX y AAPL eso daba
# un valor terminal de 79 % a 85 % del valor de empresa sin ningún aviso. Los valores de abajo son
# SUPUESTOS NUESTROS, escritos aquí para que se puedan discutir; ninguno sale de una fuente externa
# salvo la meta de inflación.

TERMINAL_REAL_GROWTH = 0.01
"""Crecimiento REAL a perpetuidad que se suma a la meta de inflación para el crecimiento terminal por
omisión: 3 % nominal en dólares (2 % de la Fed más 1 %) y 4 % en pesos (3 % de Banxico más 1 %).

Es deliberadamente modesto: a perpetuidad una empresa no puede crecer más que la economía en la que
vive (Damodaran, "Investment Valuation", cap. 12), y un 1 % real queda por debajo del crecimiento
real de largo plazo de México y de Estados Unidos. La tasa libre de riesgo de la moneda sigue siendo
el TOPE (lo aplica ``dcf.clamp_terminal_growth``), ya no el valor por omisión."""

FADE_STAGE_ONE = True
"""Con el crecimiento por omisión, la etapa 1 arranca en el crecimiento esperado a 5 años del sector
(Damodaran) y baja en línea recta hasta el crecimiento terminal. Ese dato es crecimiento de UPA de
analistas, no del flujo libre, y sostenerlo cinco años completos inflaba el último flujo y con él
el valor terminal. Un crecimiento que el usuario pide en la consulta NO se desvanece: se respeta."""

TV_SHARE_WARNING = 0.75
"""Arriba de este peso del valor terminal en el valor de empresa, ``dcf.warnings`` avisa que el
resultado depende sobre todo de lo que se suponga después del horizonte explícito."""

SECTOR_ALIASES = {
    "financials": "Financial Services",
    "financial": "Financial Services",
    "materials": "Basic Materials",
    "basic materials": "Basic Materials",
    "consumer discretionary": "Consumer Cyclical",
    "consumer staples": "Consumer Defensive",
    "information technology": "Technology",
    "health care": "Healthcare",
    "communication services": "Communication Services",
}

BANK_WORDS = ("bank", "banco", "banks")
INSURER_WORDS = ("insurance", "insurer", "reinsurance", "aseguradora")
REIT_WORDS = ("reit", "fibra")

FUND_TYPES = frozenset({"ETF", "MUTUALFUND", "FUND", "INDEX", "CURRENCY", "CRYPTOCURRENCY"})


class DatasetError(RuntimeError):
    """El archivo de Damodaran no está o no se puede leer."""


@lru_cache(maxsize=1)
def dataset() -> dict:
    """Contenido de ``data/damodaran_2026.json``. Se lee una vez por proceso."""
    try:
        with DATA_FILE.open(encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:  # pragma: no cover - solo si falta el archivo
        raise DatasetError("No se pudo leer el dataset de Damodaran") from exc


def market_parameters(market: str) -> dict:
    """Parámetros con los que Damodaran armó el archivo de costo de capital de ese mercado."""
    data = dataset()
    market = market if market in data["markets"] else "US"
    return data["markets"][market].get("parameters") or {}


def dataset_as_of() -> str:
    return str(dataset().get("dataUpdated") or "2026-01-05")


def normalize_sector(sector: str | None) -> str | None:
    """Sector de Yahoo al nombre que usa ``sectorIndustries``."""
    if not sector:
        return None
    clean = sector.strip()
    if clean in dataset()["sectorIndustries"]:
        return clean
    return SECTOR_ALIASES.get(clean.lower())


def market_for(country: str | None, symbol: str = "") -> str:
    """``"US"`` o ``"EM"``. Manda el país de la emisora; el sufijo ``.MX`` solo desempata."""
    if country:
        return "US" if country.strip() == "United States" else "EM"
    return "EM" if symbol.upper().endswith(".MX") else "US"


@dataclass(frozen=True)
class SectorBenchmark:
    """Referencia sectorial: medianas de las industrias de Damodaran de ese sector."""

    sector: str | None
    market: str
    industries: list[str]
    pe: float | None = None
    pb: float | None = None
    ev_ebitda: float | None = None
    beta_u: float | None = None
    beta_levered: float | None = None
    growth5y: float | None = None
    cost_of_debt_usd: float | None = None
    roe: float | None = None
    as_of: str = ""
    method: str = ""

    def label(self) -> str:
        """Cómo se nombra esta referencia en una nota: el sector, o el total del mercado."""
        if self.sector:
            return f"el sector {self.sector} en el mercado {self.market}"
        return f"el total del mercado {self.market}"


def _median(values: list[float | None]) -> float | None:
    clean = [v for v in values if isinstance(v, (int, float)) and v == v]
    return round(statistics.median(clean), 6) if clean else None


def sector_benchmark(sector: str | None, market: str) -> SectorBenchmark:
    """Medianas del sector; si el sector no se reconoce, el total del mercado."""
    data = dataset()
    market = market if market in data["markets"] else "US"
    industries_data = data["markets"][market]["industries"]
    canonical = normalize_sector(sector)
    names = data["sectorIndustries"].get(canonical or "", [])
    if canonical and names:
        method = (
            f"Mediana de {len(names)} industrias de Damodaran del sector {canonical} "
            f"en el mercado {market}, vintage {data['vintage']}"
        )
        rows = [industries_data[n] for n in names if n in industries_data]
    else:
        totals = data["markets"][market]["totals"]
        rows = [totals.get("Total Market (without financials)") or totals.get("Total Market") or {}]
        names = ["Total Market (without financials)"]
        method = f"Total del mercado {market} de Damodaran (el sector de Yahoo no se pudo mapear)"

    def med(key: str) -> float | None:
        return _median([r.get(key) for r in rows])

    def positive(key: str) -> float | None:
        value = _median([r.get(key) for r in rows if (r.get(key) or 0) > 0])
        return value

    return SectorBenchmark(
        sector=canonical,
        market=market,
        industries=list(names),
        pe=positive("pe"),
        pb=positive("pb"),
        ev_ebitda=positive("evEbitda"),
        beta_u=positive("betaUCash") or positive("betaU"),
        beta_levered=positive("beta"),
        growth5y=med("growth5y"),
        cost_of_debt_usd=positive("costOfDebtUsd"),
        roe=med("roe"),
        as_of=dataset_as_of(),
        method=method,
    )


@dataclass(frozen=True)
class CountryRisk:
    country: str
    mature_erp: float
    crp: float
    default_spread: float
    statutory_tax: float
    rating: str | None
    as_of: str

    @property
    def label(self) -> str:
        """El país como se escribe en español, para las notas que ve el usuario."""
        return COUNTRY_LABELS.get(self.country, self.country)


def country_risk(country: str | None, currency: str | None = None, symbol: str = "") -> CountryRisk:
    """Riesgo país de Damodaran. Si el país no está en el archivo, se usa el de la moneda."""
    data = dataset()
    countries = data["countries"]
    name = (country or "").strip()
    if name not in countries:
        name = COUNTRY_BY_CURRENCY.get((currency or "").upper(), "")
    if name not in countries:
        name = "Mexico" if symbol.upper().endswith(".MX") else "United States"
    row = countries[name]
    return CountryRisk(
        country=name,
        mature_erp=float(data["matureMarketErp"]),
        crp=float(row["crp"]),
        default_spread=float(row["defaultSpread"]),
        statutory_tax=float(row["statutoryTaxRate"]),
        rating=row.get("rating"),
        as_of=str(data.get("countryRiskUpdated") or dataset_as_of()),
    )


COUNTRY_IDS = {"MX": "Mexico", "US": "United States"}
"""Clave ISO de cada país del archivo de Damodaran que publica ``GET /v2/assumptions``."""

ASSUMPTIONS_STALE_DAYS = 400
"""Damodaran actualiza cada enero; pasados 400 días del ``dataUpdated`` ya salió un vintage nuevo."""


def assumptions(today: _dt.date | None = None) -> dict:
    """``GET /v2/assumptions``: prima de mercado y riesgo país del archivo, sin salir a la red.

    ``erp`` es la que usa ``/v2/valuation`` cuando no se pasa ``?erp=`` (``CountryRisk.mature_erp``),
    así que el optimizador y la valuación no pueden separarse cuando cambie el vintage.
    """
    data = dataset()
    countries = data["countries"]
    mature = float(data["matureMarketErp"])
    as_of = dataset_as_of()
    if today is None:
        from kaizen_api.provenance import utc_now

        today = utc_now().date()
    day = today
    stale = (day - _dt.date.fromisoformat(as_of)).days > ASSUMPTIONS_STALE_DAYS
    vintage = str(data.get("vintage") or as_of[:7])
    year, month = vintage.split("-")
    months = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
              "octubre", "noviembre", "diciembre")
    notes = [
        "erp y matureMarketErp son la prima de mercado maduro de Damodaran: la prima implícita de "
        "Estados Unidos menos su prima país. Es la que usa la valuación cuando no se indica otra.",
        "crp es la prima de riesgo país de cada país. La valuación la suma a la prima de mercado con "
        "lambda 1; quien use una tasa libre de riesgo local que ya trae el riesgo soberano no la suma.",
    ]
    if stale:
        notes.append(f"El archivo es de {as_of}: ya debería haber un vintage más nuevo de Damodaran.")
    return {
        "erp": mature,
        "matureMarketErp": mature,
        "crp": {cid: float(countries[name]["crp"]) for cid, name in COUNTRY_IDS.items() if name in countries},
        "source": f"Aswath Damodaran, NYU Stern, vintage {months[int(month) - 1]} {year}",
        "sourceUrl": str(data["homepage"]),
        "vintage": vintage,
        "asOf": as_of,
        "stale": stale,
        "notes": notes,
    }


@dataclass(frozen=True)
class RiskFree:
    """Tasa libre de riesgo de una moneda, con su procedencia."""

    currency: str
    rate: float
    gross_rate: float
    as_of: str | None
    source: str
    label: str
    fallback: bool = False
    notes: list[str] = field(default_factory=list)
    frequency: str = "daily"


def _fred_last(series: str) -> tuple[float, str] | None:
    """Último dato de una serie de FRED en ``fredgraph.csv``: (fracción, fecha ISO)."""
    try:
        resp = requests.get(FRED_CSV.format(series=series), timeout=8)
        if resp.status_code >= 400:
            return None
        lines = resp.text.strip().split("\n")[1:]
    except Exception as exc:  # pragma: no cover - solo cuando FRED falla
        _log(f"valuation: FRED {series} falló: {exc}")
        return None
    for line in reversed(lines):
        date, _, raw = line.partition(",")
        raw = raw.strip()
        if raw in (".", ""):
            continue
        try:
            value = float(raw) / 100.0
        except ValueError:
            continue
        if 0.0 < value < 0.5:
            return value, date.strip()
        break
    return None


def _from_b2b_seam(currency: str) -> tuple[float, str | None, str] | None:
    """Costura de B2b (CETES 28). Se usa solo como respaldo; ver el docstring del módulo.

    Se espera ``kaizen_api.domain.rates.rf_latest(currency)`` devolviendo
    ``{"rate": fracción, "asOf": "YYYY-MM-DD", "source": "banxico"|"fred"}``. Mientras B2b no la
    publique, esta función devuelve ``None`` sin romper nada.
    """
    try:
        from kaizen_api.domain import rates as _rates

        fn = getattr(_rates, "rf_latest", None)
        if fn is None:
            return None
        payload = fn(currency)
    except Exception as exc:  # pragma: no cover - la costura todavía no existe
        _log(f"valuation: la costura rf_latest de B2b falló: {exc}")
        return None
    if not isinstance(payload, dict):
        return None
    rate = payload.get("rate")
    if not isinstance(rate, (int, float)) or not 0.0 < float(rate) < 0.5:
        return None
    source = payload.get("source")
    return float(rate), payload.get("asOf"), source if source in ("banxico", "fred") else "banxico"


def risk_free(currency: str) -> RiskFree | None:
    """Tasa libre de riesgo para descontar en ``currency``. ``None`` si no hay dato real.

    Nunca devuelve un valor fijo silencioso: si ninguna fuente responde, quien llame tiene que
    decir que no se pudo valuar.
    """
    ccy = (currency or "").upper()
    risk = country_risk(None, ccy)
    series = LONG_RATE_SERIES.get(ccy)
    notes: list[str] = []
    if series:
        found = _fred_last(series[0])
        if found:
            gross, as_of = found
            net = gross - risk.default_spread
            frequency = RATE_FREQUENCY.get(series[0], "daily")
            notes.append(
                f"A la tasa del bono a 10 años ({gross:.2%}) se le restó el diferencial de "
                f"incumplimiento soberano de {risk.label} ({risk.default_spread:.2%}), "
                "como pide el CAPM."
            )
            if frequency == "monthly":
                notes.append(
                    f"La tasa larga de {risk.label} es el promedio mensual que publica la OCDE; el "
                    f"último es el del mes que empieza el {as_of}."
                )
            return RiskFree(
                currency=ccy,
                rate=round(net, 6),
                gross_rate=round(gross, 6),
                as_of=as_of,
                source="fred",
                label=series[1],
                fallback=False,
                notes=notes,
                frequency=frequency,
            )
    seam = _from_b2b_seam(ccy)
    if seam:
        rate, as_of, source = seam
        notes.append(
            "No hubo tasa del bono a 10 años, así que se usó la tasa corta de la costura de "
            "tasas (CETES 28). Descontar diez años con una tasa de 28 días es una aproximación."
        )
        return RiskFree(
            currency=ccy,
            rate=round(float(rate), 6),
            gross_rate=round(float(rate), 6),
            as_of=as_of,
            source=source,
            label="CETES 28 días",
            fallback=True,
            notes=notes,
        )
    return None


def inflation_anchor(currency: str) -> dict | None:
    return INFLATION_ANCHORS.get((currency or "").upper())


def default_terminal_growth(currency: str) -> float | None:
    """Meta de inflación de la moneda más ``TERMINAL_REAL_GROWTH``. ``None`` sin ancla de inflación."""
    anchor = inflation_anchor(currency)
    if anchor is None:
        return None
    return round(float(anchor["value"]) + TERMINAL_REAL_GROWTH, 6)


def today() -> _dt.date:
    return _dt.date.today()


def rf_is_stale(rf: RiskFree, now: _dt.date | None = None) -> bool:
    """¿La tasa libre de riesgo es más vieja de lo esperado para la frecuencia de su serie?"""
    if not rf.as_of:
        return False
    day = now or today()
    as_of = _dt.date.fromisoformat(str(rf.as_of)[:10])
    if rf.frequency == "monthly":
        behind = (day.year * 12 + day.month) - (as_of.year * 12 + as_of.month)
        return behind > RF_STALE_MONTHS
    return (day - as_of).days > RF_STALE_DAYS


# ─── clasificación de la emisora ─────────────────────────────────────────────


@dataclass(frozen=True)
class Classification:
    """Qué tipo de emisora es, para saber qué método aplica."""

    is_fund: bool = False
    is_bank: bool = False
    is_insurer: bool = False
    is_reit: bool = False

    @property
    def is_financial(self) -> bool:
        return self.is_bank or self.is_insurer

    @property
    def multiples_reason(self) -> str | None:
        if self.is_fund:
            return "Es un ETF, fondo o índice: los múltiplos de acciones no aplican."
        if self.is_bank:
            return (
                "Es un banco: su balance ES el negocio, así que EV/EBITDA y P/FCF no significan "
                "nada. Se valúa con el P/VL justificado que está en el bloque de bancos."
            )
        if self.is_insurer:
            return (
                "Es una aseguradora: las primas y las reservas no caben en múltiplos de empresa "
                "industrial. Se valúa con el P/VL justificado del bloque de bancos."
            )
        if self.is_reit:
            return (
                "Es una FIBRA o REIT: se compara por su flujo, su distribución y el precio contra el "
                "valor en libros, no por P/U ni EV/EBITDA. El screener de FIBRAs es el lugar correcto."
            )
        return None

    @property
    def dcf_reason(self) -> str | None:
        if self.is_fund:
            return "Es un ETF, fondo o índice: no tiene flujo libre propio que descontar."
        if self.is_reit:
            return (
                "Es una FIBRA o REIT: su utilidad de operación incluye la revaluación de los "
                "inmuebles, que no es efectivo, así que proyectar ese EBIT infla el valor. En el "
                "screener de FIBRAs se compara con el flujo de la operación entre capitalización, el "
                "rendimiento por distribución y el precio contra el valor en libros."
            )
        if self.is_bank or self.is_insurer:
            return (
                "En bancos y aseguradoras la deuda es materia prima, no financiamiento: el FCFF y "
                "la WACC no aplican. Se usa el P/VL justificado."
            )
        return None


def classify(*, quote_type: str | None, sector: str | None, industry: str | None, symbol: str = "") -> Classification:
    """Clasifica por ``quoteType``, sector e industria de Yahoo."""
    qt = (quote_type or "").upper()
    ind = (industry or "").lower()
    sec = (sector or "").lower()
    if qt in FUND_TYPES or symbol.startswith("^"):
        return Classification(is_fund=True)
    is_bank = any(w in ind for w in BANK_WORDS)
    is_insurer = any(w in ind for w in INSURER_WORDS)
    is_reit = any(w in ind for w in REIT_WORDS) or (sec == "real estate" and "reit" in ind)
    return Classification(is_bank=is_bank, is_insurer=is_insurer, is_reit=is_reit)


def today_iso() -> str:
    return _dt.date.today().isoformat()
