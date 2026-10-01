"""Contrato del API v2 de KAIZEN: modelos pydantic de TODAS las respuestas. CONGELADO.

Después del checkpoint M1 este archivo y ``docs/api-v2.md`` solo cambian con una solicitud al
orquestador (``docs/requests/<stream>.md``). Las rutas declaran ``response_model`` con estos
modelos, así que una respuesta que no cumpla el contrato falla con 500 en vez de salir mal.

Convenciones (también en docs/api-v2.md):

* JSON UTF-8 y nombres de campo en camelCase.
* Tasas, rendimientos, márgenes, crecimientos, pesos y probabilidades son FRACCIONES decimales
  (0.0123 = 1.23 %). Múltiplos (P/E, EV/EBITDA, P/B, P/NAV, D/E) son razones simples. Los cambios
  de tasas van en puntos base en campos que terminan en ``Bp``. Los montos están en la moneda del
  campo ``currency`` más cercano.
* Fechas ``YYYY-MM-DD``; instantes ISO 8601 con zona (UTC con ``Z``).
* Cualquier métrica numérica puede ser ``null`` si la fuente no la tiene; la UI muestra "s/d".
* Toda respuesta exitosa de datos lleva ``meta`` (``Meta``) con la procedencia.
* Los modelos prohíben campos extra (``extra="forbid"``): agregar un campo es cambiar el contrato.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# ─── patrones y tipos base ───────────────────────────────────────────────────

SYMBOL_PATTERN = r"^[A-Za-z0-9.\-\^=$]{1,20}$"
"""Símbolo válido (se pasa a mayúsculas en el servidor). ``.MX`` = BMV/SIC en MXN."""

FX_PAIR_PATTERN = r"^[A-Za-z]{6}$"
"""Par de divisas sin separador, por ejemplo ``USDMXN``."""

ISO_DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"
INSTANT_PATTERN = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$"
DATE_OR_INSTANT_PATTERN = r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$"

SOURCE_TOKENS = (
    "yahoo",
    "banxico",
    "fred",
    "sec",
    "cboe",
    "stooq",
    "rss",
    "eodhd",
    "computed",
    "curated",
    "damodaran",
    "replay",
    "treasury",
    "frankfurter",
    "cftc",
    "bls",
    "worldbank",
)
"""Fuentes válidas para ``meta.source`` (una o varias separadas por coma, sin espacios)."""

SOURCE_PATTERN = r"^(" + "|".join(SOURCE_TOKENS) + r")(,(" + "|".join(SOURCE_TOKENS) + r"))*$"

Symbol = Annotated[str, Field(pattern=SYMBOL_PATTERN, examples=["WALMEX.MX"])]
FxPair = Annotated[str, Field(pattern=FX_PAIR_PATTERN, examples=["USDMXN"])]
IsoDate = Annotated[str, Field(pattern=ISO_DATE_PATTERN, examples=["2026-09-22"])]
Instant = Annotated[str, Field(pattern=INSTANT_PATTERN, examples=["2026-09-22T14:51:31Z"])]
DateOrInstant = Annotated[str, Field(pattern=DATE_OR_INSTANT_PATTERN, examples=["2026-09-22"])]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$", examples=["MXN"])]
"""ISO 4217 de tres letras. Yahoo reporta unidades menores en algunas plazas (GBp en Londres, ZAc
en Johannesburgo): el proveedor las normaliza a GBP y ZAR dividiendo el monto entre 100 antes de
armar la respuesta, porque aquí no caben."""
HttpUrl = Annotated[str, Field(pattern=r"^https?://", examples=["https://example.com/nota"])]
"""Liga que se le puede dar al navegador. El patrón deja fuera javascript: y data:, que llegan en
algunos RSS; el proveedor descarta el elemento en vez de publicarlo."""
Fraction = Annotated[float, Field(description="Fracción decimal: 0.0123 = 1.23 %")]
Bp = Annotated[float, Field(description="Puntos base: 0.0001 = 1 pb")]
SourceToken = Annotated[str, Field(pattern=SOURCE_PATTERN, description="Fuente o lista separada por comas")]
HttpsUrl = Annotated[str, Field(pattern=r"^https://", examples=["https://www.sec.gov/Archives/edgar/data/320193/x.htm"])]
YearMonth = Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", examples=["2026-09"])]
Money = Annotated[float, Field(description="Monto en la moneda del campo currency más cercano")]
Ratio = Annotated[float, Field(description="Razón simple (múltiplo), no porcentaje")]

InstrumentType = Literal["equity", "etf", "fibra", "index", "fx", "crypto", "commodity", "fund"]
Range = Literal["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"]
Interval = Literal["1d", "1wk", "1mo"]
OhlcRange = Literal["1d", "5d", "1mo", "6mo", "1y", "5y", "max"]
"""Rangos de ``/v2/ohlc`` (solo ahí; ``Range`` sigue siendo el de history y panel)."""
OhlcInterval = Literal["5m", "1h", "1d", "1wk", "1mo"]
"""Intervalos de ``/v2/ohlc``: 5m y 1h son intradía (``t`` con zona), los demás por fecha."""
OHLC_INTRADAY: frozenset[str] = frozenset({"5m", "1h"})
CcyParam = Literal["native", "MXN", "USD"]

ErrorCode = Literal[
    "VALIDATION_ERROR",
    "INVALID_SYMBOL",
    "BAD_REQUEST",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "METHOD_NOT_ALLOWED",
    "RATE_LIMITED",
    "UPSTREAM_UNAVAILABLE",
    "NOT_CONFIGURED",
    "NOT_IMPLEMENTED",
    "INTERNAL",
    "INVALID_PARAM",
]

KNOWN_CAPABILITIES = (
    "auth",
    "legacy.v1",
    "quotes",
    "search",
    "history",
    "panel",
    "fx",
    "fx.history",
    "rates.mx",
    "rf.series",
    "rates.inpc",
    "panel.splits",
    "macro.us",
    "markets.overview",
    "markets.world",
    "news",
    "events",
    "instrument",
    "statements.real",
    "dividends",
    "valuation.multiples",
    "valuation.dcf",
    "momentum",
    "screeners.factors",
    "screeners.magic",
    "screeners.fibras",
    "insiders",
    "assumptions",
    # fase 5 (M5): ninguna se anuncia hasta que su ruta deje de ser stub
    "curves",
    "moneyMarket",
    "expectations",
    "fxdesk",
    "fxdesk.crosses",
    "fxdesk.fix",
    "fxdesk.forward",
    "calendar.economic",
    "macro.indicators",
    "macro.world",
    "events.season",
    "events.dividends",
    "earnings",
    "holders",
    "shares",
    "filings",
    "ohlc",
    "ohlc.intraday",
    "movers",
    "breadth",
    "sectors",
    "funds",
    "reference.mx",
    "business.industries",
    "creditHealth",
)
"""Valores posibles de ``/health.capabilities``. Solo se anuncia lo que ya funciona."""


class ContractModel(BaseModel):
    """Base de todo el contrato: sin campos extra y con alias para palabras reservadas."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


def _same_length(owner: str, reference: list, **arrays: list | None) -> None:
    for name, values in arrays.items():
        if values is not None and len(values) != len(reference):
            raise ValueError(f"{owner}: {name} tiene {len(values)} valores y se esperaban {len(reference)}")


# ─── procedencia y errores ───────────────────────────────────────────────────


class Meta(ContractModel):
    """Procedencia de una respuesta. ``fallback=true`` obliga a la UI a decir que es sustituto."""

    asOf: DateOrInstant | None = Field(description="Fecha o instante del dato más nuevo")
    source: str = Field(pattern=SOURCE_PATTERN, description="Fuente o lista separada por comas")
    delayMinutes: int | None = Field(ge=0, description="Retraso típico de la fuente en minutos")
    stale: bool = Field(description="El dato es más viejo de lo esperado para su clase")
    fallback: bool = Field(description="Se usó una fuente sustituta o un valor de referencia")
    generatedAt: Instant = Field(description="Instante en que el servidor armó la respuesta")
    notes: list[str] = Field(description="Avisos en español para la UI (rellenos, ajustes, huecos)")


class ErrorDetail(ContractModel):
    code: ErrorCode
    message: str = Field(description="Mensaje en español, apto para mostrarse al usuario")
    details: dict[str, Any] | None = None


class ErrorBody(ContractModel):
    """Cuerpo de todo error: ``{"error": {"code", "message", "details"?}}`` con el status HTTP real."""

    error: ErrorDetail


# ─── plataforma ──────────────────────────────────────────────────────────────


class ProviderOk(ContractModel):
    ok: bool | None = Field(description="null = no se ha comprobado")


class ProviderConfigured(ContractModel):
    configured: bool


class HealthProviders(ContractModel):
    yahoo: ProviderOk
    banxico: ProviderConfigured
    fred: ProviderConfigured
    sec: ProviderOk
    eodhd: ProviderConfigured


class HealthResponse(ContractModel):
    status: Literal["ok"]
    apiVersion: Literal[2]
    version: str
    commit: str | None
    authRequired: bool
    capabilities: list[str] = Field(description="Subconjunto de KNOWN_CAPABILITIES")
    providers: HealthProviders
    serverTime: Instant


class LoginRequest(BaseModel):
    """Cuerpo de ``POST /auth/login``. Acepta y descarta campos extra."""

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class AuthUser(ContractModel):
    username: str
    displayName: str


class LoginResponse(ContractModel):
    token: str = Field(description="JWT HS256; mándalo como Authorization: Bearer <token>")
    expiresAt: Instant
    user: AuthUser


class MeResponse(ContractModel):
    user: AuthUser
    expiresAt: Instant


# ─── datos de mercado ────────────────────────────────────────────────────────


class Quote(ContractModel):
    symbol: Symbol
    name: str
    price: Money
    previousClose: Money | None
    change: Money | None
    changePct: Fraction | None
    currency: Currency
    exchange: str | None
    type: InstrumentType | None
    marketState: str | None
    asOf: DateOrInstant | None
    sector: str | None = Field(
        default=None,
        description=(
            "Sector de Yahoo en español de México (el mismo que usan los screeners), para mostrar; null si"
            " Yahoo no lo trae. Para agrupar o cruzar usa sectorKey: la traducción junta sectores distintos"
        ),
    )
    sectorKey: str | None = Field(
        default=None,
        description=(
            "Sector crudo de Yahoo, en inglés y sin traducir (el mismo texto que InstrumentResponse.sector);"
            " null si Yahoo no lo trae"
        ),
    )
    industry: str | None = Field(
        default=None,
        description="Industria tal como la publica Yahoo, en inglés; null si no viene",
    )


class QuotesResponse(ContractModel):
    quotes: list[Quote]
    missing: list[str] = Field(description="Símbolos pedidos sin cotización")
    meta: Meta


class SearchResult(ContractModel):
    symbol: Symbol
    name: str
    exchange: str | None
    type: InstrumentType
    currency: Currency | None
    aliases: list[str] = Field(description="Nombres alternos en español (FEMSA, Walmart de México...)")


class SearchResponse(ContractModel):
    results: list[SearchResult]
    meta: Meta


class FxSource(ContractModel):
    pair: Literal["USDMXN"]
    source: str


class HistoryResponse(ContractModel):
    """Cierres ajustados (rendimiento total). ``dates`` y ``close`` tienen la misma longitud."""

    symbol: Symbol
    currency: Currency
    interval: Interval
    adjusted: Literal[True]
    dates: list[IsoDate]
    close: list[float]
    fx: FxSource | None = Field(description="Tipo de cambio usado si ccy convirtió la serie")
    meta: Meta

    @model_validator(mode="after")
    def _lengths(self) -> HistoryResponse:
        _same_length("history", self.dates, close=self.close)
        return self


class DroppedSymbol(ContractModel):
    symbol: str
    reason: str


class PanelResponse(ContractModel):
    """Precios alineados por fecha (INNER JOIN, sin rellenar precios)."""

    currency: Currency
    interval: Interval
    adjustment: Literal["total", "splits"] = Field(
        default="total",
        description=(
            "total = cierres ajustados por splits y dividendos (rendimiento total, lo de siempre); splits ="
            " solo por splits, pedido con ?adjust=splits. Ausente en un API anterior a la fase 3: total"
        ),
    )
    dates: list[IsoDate]
    prices: dict[str, list[float]]
    dropped: list[DroppedSymbol]
    meta: Meta

    @model_validator(mode="after")
    def _lengths(self) -> PanelResponse:
        _same_length("panel", self.dates, **self.prices)
        return self


class FxResponse(ContractModel):
    pair: FxPair
    rate: float
    asOf: DateOrInstant
    source: Literal["banxico_fix", "yahoo"]
    stale: bool
    meta: Meta


class FxHistoryResponse(ContractModel):
    pair: FxPair
    dates: list[IsoDate]
    values: list[float]
    source: Literal["banxico_fix", "yahoo"]
    meta: Meta

    @model_validator(mode="after")
    def _lengths(self) -> FxHistoryResponse:
        _same_length("fx/history", self.dates, values=self.values)
        return self


# ─── tasas y macro ───────────────────────────────────────────────────────────

MxRateId = Literal[
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
]


class MxRateItem(ContractModel):
    id: MxRateId
    label: str
    value: float = Field(description="Fracción si unit=fraction; nivel si index o mxn")
    unit: Literal["fraction", "index", "mxn"]
    asOf: IsoDate
    seriesId: str = Field(
        description="Id de la serie en su fuente: el SIE de Banxico (p. ej. SF61745) o FRED cuando el renglón es un respaldo"
    )
    source: str
    previous: float | None
    changeBp: float | None
    verified: bool = Field(
        default=False,
        description=(
            "true solo si la serie es del SIE, tiene revisión humana en el catálogo y el SIE la confirmó en"
            " las últimas 24 horas (la verificación se guarda un día); los respaldos de FRED van en false"
        ),
    )
    stale: bool | None = Field(
        default=None,
        description=(
            "El último dato de ESTA serie es más viejo de lo que se tolera para su periodicidad. El servidor"
            " siempre lo manda; null o ausente es un API anterior a la fase 3 y el cliente usa meta.stale"
        ),
    )
    tenorDays: Literal[28, 91, 182, 364] | None = Field(
        default=None,
        description="Plazo en días de los CETES (el mismo de /v2/rates/rf); null en las demás series",
    )


class MxRatesResponse(ContractModel):
    items: list[MxRateItem]
    meta: Meta


class InpcResponse(ContractModel):
    """Nivel mensual del INPC general (SIE ``SP1``), para actualizar costos fiscales."""

    seriesId: str = Field(description="Id de la serie en el SIE de Banxico (SP1)")
    base: str | None = Field(description="Periodo base del índice (= 100)")
    monthly: dict[str, float] = Field(
        description='{"AAAA-MM": nivel}, en orden cronológico; un mes sin dato publicado no aparece'
    )
    meta: Meta

    @model_validator(mode="after")
    def _months(self) -> InpcResponse:
        bad = [k for k in self.monthly if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", k)]
        if bad:
            raise ValueError(f"rates/mx/inpc: llaves que no son AAAA-MM: {bad[:3]}")
        return self


class RfSeriesResponse(ContractModel):
    """Rendimientos anualizados simples act/360 como fracción. El cliente convierte por periodo."""

    tenorDays: Literal[28, 91, 182, 364]
    convention: Literal["simple_act360"]
    dates: list[IsoDate]
    values: list[Fraction]
    source: Literal["banxico", "fred_ir3tib"]
    fallback: bool
    meta: Meta

    @model_validator(mode="after")
    def _lengths(self) -> RfSeriesResponse:
        _same_length("rates/rf", self.dates, values=self.values)
        return self


UsMacroId = Literal["ust3m", "ust2y", "ust10y", "spread10y2y", "spread10y3m", "vix", "dxy", "fedFunds"]


class UsMacroItem(ContractModel):
    id: UsMacroId
    label: str
    value: float
    previous: float | None
    change: float | None = Field(description="En la unidad de value")
    changeBp: float | None = Field(description="Solo para tasas y diferenciales")
    unit: Literal["fraction", "bp", "index"]
    asOf: DateOrInstant
    source: str


class UsMacroResponse(ContractModel):
    items: list[UsMacroItem]
    meta: Meta


# ─── mercados y noticias ─────────────────────────────────────────────────────


class MarketItem(ContractModel):
    symbol: Symbol
    label: str
    price: float | None
    change: float | None
    changePct: Fraction | None
    currency: Currency | None
    asOf: DateOrInstant | None


class MarketGroup(ContractModel):
    id: Literal["mx", "us", "global", "fx", "commodities", "crypto"]
    label: str
    items: list[MarketItem]


class ExchangeStatus(ContractModel):
    open: bool
    label: str
    nextOpen: Instant | None
    nextClose: Instant | None
    lastClose: IsoDate | None = Field(
        default=None,
        description=(
            "Fecha, en la zona de la bolsa, de la última jornada que ya cerró (con la bolsa abierta es la"
            " anterior a hoy). Sale del calendario; null si no hay jornada en los últimos 30 días o el API"
            " es anterior a la fase 3"
        ),
    )


class MarketStatus(ContractModel):
    bmv: ExchangeStatus
    nyse: ExchangeStatus


class MarketsOverviewResponse(ContractModel):
    groups: list[MarketGroup]
    marketStatus: MarketStatus
    meta: Meta


class WorldItem(ContractModel):
    country: str = Field(pattern=r"^\d{3}$", description="ISO 3166-1 numérico (484 = México)")
    symbol: Symbol
    label: str
    changePct: Fraction | None
    currency: Literal["USD"]
    asOf: DateOrInstant | None


class WorldResponse(ContractModel):
    items: list[WorldItem]
    method: str
    meta: Meta


class NewsTone(ContractModel):
    label: Literal["positivo", "negativo", "neutral"]
    score: float = Field(ge=-1, le=1)
    method: Literal["heuristic"]


class NewsItem(ContractModel):
    """Titular y liga, nada más: entidades HTML decodificadas, sin duplicados por título."""

    id: str
    title: str
    url: HttpUrl
    source: str
    publishedAt: Instant | None
    summary: str | None
    lang: Literal["es", "en"]
    tone: NewsTone | None


class NewsResponse(ContractModel):
    items: list[NewsItem]
    meta: Meta


class EventItem(ContractModel):
    symbol: Symbol
    type: Literal["earnings", "exDividend", "dividendPay"]
    date: IsoDate
    estimate: float | None
    amount: Money | None
    currency: Currency | None
    estimateLow: float | None = Field(
        default=None,
        description="Estimado más bajo de UPA de los analistas (solo earnings); null o ausente si no viene",
    )
    estimateHigh: float | None = Field(
        default=None,
        description="Estimado más alto de UPA de los analistas (solo earnings); null o ausente si no viene",
    )


class DividendSummaryItem(ContractModel):
    """Lo último que pagó la emisora. El monto futuro no se conoce: la UI lo etiqueta "último pagado"."""

    symbol: Symbol
    currency: Currency | None
    lastPaidAmount: Money | None = Field(description="Monto por acción del último dividendo pagado")
    lastPaidDate: IsoDate | None
    frequency: Literal["mensual", "trimestral", "semestral", "anual", "irregular"] | None
    paidMonths: list[Annotated[int, Field(ge=1, le=12)]] = Field(description="Meses (1 a 12) en que suele pagar")


class EventsResponse(ContractModel):
    items: list[EventItem]
    dividendSummary: list[DividendSummaryItem] | None = Field(
        default=None,
        description="Resumen de dividendos por símbolo (fase 5); null o ausente en un API anterior",
    )
    meta: Meta


# ─── investigación ───────────────────────────────────────────────────────────


class FxRateUsed(ContractModel):
    pair: FxPair
    rate: float
    asOf: DateOrInstant | None


class InstrumentQuote(ContractModel):
    price: Money | None
    previousClose: Money | None
    change: Money | None
    changePct: Fraction | None
    dayLow: Money | None
    dayHigh: Money | None
    low52w: Money | None
    high52w: Money | None
    volume: float | None
    avgVolume: float | None
    marketCap: Money | None
    asOf: DateOrInstant | None


class Fundamentals(ContractModel):
    """Razones en priceCurrency: los estados se convierten de financialCurrency antes de mezclar."""

    pe: Ratio | None
    forwardPe: Ratio | None
    pb: Ratio | None
    ps: Ratio | None
    evEbitda: Ratio | None
    pfcf: Ratio | None
    earningsYield: Fraction | None
    fcfYield: Fraction | None
    dividendYield: Fraction | None
    payoutRatio: Fraction | None
    roe: Fraction | None
    roa: Fraction | None
    grossMargin: Fraction | None
    operatingMargin: Fraction | None
    netMargin: Fraction | None
    revenueGrowthYoY: Fraction | None
    epsGrowthYoY: Fraction | None
    debtToEquity: Ratio | None = Field(description="Razón; Yahoo lo da en %, se divide entre 100")
    netDebtToEbitda: Ratio | None
    currentRatio: Ratio | None
    enterpriseValue: Money | None
    sharesOutstanding: float | None


FundamentalKey = Literal[
    "pe",
    "forwardPe",
    "pb",
    "ps",
    "evEbitda",
    "pfcf",
    "earningsYield",
    "fcfYield",
    "dividendYield",
    "payoutRatio",
    "roe",
    "roa",
    "grossMargin",
    "operatingMargin",
    "netMargin",
    "revenueGrowthYoY",
    "epsGrowthYoY",
    "debtToEquity",
    "netDebtToEbitda",
    "currentRatio",
    "enterpriseValue",
    "sharesOutstanding",
]


class Beta(ContractModel):
    value: float
    adjusted: float | None = Field(description="Beta de Blume: 0.67 x beta + 0.33")
    benchmark: str
    currency: Currency
    window: str = Field(description="Ventana y frecuencia, por ejemplo 2y semanal")
    observations: int = Field(ge=0)
    source: Literal["computed", "yahoo"]


class Coverage(ContractModel):
    available: int = Field(ge=0)
    total: int = Field(ge=0)


class InstrumentResponse(ContractModel):
    symbol: Symbol
    name: str
    exchange: str | None
    type: InstrumentType | None
    sector: str | None
    industry: str | None
    country: str | None
    description: str | None
    website: HttpUrl | None
    priceCurrency: Currency
    financialCurrency: Currency | None
    fxUsed: FxRateUsed | None
    quote: InstrumentQuote
    fundamentals: Fundamentals
    beta: Beta | None
    sectorMedians: dict[FundamentalKey, float | None] | None
    coverage: Coverage
    meta: Meta


StatementRowId = Literal[
    "revenue",
    "grossProfit",
    "operatingIncome",
    "netIncome",
    "eps",
    "totalAssets",
    "totalDebt",
    "cash",
    "equity",
    "operatingCashFlow",
    "capex",
    "freeCashFlow",
    "dividendsPaid",
]


class StatementPeriod(ContractModel):
    end: IsoDate
    fiscalYear: int
    fiscalQuarter: int | None = Field(ge=1, le=4)
    form: str | None = Field(description="10-K, 10-Q o null si la fuente no lo dice")


class StatementRow(ContractModel):
    id: StatementRowId
    label: str
    values: list[float | None]


class StatementsResponse(ContractModel):
    """Solo renglones reales, nunca sintetizados. Sin datos: periods vacío."""

    symbol: Symbol
    currency: Currency | None
    freq: Literal["annual", "quarterly"]
    source: Literal["sec", "yahoo"]
    periods: list[StatementPeriod]
    rows: list[StatementRow]
    meta: Meta

    @model_validator(mode="after")
    def _lengths(self) -> StatementsResponse:
        for row in self.rows:
            _same_length(f"statements.{row.id}", self.periods, values=row.values)
        return self


class DividendPoint(ContractModel):
    date: IsoDate
    amount: Money


class DividendsResponse(ContractModel):
    symbol: Symbol
    currency: Currency | None
    ttm: Money | None = Field(description="Suma de los últimos 12 meses por acción")
    yield_: Fraction | None = Field(alias="yield")
    history: list[DividendPoint]
    meta: Meta


class ValuationAssumptions(ContractModel):
    rf: Fraction
    erp: Fraction
    crp: Fraction
    lambda_: float = Field(alias="lambda", description="Exposición al riesgo país (Damodaran)")
    taxRate: Fraction
    terminalGrowth: Fraction
    source: str
    asOf: DateOrInstant | None


class MultipleMethod(ContractModel):
    id: Literal["pe", "pb", "evEbitda", "pfcf"]
    label: str
    current: Ratio | None
    benchmark: Ratio | None
    impliedPrice: Money | None
    applicable: bool


class FairValueRange(ContractModel):
    low: Money
    mid: Money
    high: Money


class MultiplesValuation(ContractModel):
    applicable: bool
    reason: str | None
    market: Literal["US", "EM"]
    source: str
    asOf: DateOrInstant | None
    methods: list[MultipleMethod]
    fairValueRange: FairValueRange | None


class DcfInputs(ContractModel):
    fcff0: Money | None
    growth: Fraction | None
    years: int | None = Field(ge=1, le=30)
    terminalGrowth: Fraction | None
    betaU: float | None
    betaL: float | None
    debtToEquity: Ratio | None
    taxRate: Fraction | None
    costOfEquity: Fraction | None
    costOfDebt: Fraction | None
    wacc: Fraction | None
    currency: Currency


class DcfProjectionYear(ContractModel):
    year: int = Field(ge=1)
    fcff: Money
    discountFactor: float
    pv: Money


class Sensitivity(ContractModel):
    """``grid[i][j]`` es el valor por acción con ``waccs[i]`` y ``growths[j]``."""

    waccs: list[Fraction]
    growths: list[Fraction]
    grid: list[list[float | None]]

    @model_validator(mode="after")
    def _shape(self) -> Sensitivity:
        _same_length("sensitivity", self.waccs, grid=self.grid)
        for row in self.grid:
            _same_length("sensitivity.grid", self.growths, row=row)
        return self


class DcfValuation(ContractModel):
    applicable: bool
    reason: str | None
    inputs: DcfInputs
    projection: list[DcfProjectionYear]
    terminalValue: Money | None
    pvTerminal: Money | None
    tvShare: Fraction | None = Field(description="Peso del valor terminal en el valor empresa")
    enterpriseValue: Money | None
    netDebt: Money | None
    minorityInterest: Money | None
    equityValue: Money | None
    sharesOutstanding: float | None
    perShare: Money | None
    sensitivity: Sensitivity | None
    warnings: list[str]


class BankValuation(ContractModel):
    applicable: bool
    justifiedPB: Ratio | None
    roe: Fraction | None
    costOfEquity: Fraction | None
    growth: Fraction | None
    impliedPrice: Money | None


class ValuationResponse(ContractModel):
    symbol: Symbol
    currency: Currency
    assumptions: ValuationAssumptions
    multiples: MultiplesValuation
    dcf: DcfValuation
    bank: BankValuation | None
    meta: Meta


CountryId = Literal["MX", "US"]


class AssumptionsResponse(ContractModel):
    """Supuestos de mercado del API (Damodaran), para que el cliente no copie constantes."""

    erp: Fraction = Field(
        description=(
            "Prima de riesgo de mercado por omisión del CAPM del API: la misma que usa /v2/valuation sin"
            " ?erp=. Hoy es la de mercado maduro"
        )
    )
    matureMarketErp: Fraction = Field(
        description="Prima de mercado maduro de Damodaran: la implícita de EE. UU. menos su prima país"
    )
    crp: dict[CountryId, Fraction] = Field(
        description="Prima de riesgo país por país del archivo (MX, US). /v2/valuation la suma a erp con lambda 1"
    )
    source: str = Field(description="Quién publica los datos y de qué vintage, en texto para la UI")
    sourceUrl: str = Field(pattern=r"^https?://", description="Página de donde se descargó el archivo")
    vintage: str = Field(pattern=r"^\d{4}-\d{2}$", description="Vintage del archivo, AAAA-MM")
    asOf: IsoDate = Field(description="Fecha de actualización de los datos según el autor")
    meta: Meta


class MomentumResponse(ContractModel):
    """Rendimientos como fracción; r12m1 = 12 meses excluyendo el último."""

    symbol: Symbol
    currency: Currency
    benchmark: str
    r12m1: Fraction | None
    r6m: Fraction | None
    r3m: Fraction | None
    benchmarkR12m1: Fraction | None
    relative12m1: Fraction | None
    meta: Meta


# ─── screeners ───────────────────────────────────────────────────────────────


class FactorScores(ContractModel):
    value: float | None
    quality: float | None
    momentum: float | None
    lowVol: float | None
    growth: float | None
    composite: float | None


class FactorCheck(ContractModel):
    id: str
    label: str
    pass_: bool | None = Field(alias="pass")
    value: float | str | None
    threshold: float | str | None


class FactorRow(ContractModel):
    symbol: Symbol
    name: str | None
    sector: str | None
    scores: FactorScores | None
    coverage: Fraction = Field(ge=0, le=1, description="Fracción de métricas disponibles")
    excluded: bool
    reason: str | None
    checks: list[FactorCheck]
    metrics: dict[str, float | None]


class FactorUniverse(ContractModel):
    id: Literal["mx", "us", "custom"]
    name: str
    size: int = Field(ge=0)


class FactorsResponse(ContractModel):
    universe: FactorUniverse
    method: str
    rows: list[FactorRow]
    meta: Meta


class MagicUniverse(ContractModel):
    id: Literal["us", "mx"]
    name: str
    size: int = Field(ge=0)
    description: str


class MagicRow(ContractModel):
    """Solo EBIT reportado (nunca estimado); earningsYield y returnOnCapital como fracción."""

    symbol: Symbol
    name: str | None
    sector: str | None
    ebit: Money
    enterpriseValue: Money
    earningsYield: Fraction
    returnOnCapital: Fraction
    rankEY: int = Field(ge=1)
    rankROC: int = Field(ge=1)
    rank: int = Field(ge=1)
    currency: Currency
    fiscalPeriodEnd: IsoDate | None
    ebitSource: Literal["operating_income", "ebit_row"] | None = Field(
        default=None,
        description=(
            "De dónde salió el EBIT: operating_income es la utilidad de operación reportada (lo normal);"
            " ebit_row es el renglón EBIT de Yahoo, de respaldo, que puede traer partidas no operativas."
            " null o ausente es un API anterior a la fase 3"
        ),
    )


class ExcludedSymbol(ContractModel):
    symbol: str
    reason: str


class MagicResponse(ContractModel):
    universe: MagicUniverse
    rows: list[MagicRow]
    excluded: list[ExcludedSymbol]
    partial: bool
    meta: Meta


class FibraRow(ContractModel):
    symbol: Symbol
    name: str | None
    price: Money | None
    currency: Currency
    financialCurrency: Currency | None
    marketCap: Money | None
    distributionYield: Fraction | None
    capRate: Fraction | None
    navPerCbfi: Money | None
    pNav: Ratio | None
    ltv: Fraction | None = Field(description="Deuda / activos totales")
    debtToMarketCap: Ratio | None
    cashFlowYield: Fraction | None
    cashFlowBasis: Literal["ffo_approx", "ocf", "fcf"] | None
    spreadVsCetes: Fraction | None
    signal: Literal["descuento", "en_linea", "prima", "sin_datos"]
    type: Literal["propiedades", "hipotecaria", "energia", "otro"]
    notes: list[str] = Field(
        default_factory=list,
        description=(
            "Motivo de cada cifra en s/d de este renglón, en español y sin el símbolo; vacía si no falta"
            " nada. meta.notes conserva los mismos avisos por FIBRA con su clave"
        ),
    )


class FibrasRate(ContractModel):
    """La tasa de referencia del diferencial, con su procedencia (``cetes28`` es solo el número)."""

    value: Fraction = Field(description="El mismo número que cetes28")
    asOf: IsoDate | None = Field(description="Fecha del dato de la tasa; meta.asOf es la de los precios")
    source: Literal["banxico", "fred"] | None = Field(
        description="banxico = CETES del SIE; fred = serie interbancaria de la OCDE en FRED (respaldo); null si el servidor no lo dijo"
    )
    fallback: bool = Field(description="true si no son CETES de Banxico: la tasa es sustituta y hay que decirlo")
    tenorDays: int | None = Field(
        ge=1, description="Plazo en días de la serie que de verdad se usó (91 con el respaldo de FRED), no el pedido"
    )


class FibrasResponse(ContractModel):
    rows: list[FibraRow]
    cetes28: Fraction | None
    rate: FibrasRate | None = Field(
        default=None,
        description=(
            "cetes28 con su fecha, fuente, si es sustituta y su plazo. null si no hay tasa (el diferencial va en"
            " s/d) o si el API es anterior a la fase 3"
        ),
    )
    meta: Meta


class InsiderTransaction(ContractModel):
    date: IsoDate | None
    insider: str
    role: str | None
    type: Literal["compra", "venta", "otorgamiento", "ejercicio", "otro"]
    shares: float | None
    value: Money | None
    planned10b5_1: bool | None


class InsiderSummary(ContractModel):
    openMarketBuys: int = Field(ge=0)
    openMarketSells: int = Field(ge=0)


class InsidersResponse(ContractModel):
    items: list[InsiderTransaction]
    summary: InsiderSummary
    meta: Meta


# ─── fase 5: piezas comunes ──────────────────────────────────────────────────


class DatedSeries(ContractModel):
    """Serie por fecha: ``dates`` y ``values`` con la misma longitud; un hueco va como null."""

    dates: list[IsoDate]
    values: list[float | None]

    @model_validator(mode="after")
    def _lengths(self) -> DatedSeries:
        _same_length("serie", self.dates, values=self.values)
        return self


class PeriodChanges(ContractModel):
    """Cambios como fracción en día, semana, mes, año corrido y 12 meses; null si no hay base."""

    d1: Fraction | None
    w1: Fraction | None
    m1: Fraction | None
    ytd: Fraction | None
    y1: Fraction | None


# ─── fase 5: centro de tasas (V5TS) ──────────────────────────────────────────

CurveInstrument = Literal["cetes", "bonoM", "udibono", "ust"]
CurveCompare = Literal["1w", "1m", "1y"]


class CurveNode(ContractModel):
    """Un plazo de la curva. En México cada plazo cambia solo en su subasta: por eso trae su fecha."""

    tenorDays: int = Field(ge=1, description="Plazo en días al vencimiento")
    label: str = Field(description="Plazo legible: '28 días', '10 años'")
    value: Fraction | None = Field(description="Rendimiento; null si la fuente no publicó (N/E), la UI dice s/d")
    asOf: IsoDate | None
    seriesId: str
    instrument: CurveInstrument


class CurvePoint(ContractModel):
    tenorDays: int = Field(ge=1)
    value: Fraction | None
    asOf: IsoDate | None


class RealCurveNode(ContractModel):
    tenorDays: int = Field(ge=1)
    value: Fraction | None = Field(description="Rendimiento real (Udibono o curva real del Tesoro)")
    asOf: IsoDate | None
    seriesId: str


class BreakevenNode(ContractModel):
    tenorDays: int = Field(ge=1)
    value: Fraction | None = Field(description="Inflación implícita de Fisher: (1 + nominal)/(1 + real) - 1")
    simpleBp: Bp | None = Field(description="Diferencia simple nominal menos real, en pb")
    nominalAsOf: IsoDate | None
    realAsOf: IsoDate | None
    dateGapDays: int | None = Field(ge=0, description="Días entre la fecha del nominal y la del real")


class CurvesResponse(ContractModel):
    country: Literal["mx", "us"]
    nodes: list[CurveNode]
    compare: dict[CurveCompare, list[CurvePoint]] = Field(description="La curva de hace 1 semana, 1 mes o 1 año, si se pidió")
    real: list[RealCurveNode]
    breakeven: list[BreakevenNode]
    meta: Meta


class CurveSpreadRow(ContractModel):
    tenorYears: int = Field(ge=1)
    mxSeriesId: str
    usSeriesId: str
    mx: Fraction | None
    us: Fraction | None
    spreadBp: Bp | None = Field(description="México menos EE. UU. en pb")
    mxAsOf: IsoDate | None
    usAsOf: IsoDate | None
    dateGapDays: int | None = Field(ge=0)
    asOfMismatch: bool = Field(description="true si dateGapDays > 7: las dos tasas no son del mismo día")


class SpreadHistory(ContractModel):
    dates: list[IsoDate]
    valuesBp: list[float | None] = Field(description="Diferencial a 10 años en pb; null si falta un lado")

    @model_validator(mode="after")
    def _lengths(self) -> SpreadHistory:
        _same_length("curves/spreads.history10y", self.dates, valuesBp=self.valuesBp)
        return self


class CurveSpreadsResponse(ContractModel):
    rows: list[CurveSpreadRow]
    history10y: SpreadHistory
    meta: Meta


MoneyMarketId = Literal["tiie91", "tiie182", "dff", "sofr", "ust1m", "ust3m", "ust6m", "ust1y"]


class MoneyMarketRow(ContractModel):
    id: MoneyMarketId
    label: str
    country: CountryId
    value: Fraction | None
    convention: Literal["act/360 simple", "overnight", "cmt base bono"]
    asOf: IsoDate | None
    change1dBp: Bp | None
    change1wBp: Bp | None
    change1mBp: Bp | None
    seriesId: str
    source: SourceToken
    stale: bool


class MxRateChange(ContractModel):
    """Cambios semanal y mensual de una serie que ya publica /v2/rates/mx (la UI une por id)."""

    id: MxRateId
    change1wBp: Bp | None
    change1mBp: Bp | None


class MoneyMarketResponse(ContractModel):
    """Solo las series que /v2/rates/mx no trae, más los cambios semanal y mensual de las que sí."""

    rows: list[MoneyMarketRow]
    mxChanges: list[MxRateChange]
    meta: Meta


class SurveyItem(ContractModel):
    id: Literal["inflationT", "inflationT1", "gdpT", "fxT", "fxT1"]
    label: str
    year: int | None = Field(description="Año al que se refiere la expectativa")
    mean: float | None = Field(description="Fracción si unit=fraction; pesos por dólar si unit=mxnPerUsd")
    median: float | None = Field(description="null si su serie no está verificada (la UI dice s/d)")
    unit: Literal["fraction", "mxnPerUsd"]
    seriesIdMean: str | None
    seriesIdMedian: str | None
    verified: bool


class ExpectationsSurvey(ContractModel):
    surveyDate: IsoDate | None = Field(description="Fecha del periodo en el SIE, siempre día 01")
    yearT: int | None = Field(description="Año de surveyDate")
    items: list[SurveyItem]

    @model_validator(mode="after")
    def _first_day(self) -> ExpectationsSurvey:
        if self.surveyDate is not None and not self.surveyDate.endswith("-01"):
            raise ValueError("expectations.survey.surveyDate tiene que ser día 01")
        return self


class RealRates(ContractModel):
    cetes28: Fraction | None
    observedInflation: Fraction | None = Field(description="Inflación anual observada (SIE SP30578)")
    exPost: Fraction | None = Field(description="(1 + cetes28)/(1 + observedInflation) - 1")
    expectedInflation: Fraction | None = Field(description="Mediana de la encuesta para el año en curso")
    exAnte: Fraction | None


class MxForward(ContractModel):
    fromDays: int = Field(ge=0)
    toDays: int = Field(ge=1)
    rate: Fraction | None = Field(description="Forward implícito act/360 simple")
    vsTargetBp: Bp | None = Field(description="Contra la tasa objetivo de Banxico, en pb")


class UsForward(ContractModel):
    fromDays: int = Field(ge=0)
    toDays: int = Field(ge=1)
    rate: Fraction | None
    vsDffBp: Bp | None = Field(description="Contra la tasa de fondos federales efectiva, en pb")
    note: str


class ImpliedForwards(ContractModel):
    mx: list[MxForward]
    us: list[UsForward]


class ExpectationsResponse(ContractModel):
    survey: ExpectationsSurvey
    realRates: RealRates
    impliedForwards: ImpliedForwards
    meta: Meta


# ─── fase 5: tipo de cambio (V5FX) ───────────────────────────────────────────


class FxSpot(ContractModel):
    value: float = Field(description="Pesos por dólar")
    asOf: IsoDate
    source: Literal["banxico"] = Field(description="Siempre el FIX de Banxico (SF43718)")


class FxRange52w(ContractModel):
    low: float | None
    high: float | None
    percentile: Fraction | None = Field(description="Fracción de observaciones menores o iguales al actual")


class FxChangesCents(ContractModel):
    """Los mismos cambios que ``PeriodChanges`` pero en centavos de peso."""

    d1: float | None
    w1: float | None
    m1: float | None
    ytd: float | None
    y1: float | None


class RealizedVol(ContractModel):
    """Volatilidad realizada anualizada (raíz de 252) como fracción."""

    d20: Fraction | None
    d60: Fraction | None
    d250: Fraction | None


class FxMonthly(ContractModel):
    month: YearMonth
    average: float | None
    min: float | None
    max: float | None
    last: float | None


class HistogramBin(ContractModel):
    low: Fraction
    high: Fraction
    count: int = Field(ge=0)


class CotPosition(ContractModel):
    """Posicionamiento CFTC del peso en CME (contrato 095741), en contratos."""

    reportDate: IsoDate
    openInterest: float | None
    nonCommercialNet: float | None
    nonCommercialNetChange: float | None
    leveragedNet: float | None
    assetManagerNet: float | None


class FxMonitorResponse(ContractModel):
    pair: Literal["USDMXN"]
    spot: FxSpot
    range52w: FxRange52w
    changes: PeriodChanges
    changesCents: FxChangesCents
    realizedVol: RealizedVol
    monthly: list[FxMonthly]
    histogram: list[HistogramBin]
    series: DatedSeries
    cot: CotPosition | None
    meta: Meta


CrossPair = Literal[
    "EURMXN", "JPYMXN", "GBPMXN", "CNYMXN", "CADMXN", "BRLMXN", "COPMXN", "CLPMXN", "ARSMXN", "PENMXN"
]


class FxCrossRow(ContractModel):
    pair: CrossPair
    value: float | None = Field(description="Pesos por unidad de la otra moneda")
    asOf: IsoDate | None
    change1d: Fraction | None
    change1y: Fraction | None
    source: Literal["banxico", "frankfurter"]
    provider: Literal["banxico", "ecb", "mezcla"] = Field(description="Quién publica el dato: Banxico, el BCE o una mezcla de bancos centrales")
    fallback: bool


class FxCrossesResponse(ContractModel):
    rows: list[FxCrossRow]
    meta: Meta


FixRule = Literal["fecha", "dof"]


class FixLookupResponse(ContractModel):
    date: IsoDate = Field(description="La fecha pedida")
    rule: FixRule
    fixDate: IsoDate | None = Field(description="Fecha en que se determinó el FIX usado; null si aún no hay FIX")
    value: float | None
    dofPublicationDate: IsoDate | None = Field(description="Solo con rule=dof: fecha del DOF que lo publicó")
    explanation: str = Field(description="Qué FIX se usó y por qué, en español")
    meta: Meta


class FixRow(ContractModel):
    date: IsoDate
    fixDate: IsoDate | None
    value: float | None


class FixMonthEnd(ContractModel):
    month: YearMonth
    fixDate: IsoDate | None
    value: float | None
    average: float | None = Field(description="Promedio del FIX del mes")


class FixTableResponse(ContractModel):
    rule: FixRule
    rows: list[FixRow]
    monthEnds: list[FixMonthEnd]
    meta: Meta


class ForwardSpot(ContractModel):
    value: float
    asOf: IsoDate


class ForwardRow(ContractModel):
    days: int = Field(ge=1, le=365)
    date: IsoDate
    iMxn: Fraction | None
    iUsd: Fraction | None
    iMxnSeries: str
    iUsdSeries: str
    iMxnConvention: Literal["act/360 simple", "overnight plano"]
    iUsdConvention: Literal["cmt convertida x360/365", "overnight plano"]
    forward: float | None = Field(description="Precio teórico por paridad de tasas, sin margen bancario")
    pointsPips: float | None
    carryAnnual: Fraction | None = Field(description="(forward/spot - 1) x 360/días")


class FxForwardResponse(ContractModel):
    spot: ForwardSpot
    rows: list[ForwardRow]
    meta: Meta


# ─── fase 5: calendario y tablero de economía (V5EC) ─────────────────────────


class EconomicEvent(ContractModel):
    id: str
    country: CountryId
    kind: Literal["decision", "minutes", "release", "report"]
    title: str
    period: str | None = Field(description="Periodo que reporta: 'sep 2026'")
    date: IsoDate
    timeLocal: str | None = Field(pattern=r"^\d{2}:\d{2}$", description="HH:MM en America/Mexico_City")
    datetimeUtc: Instant | None
    source: Literal["curated", "bls"]
    seriesId: str | None
    unit: Literal["fraction", "index", "thousandsPersons"] | None
    previous: float | None
    actual: float | None
    consensus: None = Field(description="Siempre null: las fuentes de consenso son de pago")


class CalendarCoverage(ContractModel):
    """Hasta qué fecha cubre cada calendario; nada se inventa después de ella."""

    banxicoUntil: IsoDate | None
    fomcUntil: IsoDate | None
    inegiUntil: IsoDate | None
    blsUntil: IsoDate | None


class NextDecision(ContractModel):
    date: IsoDate
    daysLeft: int = Field(ge=0)


class NextDecisions(ContractModel):
    banxico: NextDecision | None
    fed: NextDecision | None


class EconomicCalendarResponse(ContractModel):
    events: list[EconomicEvent]
    coverage: CalendarCoverage
    nextDecisions: NextDecisions
    meta: Meta


MacroIndicatorId = Literal[
    "inflation",
    "coreInflation",
    "pceCore",
    "unemployment",
    "payrolls",
    "gdpReal",
    "gdpGrowth",
    "remittances",
    "reserves",
    "wti",
]
MacroUnit = Literal[
    "fraction",
    "index",
    "thousandsPersons",
    "usdMillions",
    "mxnMillions2018",
    "usdBillionsChained2017",
    "usdPerBarrel",
]


class MacroObservation(ContractModel):
    date: IsoDate
    value: float


class MacroIndicator(ContractModel):
    """Un indicador. ``kind`` rate cambia en pb (``changeYoYBp``); level cambia en fracción (``changeYoY``)."""

    id: MacroIndicatorId
    label: str
    kind: Literal["rate", "level"]
    unit: MacroUnit
    frequency: Literal["monthly", "quarterly", "weekly", "daily"]
    last: MacroObservation | None
    previous: MacroObservation | None
    changeYoY: Fraction | None = Field(description="Solo kind level: cambio anual como fracción")
    changeYoYBp: Bp | None = Field(description="Solo kind rate: cambio anual en pb")
    history: DatedSeries
    seriesId: str
    source: SourceToken
    fallback: bool
    stale: bool
    nextRelease: IsoDate | None

    @model_validator(mode="after")
    def _change_by_kind(self) -> MacroIndicator:
        if self.kind == "rate" and self.changeYoY is not None:
            raise ValueError(f"macro.{self.id}: kind rate lleva changeYoYBp, no changeYoY")
        if self.kind == "level" and self.changeYoYBp is not None:
            raise ValueError(f"macro.{self.id}: kind level lleva changeYoY, no changeYoYBp")
        return self


class MacroIndicatorsResponse(ContractModel):
    country: Literal["mx", "us"]
    indicators: list[MacroIndicator]
    meta: Meta


class MacroWorldRow(ContractModel):
    country: str = Field(pattern=r"^[A-Z]{3}$", description="ISO 3166-1 alfa-3 (MEX, USA, BRA)")
    name: str
    indicator: Literal["gdpUsd", "gdpGrowth", "inflation", "debt"]
    unit: Literal["usd", "fraction"]
    year: int | None
    value: float | None


class MacroWorldResponse(ContractModel):
    rows: list[MacroWorldRow]
    meta: Meta


# ─── fase 5: temporada de reportes (V5PF) ────────────────────────────────────


class SeasonEvent(ContractModel):
    symbol: Symbol
    name: str | None
    date: IsoDate
    kind: Literal["earnings"]
    estimateAvg: float | None
    estimateLow: float | None
    estimateHigh: float | None
    currency: Currency | None


class EventsSeasonResponse(ContractModel):
    universe: Literal["mx", "us"]
    events: list[SeasonEvent]
    missing: list[DroppedSymbol] = Field(description="Emisoras de la muestra que no respondieron, con su motivo")
    universeSize: int = Field(ge=0)
    meta: Meta


# ─── fase 5: ficha de la emisora (V5FI) ──────────────────────────────────────

EstimatePeriod = Literal["0q", "+1q", "0y", "+1y"]


class EarningsQuarter(ContractModel):
    quarterEnd: IsoDate
    reportDate: IsoDate | None
    epsActual: float | None
    epsEstimate: float | None
    surprise: Fraction | None = Field(description="(real - estimado)/|estimado|")
    reactionNextDay: Fraction | None = Field(description="Cierre del día hábil siguiente contra el previo al reporte")


class EarningsEstimate(ContractModel):
    period: EstimatePeriod
    epsAvg: float | None
    epsLow: float | None
    epsHigh: float | None
    analysts: int | None = Field(ge=0)
    revenueAvg: float | None
    growth: Fraction | None


class EpsTrend(ContractModel):
    period: EstimatePeriod
    current: float | None
    d7: float | None
    d30: float | None
    d60: float | None
    d90: float | None


class EpsRevisions(ContractModel):
    period: EstimatePeriod
    up7: int | None = Field(ge=0)
    down7: int | None = Field(ge=0)
    up30: int | None = Field(ge=0)
    down30: int | None = Field(ge=0)


class NextReport(ContractModel):
    date: IsoDate
    epsAvg: float | None
    analysts: int | None = Field(ge=0)


class EarningsResponse(ContractModel):
    """Resultados contra estimado. Sin precios objetivo ni calificaciones de analistas."""

    symbol: Symbol
    currency: Currency | None
    history: list[EarningsQuarter]
    estimates: list[EarningsEstimate]
    trend: list[EpsTrend]
    revisions: list[EpsRevisions]
    nextReport: NextReport | None
    meta: Meta


class Holder(ContractModel):
    holder: str
    pct: Fraction | None
    shares: float | None
    value: Money | None
    currency: Currency | None
    dateReported: IsoDate | None
    pctChange: Fraction | None


class HoldersResponse(ContractModel):
    insidersPct: Fraction | None
    institutionsPct: Fraction | None
    institutionsFloatPct: Fraction | None
    institutionsCount: int | None = Field(ge=0)
    institutions: list[Holder]
    funds: list[Holder]
    coverageNote: str | None = Field(description="Qué cuenta y qué no la tenencia (p. ej. emisoras de la BMV)")
    meta: Meta


class SplitEvent(ContractModel):
    date: IsoDate
    ratio: float = Field(gt=0, description="Acciones nuevas por cada vieja: 4.0 es un split de 4 a 1")


class SharesResponse(ContractModel):
    symbol: Symbol
    sharesOutstanding: DatedSeries
    change: Fraction | None = Field(description="Último contra primero de la serie")
    splits: list[SplitEvent]
    meta: Meta


class FilingItem(ContractModel):
    code: str = Field(description="Código del evento del 8-K, por ejemplo 2.02")
    label: str = Field(description="Su nombre en español; s/d si el código no se conoce")


class Filing(ContractModel):
    form: str
    formLabel: str = Field(description="Qué es ese documento, en español")
    filedAt: IsoDate
    reportDate: IsoDate | None
    items: list[FilingItem]
    url: HttpsUrl


class FilingsResponse(ContractModel):
    symbol: Symbol
    cik: str = Field(pattern=r"^\d{10}$", description="CIK de la SEC con 10 dígitos")
    viaAdr: str | None = Field(description="Ticker del ADR por el que se encontró a la emisora mexicana")
    filings: list[Filing]
    meta: Meta


# ─── fase 5: gráfica técnica (V5TC) ──────────────────────────────────────────


class OhlcBar(ContractModel):
    """Una vela. ``t`` es fecha en 1d, 1wk y 1mo, e instante con zona en 5m y 1h."""

    t: DateOrInstant
    o: float
    h: float
    l: float  # noqa: E741 - nombre del contrato
    c: float
    v: float | None = Field(description="Volumen; null si la fuente no lo trae (índices)")


class OhlcPoint(ContractModel):
    t: DateOrInstant
    c: float


class OhlcCompare(ContractModel):
    symbol: Literal["^MXX", "^GSPC", "SPY"]
    points: list[OhlcPoint]


class OhlcResponse(ContractModel):
    """Velas ajustadas solo por splits (como ``PanelResponse`` con adjustment=splits)."""

    symbol: Symbol
    currency: Currency | None
    interval: OhlcInterval
    timezone: str | None = Field(description="Zona de la bolsa, por ejemplo America/Mexico_City")
    adjustment: Literal["splits"] = Field(description="Siempre splits: las velas no se ajustan por dividendos")
    bars: list[OhlcBar]
    compare: OhlcCompare | None
    high52w: float | None
    low52w: float | None
    meta: Meta

    @model_validator(mode="after")
    def _t_by_interval(self) -> OhlcResponse:
        intraday = self.interval in OHLC_INTRADAY
        pattern = INSTANT_PATTERN if intraday else ISO_DATE_PATTERN
        stamps = [bar.t for bar in self.bars] + ([p.t for p in self.compare.points] if self.compare else [])
        bad = [t for t in stamps if not re.fullmatch(pattern, t)]
        if bad:
            what = "instante con zona" if intraday else "fecha YYYY-MM-DD"
            raise ValueError(f"ohlc {self.interval}: t tiene que ser {what}: {bad[:3]}")
        return self


# ─── fase 5: movimientos, amplitud y sectores (V5MK) ─────────────────────────

MarketId = Literal["us", "mx"]


class MoverRow(ContractModel):
    symbol: Symbol
    name: str | None
    price: Money | None
    currency: Currency | None
    change: Money | None
    changePct: Fraction | None
    volume: float | None
    avgVolume3m: float | None
    relVolume: float | None = Field(description="Volumen del día entre el promedio de 3 meses")
    marketCap: Money | None
    high52w: Money | None
    low52w: Money | None
    note: str | None = Field(description="Aviso descriptivo, por ejemplo un cambio atípico")


class MoversResponse(ContractModel):
    market: MarketId
    kind: Literal["gainers", "losers", "active"]
    rows: list[MoverRow]
    excluded: list[ExcludedSymbol]
    meta: Meta


class BreadthResponse(ContractModel):
    """Amplitud de una muestra curada de emisoras, no de todo el mercado."""

    market: MarketId
    universe: Literal["curado"]
    universeSize: int = Field(ge=0)
    up: int = Field(ge=0)
    down: int = Field(ge=0)
    unchanged: int = Field(ge=0)
    upDownRatio: float | None
    pctAbove200d: Fraction | None
    newHighs52w: int = Field(ge=0)
    newLows52w: int = Field(ge=0)
    meta: Meta


class SectorMember(ContractModel):
    symbol: Symbol
    name: str | None
    changes: PeriodChanges


class SectorRow(ContractModel):
    sector: str = Field(description="Nombre del sector en español")
    etf: Symbol | None = Field(description="ETF sectorial SPDR en EE. UU.; null en México")
    changes: PeriodChanges
    members: list[SectorMember] | None = Field(description="En México, las emisoras que promedia el sector")


class SectorsResponse(ContractModel):
    market: MarketId
    rows: list[SectorRow]
    meta: Meta


# ─── fase 5: ETF por dentro (V5PF) ───────────────────────────────────────────


class FundAssetClasses(ContractModel):
    stock: Fraction | None
    bond: Fraction | None
    cash: Fraction | None
    other: Fraction | None


class FundSector(ContractModel):
    sector: str = Field(description="Sector en español")
    weight: Fraction


class FundHolding(ContractModel):
    symbol: str | None
    name: str | None
    weight: Fraction


class FundCoverage(ContractModel):
    topHoldingsWeight: Fraction | None = Field(description="Cuánto del fondo suman las posiciones publicadas")


class FundResponse(ContractModel):
    symbol: Symbol
    mappedFrom: str | None = Field(description="Clave del SIC que se mapeó a este fondo (IVVPESO.MX a IVV)")
    name: str | None
    family: str | None
    category: str | None
    legalType: str | None
    expenseRatio: Fraction | None
    totalNetAssets: float | None
    totalNetAssetsUnit: Literal["usdMillions"] | None
    turnover: Fraction | None
    assetClasses: FundAssetClasses
    sectors: list[FundSector]
    topHoldings: list[FundHolding]
    coverage: FundCoverage
    meta: Meta


# ─── fase 5: empresas (V5EM) ─────────────────────────────────────────────────


class UmaValue(ContractModel):
    year: int
    daily: Money
    monthly: Money
    annual: Money
    validFrom: IsoDate
    sourceUrl: HttpUrl


class MinimumWage(ContractModel):
    year: int
    general: Money
    border: Money = Field(description="Zona Libre de la Frontera Norte")
    validFrom: IsoDate
    sourceUrl: HttpUrl


class SurchargeRate(ContractModel):
    year: int
    rate: Fraction = Field(description="Tasa mensual de recargos")
    law: str = Field(description="Ley de Ingresos que la fija")
    sourceUrl: HttpUrl


class UdiValue(ContractModel):
    value: float
    asOf: IsoDate


class ReferenceMxResponse(ContractModel):
    uma: list[UmaValue]
    minimumWage: list[MinimumWage]
    surchargeMonthly: list[SurchargeRate]
    udi: UdiValue | None
    meta: Meta


class InpcPoint(ContractModel):
    month: YearMonth
    value: float


class UpdateFactorResponse(ContractModel):
    inpcFrom: InpcPoint
    inpcTo: InpcPoint
    factorRaw: float = Field(description="INPC final entre INPC inicial, sin truncar")
    factor: float = Field(ge=1, description="Truncado al diezmilésimo y nunca menor a 1")
    floorApplied: bool = Field(description="true si factorRaw era menor a 1 y se publicó 1")
    meta: Meta


class Industry(ContractModel):
    sector: str | None
    industry: str
    betaU: float | None = Field(description="Beta desapalancada")
    evEbitda: Ratio | None
    roic: Fraction | None
    costOfDebtUsd: Fraction | None
    waccUsd: Fraction | None
    de: Ratio | None = Field(description="Deuda entre capital")


class IndustriesResponse(ContractModel):
    market: Literal["US", "EM"]
    vintage: str = Field(description="Vintage del archivo de Damodaran")
    statutoryTaxRate: dict[CountryId, Fraction]
    industries: list[Industry]
    meta: Meta


class CreditHealthYear(ContractModel):
    fiscalYear: int
    altmanZEm: float | None = Field(description="Z de Altman para emergentes; null si falta un insumo")
    netDebtToEbitda: Ratio | None
    interestCoverage: Ratio | None
    currentRatio: Ratio | None
    quickRatio: Ratio | None
    dso: float | None = Field(description="Días de cobro")
    dpo: float | None = Field(description="Días de pago")


class MissingInput(ContractModel):
    fiscalYear: int
    field: str


class CreditHealthResponse(ContractModel):
    """Razones de salud financiera, sin letras de calificación."""

    symbol: Symbol
    currency: Currency | None
    applicable: bool
    reason: str | None = Field(description="Por qué no aplica (bancos y aseguradoras)")
    years: list[CreditHealthYear]
    inputsMissing: list[MissingInput]
    meta: Meta

    @model_validator(mode="after")
    def _not_applicable_is_empty(self) -> CreditHealthResponse:
        if not self.applicable and (self.years or not self.reason):
            raise ValueError("credit-health: applicable=false lleva reason y years vacío")
        return self


RESPONSE_MODELS: tuple[type[ContractModel], ...] = (
    HealthResponse,
    LoginResponse,
    MeResponse,
    QuotesResponse,
    SearchResponse,
    HistoryResponse,
    PanelResponse,
    FxResponse,
    FxHistoryResponse,
    MxRatesResponse,
    RfSeriesResponse,
    UsMacroResponse,
    MarketsOverviewResponse,
    WorldResponse,
    NewsResponse,
    EventsResponse,
    InstrumentResponse,
    StatementsResponse,
    DividendsResponse,
    ValuationResponse,
    MomentumResponse,
    FactorsResponse,
    MagicResponse,
    FibrasResponse,
    InsidersResponse,
    AssumptionsResponse,
    InpcResponse,
    CurvesResponse,
    CurveSpreadsResponse,
    MoneyMarketResponse,
    ExpectationsResponse,
    FxMonitorResponse,
    FxCrossesResponse,
    FixLookupResponse,
    FixTableResponse,
    FxForwardResponse,
    EconomicCalendarResponse,
    MacroIndicatorsResponse,
    MacroWorldResponse,
    EventsSeasonResponse,
    EarningsResponse,
    HoldersResponse,
    SharesResponse,
    FilingsResponse,
    OhlcResponse,
    MoversResponse,
    BreadthResponse,
    SectorsResponse,
    FundResponse,
    ReferenceMxResponse,
    UpdateFactorResponse,
    IndustriesResponse,
    CreditHealthResponse,
)
"""Un modelo por endpoint v2 (además de ErrorBody y Meta)."""
