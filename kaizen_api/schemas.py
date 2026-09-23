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
Money = Annotated[float, Field(description="Monto en la moneda del campo currency más cercano")]
Ratio = Annotated[float, Field(description="Razón simple (múltiplo), no porcentaje")]

InstrumentType = Literal["equity", "etf", "fibra", "index", "fx", "crypto", "commodity", "fund"]
Range = Literal["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"]
Interval = Literal["1d", "1wk", "1mo"]
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
]

KNOWN_CAPABILITIES = (
    "auth",
    "legacy.v1",
    "quotes",
    "search",
    "history",
    "history.dates",
    "panel",
    "fx",
    "fx.fix",
    "fx.history",
    "rates.mx",
    "rf.series",
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
        description="Sector de Yahoo en español de México (el mismo que usan los screeners); null si Yahoo no lo trae",
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
    seriesId: str = Field(description="Id de la serie en el SIE de Banxico (p. ej. SF61745)")
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


class EventsResponse(ContractModel):
    items: list[EventItem]
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


class FibrasResponse(ContractModel):
    rows: list[FibraRow]
    cetes28: Fraction | None
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
)
"""Un modelo por endpoint v2 (además de ErrorBody y Meta)."""
