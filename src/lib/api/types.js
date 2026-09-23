// Tipos JSDoc del contrato del API v2 (docs/api-v2.md). Solo tipos: este módulo no exporta
// valores en tiempo de ejecución. Uso desde otro archivo:
//
//   /** @typedef {import('../lib/api/types.js').QuotesResponse} QuotesResponse */
//
// Convenciones del contrato: tasas, rendimientos, pesos y probabilidades son FRACCIONES
// (0.0123 = 1.23 %); múltiplos son razones simples; cambios de tasa en puntos base en campos
// que terminan en `Bp`; montos en la moneda del `currency` más cercano; fechas ISO YYYY-MM-DD.

/**
 * Procedencia de cada respuesta exitosa.
 * @typedef {{
 *   asOf: string | null,
 *   source: string,
 *   delayMinutes: number | null,
 *   stale: boolean,
 *   fallback: boolean,
 *   generatedAt: string,
 *   notes: string[],
 * }} Meta
 */

/**
 * @typedef {{ error: { code: string, message: string, details?: Record<string, unknown> } }} ErrorEnvelope
 */

// ─── Plataforma ─────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   status: 'ok',
 *   apiVersion: number,
 *   version: string,
 *   commit: string | null,
 *   authRequired: boolean,
 *   capabilities: string[],
 *   providers: {
 *     yahoo: { ok: boolean | null },
 *     banxico: { configured: boolean },
 *     fred: { configured: boolean },
 *     sec: { ok: boolean | null },
 *     eodhd: { configured: boolean },
 *   },
 *   serverTime: string,
 * }} HealthResponse
 */

/** @typedef {{ username: string, displayName: string }} User */
/** @typedef {{ token: string, expiresAt: string, user: User }} LoginResponse */
/** @typedef {{ user: User, expiresAt: string }} MeResponse */

// ─── Datos de mercado ───────────────────────────────────────────────────────

/**
 * `sector` viene en español de México ("Tecnología", "Consumo básico"); `industry` viene en inglés,
 * tal como la publica Yahoo. Los dos son null en índices, fondos, ETF, divisas y cripto, y no
 * existen en un API anterior a la fase 3 ni en el adaptador del API viejo: trátalos como "s/d".
 * @typedef {{
 *   symbol: string, name: string, price: number | null, previousClose: number | null,
 *   change: number | null, changePct: number | null, currency: string, exchange: string,
 *   type: string, marketState: string | null, asOf: string | null,
 *   sector?: string | null, industry?: string | null,
 * }} Quote
 */
/** @typedef {{ quotes: Quote[], missing: string[], meta: Meta }} QuotesResponse */

/**
 * @typedef {'equity' | 'etf' | 'fibra' | 'index' | 'fx' | 'crypto' | 'commodity' | 'fund'} InstrumentType
 * @typedef {{ symbol: string, name: string, exchange: string, type: InstrumentType, currency: string, aliases: string[] }} SearchResult
 * @typedef {{ results: SearchResult[], meta: Meta }} SearchResponse
 */

/**
 * @typedef {'1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | '10y' | 'max'} Range
 * @typedef {'1d' | '1wk' | '1mo'} Interval
 * @typedef {'native' | 'MXN' | 'USD'} CurrencyMode
 */

/**
 * `dates` es null solo en el adaptador del API viejo (sin fechas por punto).
 * @typedef {{
 *   symbol: string, currency: string, interval: Interval, adjusted: boolean,
 *   dates: string[] | null, close: number[],
 *   fx: { pair: 'USDMXN', source: string } | null, meta: Meta,
 * }} HistoryResponse
 */

/**
 * @typedef {{
 *   currency: string, interval: Interval, dates: string[],
 *   prices: Record<string, number[]>, dropped: { symbol: string, reason: string }[], meta: Meta,
 * }} PanelResponse
 */

/** @typedef {{ pair: string, rate: number, asOf: string | null, source: 'banxico_fix' | 'yahoo', stale: boolean, meta: Meta }} FxResponse */
/** @typedef {{ pair: string, dates: string[], values: number[], source: string, meta: Meta }} FxHistoryResponse */

// ─── Tasas y macro ──────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   id: string, label: string, value: number | null, unit: 'fraction' | 'index' | 'mxn',
 *   asOf: string | null, seriesId: string, source: string, previous: number | null, changeBp: number | null,
 * }} RateItem
 * @typedef {{ items: RateItem[], meta: Meta }} RatesMxResponse
 */

/**
 * @typedef {{
 *   tenorDays: number, convention: 'simple_act360', dates: string[], values: number[],
 *   source: string, fallback: boolean, meta: Meta,
 * }} RiskFreeResponse
 * `source` es "banxico" o "fred_ir3tib" en el v2; el adaptador del API viejo usa
 * "legacy_bono_m_10y" para no disfrazar el Bono M 10Y de CETES.
 */

/**
 * @typedef {{
 *   id: 'ust3m' | 'ust2y' | 'ust10y' | 'spread10y2y' | 'spread10y3m' | 'vix' | 'dxy' | 'fedFunds',
 *   label: string, value: number | null, previous: number | null, change: number | null,
 *   changeBp: number | null, unit: 'fraction' | 'bp' | 'index', asOf: string | null, source: string,
 * }} MacroItem
 * @typedef {{ items: MacroItem[], meta: Meta }} MacroUsResponse
 */

// ─── Mercados y noticias ────────────────────────────────────────────────────

/**
 * @typedef {{ symbol: string, label: string, price: number | null, change: number | null, changePct: number | null, currency: string, asOf: string | null }} OverviewItem
 * @typedef {{ id: 'mx' | 'us' | 'global' | 'fx' | 'commodities' | 'crypto', label: string, items: OverviewItem[] }} OverviewGroup
 * @typedef {{ open: boolean, label: string, nextOpen: string | null, nextClose: string | null }} MarketStatus
 * @typedef {{ groups: OverviewGroup[], marketStatus: { bmv: MarketStatus, nyse: MarketStatus }, meta: Meta }} MarketsOverviewResponse
 */

/**
 * @typedef {{ country: string, symbol: string, label: string, changePct: number | null, currency: 'USD', asOf: string | null }} WorldItem
 * @typedef {{ items: WorldItem[], method: string, meta: Meta }} MarketsWorldResponse
 */

/**
 * @typedef {{ label: 'positivo' | 'negativo' | 'neutral', score: number, method: 'heuristic' }} Tone
 * @typedef {{
 *   id: string, title: string, url: string, source: string, publishedAt: string | null,
 *   summary: string | null, lang: string, tone: Tone | null,
 * }} NewsItem
 * @typedef {{ items: NewsItem[], meta: Meta }} NewsResponse
 */

/**
 * @typedef {{
 *   symbol: string, type: 'earnings' | 'exDividend' | 'dividendPay', date: string,
 *   estimate: number | null, amount: number | null, currency: string | null,
 * }} EventItem
 * @typedef {{ items: EventItem[], meta: Meta }} EventsResponse
 */

// ─── Investigación ──────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   pe: number | null, forwardPe: number | null, pb: number | null, ps: number | null,
 *   evEbitda: number | null, pfcf: number | null, earningsYield: number | null, fcfYield: number | null,
 *   dividendYield: number | null, payoutRatio: number | null, roe: number | null, roa: number | null,
 *   grossMargin: number | null, operatingMargin: number | null, netMargin: number | null,
 *   revenueGrowthYoY: number | null, epsGrowthYoY: number | null, debtToEquity: number | null,
 *   netDebtToEbitda: number | null, currentRatio: number | null, enterpriseValue: number | null,
 *   sharesOutstanding: number | null,
 * }} Fundamentals
 */

/**
 * @typedef {{
 *   symbol: string, name: string, exchange: string, type: string, sector: string | null,
 *   industry: string | null, country: string | null, description: string | null, website: string | null,
 *   priceCurrency: string, financialCurrency: string,
 *   fxUsed: { pair: string, rate: number, asOf: string | null } | null,
 *   quote: {
 *     price: number | null, previousClose: number | null, change: number | null, changePct: number | null,
 *     dayLow: number | null, dayHigh: number | null, low52w: number | null, high52w: number | null,
 *     volume: number | null, avgVolume: number | null, marketCap: number | null, asOf: string | null,
 *   },
 *   fundamentals: Fundamentals,
 *   beta: { value: number, adjusted: number, benchmark: string, currency: string, window: string, observations: number, source: 'computed' | 'yahoo' } | null,
 *   sectorMedians: Partial<Fundamentals> | null,
 *   coverage: { available: number, total: number },
 *   meta: Meta,
 * }} InstrumentResponse
 */

/**
 * @typedef {{ end: string, fiscalYear: number, fiscalQuarter: number | null, form: string | null }} StatementPeriod
 * @typedef {{ id: string, label: string, values: (number | null)[] }} StatementRow
 * @typedef {{
 *   symbol: string, currency: string, freq: 'annual' | 'quarterly', source: 'sec' | 'yahoo',
 *   periods: StatementPeriod[], rows: StatementRow[], meta: Meta,
 * }} StatementsResponse
 */

/** @typedef {{ symbol: string, currency: string, ttm: number | null, yield: number | null, history: { date: string, amount: number }[], meta: Meta }} DividendsResponse */

/**
 * @typedef {{
 *   symbol: string, currency: string,
 *   assumptions: { rf: number, erp: number, crp: number, lambda: number, taxRate: number, terminalGrowth: number, source: string, asOf: string | null },
 *   multiples: {
 *     applicable: boolean, reason: string | null, market: 'US' | 'EM', source: string, asOf: string | null,
 *     methods: { id: 'pe' | 'pb' | 'evEbitda' | 'pfcf', label: string, current: number | null, benchmark: number | null, impliedPrice: number | null, applicable: boolean }[],
 *     fairValueRange: { low: number, mid: number, high: number } | null,
 *   },
 *   dcf: {
 *     applicable: boolean, reason: string | null,
 *     inputs: Record<string, number | string | null>,
 *     projection: { year: number, fcff: number, discountFactor: number, pv: number }[],
 *     terminalValue: number | null, pvTerminal: number | null, tvShare: number | null,
 *     enterpriseValue: number | null, netDebt: number | null, minorityInterest: number | null,
 *     equityValue: number | null, sharesOutstanding: number | null, perShare: number | null,
 *     sensitivity: { waccs: number[], growths: number[], grid: (number | null)[][] },
 *     warnings: string[],
 *   },
 *   bank: { applicable: boolean, justifiedPB: number | null, roe: number | null, costOfEquity: number | null, growth: number | null, impliedPrice: number | null } | null,
 *   meta: Meta,
 * }} ValuationResponse
 */

/**
 * @typedef {{
 *   symbol: string, currency: string, benchmark: string, r12m1: number | null, r6m: number | null,
 *   r3m: number | null, benchmarkR12m1: number | null, relative12m1: number | null, meta: Meta,
 * }} MomentumResponse
 */

// ─── Screeners ──────────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, label: string, pass: boolean | null, value: number | null, threshold: number | null }} ScreenCheck
 * @typedef {{
 *   symbol: string, name: string, sector: string | null,
 *   scores: { value: number, quality: number, momentum: number, lowVol: number, growth: number, composite: number } | null,
 *   coverage: number, excluded: boolean, reason: string | null, checks: ScreenCheck[], metrics: Record<string, number | null>,
 * }} FactorRow
 * @typedef {{ universe: { id: string, name: string, size: number }, method: string, rows: FactorRow[], meta: Meta }} FactorScreenerResponse
 */

/**
 * @typedef {{
 *   symbol: string, name: string, sector: string | null, ebit: number, enterpriseValue: number,
 *   earningsYield: number, returnOnCapital: number, rankEY: number, rankROC: number, rank: number,
 *   currency: string, fiscalPeriodEnd: string | null,
 * }} MagicRow
 * @typedef {{
 *   universe: { id: string, name: string, size: number, description: string },
 *   rows: MagicRow[], excluded: { symbol: string, reason: string }[], partial: boolean, meta: Meta,
 * }} MagicScreenerResponse
 */

/**
 * @typedef {{
 *   symbol: string, name: string, price: number | null, currency: string, financialCurrency: string,
 *   marketCap: number | null, distributionYield: number | null, capRate: number | null,
 *   navPerCbfi: number | null, pNav: number | null, ltv: number | null, debtToMarketCap: number | null,
 *   cashFlowYield: number | null, cashFlowBasis: 'ffo_approx' | 'ocf' | 'fcf' | null,
 *   spreadVsCetes: number | null, signal: 'descuento' | 'en_linea' | 'prima' | 'sin_datos',
 *   type: 'propiedades' | 'hipotecaria' | 'energia' | 'otro',
 * }} FibraRow
 * @typedef {{ rows: FibraRow[], cetes28: number | null, meta: Meta }} FibrasScreenerResponse
 */

/**
 * @typedef {{
 *   date: string, insider: string, role: string | null,
 *   type: 'compra' | 'venta' | 'otorgamiento' | 'ejercicio' | 'otro',
 *   shares: number | null, value: number | null, planned10b5_1: boolean | null,
 * }} InsiderItem
 * @typedef {{ items: InsiderItem[], summary: { openMarketBuys: number, openMarketSells: number }, meta: Meta }} InsidersResponse
 */

export {}
