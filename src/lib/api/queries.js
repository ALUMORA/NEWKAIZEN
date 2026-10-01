// Llaves y opciones de TanStack Query por clase de dato. Las features no arman queryKey a mano:
//
//   import { useQuery } from '@tanstack/react-query'
//   import { quotesQuery, historyQuery } from '../../lib/api/queries.js'
//   const quotes = useQuery(quotesQuery(['AAPL', 'WALMEX.MX']))
//   const hist = useQuery(historyQuery('NAFTRAC.MX', { range: '5y', interval: '1wk', ccy: 'MXN' }))
//
// Frescura (staleTime) según qué tan rápido cambia el dato en la fuente:
//   cotizaciones 30 s (y se refrescan cada 60 s solo con la pestaña visible), historia 1 h,
//   emisora y fundamentales 6 h, macro y tasas 1 h, noticias 10 min, screeners 12 h,
//   búsqueda 24 h. Fase 5: curvas 1 h, velas intradía 1 min (movimientos, amplitud y sectores con
//   las cotizaciones) y referencias y calendarios curados 24 h, igual que http_cache del API.
// Reintentos: apiFetch ya reintenta el arranque en frío (~67 s), así que aquí NO se vuelve a
// reintentar eso ni los errores de red; a lo más uno más para un 5xx del API despierto, y nunca
// para 4xx ni cancelaciones.
import { QueryClient } from '@tanstack/react-query'
import { ApiError, isAbortError, isColdStartError } from './http.js'
import * as api from './endpoints.js'

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

export const STALE_TIME = Object.freeze({
  quotes: 30 * SECOND,
  history: HOUR,
  panel: HOUR,
  instrument: 6 * HOUR,
  fundamentals: 6 * HOUR,
  macro: HOUR,
  rates: HOUR,
  fx: 5 * MINUTE,
  news: 10 * MINUTE,
  events: 6 * HOUR,
  screeners: 12 * HOUR,
  search: 24 * HOUR,
  // Fase 5
  curves: HOUR,
  intraday: MINUTE,
  reference: 24 * HOUR,
})

export const QUOTES_REFETCH_MS = 60 * SECOND

/**
 * Política de reintento de TanStack. Devuelve false, o sea que el error se muestra de una vez:
 * - cancelaciones (AbortError) y 4xx, incluido LEGACY_SERVER: reintentar no cambia nada;
 * - arranque en frío y errores de red o timeout (status 0): apiFetch ya los reintentó cinco
 *   veces durante ~67 s. Otra vuelta de Query dejaría a la persona ~140 s viendo un spinner
 *   antes del mensaje de error.
 * Queda un reintento solo para lo demás: 5xx del API ya despierto y errores raros.
 * @param {number} failureCount
 * @param {unknown} error
 */
export function shouldRetry(failureCount, error) {
  if (isAbortError(error)) return false
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  if (error instanceof ApiError && error.code === 'LEGACY_SERVER') return false
  if (isColdStartError(error)) return false
  if (error instanceof ApiError && error.status === 0) return false
  return failureCount < 1
}

/** Solo refresca cotizaciones con la pestaña visible. */
function visibleInterval(ms) {
  return () => (typeof document === 'undefined' || document.visibilityState === 'visible' ? ms : false)
}

/** QueryClient con los defaults de la app. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * SECOND,
        gcTime: 30 * MINUTE,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}

/**
 * Parámetros de una llave: sin undefined y con las listas ordenadas y sin repetidos, para que
 * { compare: ['1y', '1w'] } y { compare: ['1w', '1y'] } compartan caché.
 * @param {Record<string, unknown>} params
 */
function normParams(params) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined) continue
    out[k] = Array.isArray(v) ? [...new Set(v.map((x) => (typeof x === 'string' ? x.trim() : x)))].sort() : v
  }
  return out
}

const sortedUpper = (symbols) => [...new Set((symbols ?? []).map((s) => String(s).trim().toUpperCase()))].sort()

/** Llaves de caché. Cada una empieza con la clase de dato para poder invalidar por familia. */
export const queryKeys = {
  all: /** @type {const} */ (['api']),
  health: () => /** @type {const} */ (['api', 'health']),
  me: () => /** @type {const} */ (['api', 'me']),
  quotes: (symbols) => ['api', 'quotes', sortedUpper(symbols)],
  search: (q, limit = 10) => ['api', 'search', String(q ?? '').trim().toLowerCase(), limit],
  history: (symbol, params = {}) => ['api', 'history', String(symbol).toUpperCase(), { range: '1y', interval: '1d', ccy: 'native', ...params }],
  panel: (symbols, params = {}) => ['api', 'panel', sortedUpper(symbols), { range: '5y', interval: '1wk', ccy: 'MXN', ...params }],
  fx: (pair = 'USDMXN') => ['api', 'fx', pair],
  fxHistory: (params = {}) => ['api', 'fxHistory', { pair: 'USDMXN', ...params }],
  ratesMx: () => /** @type {const} */ (['api', 'rates', 'mx']),
  riskFree: (params = {}) => ['api', 'rates', 'rf', { tenorDays: 28, ...params }],
  inpc: (params = {}) => ['api', 'rates', 'inpc', params],
  macroUs: () => /** @type {const} */ (['api', 'macro', 'us']),
  marketsOverview: () => /** @type {const} */ (['api', 'markets', 'overview']),
  marketsWorld: () => /** @type {const} */ (['api', 'markets', 'world']),
  news: (params = {}) => ['api', 'news', { lang: 'all', limit: 30, ...params }],
  events: (symbols) => ['api', 'events', sortedUpper(symbols)],
  instrument: (symbol) => ['api', 'instrument', String(symbol).toUpperCase()],
  statements: (symbol, freq = 'annual') => ['api', 'instrument', String(symbol).toUpperCase(), 'statements', freq],
  dividends: (symbol) => ['api', 'instrument', String(symbol).toUpperCase(), 'dividends'],
  valuation: (symbol, params = {}) => ['api', 'valuation', String(symbol).toUpperCase(), params],
  assumptions: () => /** @type {const} */ (['api', 'assumptions']),
  momentum: (symbol) => ['api', 'momentum', String(symbol).toUpperCase()],
  factorScreener: (params = {}) => ['api', 'screeners', 'factors', { universe: 'mx', ...params }],
  magicScreener: (universe = 'us') => ['api', 'screeners', 'magic', universe],
  fibrasScreener: (extra = []) => ['api', 'screeners', 'fibras', sortedUpper(extra)],
  insiders: (symbol) => ['api', 'insiders', String(symbol).toUpperCase()],
  // Fase 5: una llave por ruta nueva; los parámetros van en un objeto al final.
  curves: (params = {}) => ['api', 'curves', normParams(params)],
  curveSpreads: (params = {}) => ['api', 'curves', 'spreads', normParams(params)],
  moneyMarket: () => /** @type {const} */ (['api', 'rates', 'moneyMarket']),
  expectations: () => /** @type {const} */ (['api', 'rates', 'expectations']),
  fxMonitor: (params = {}) => ['api', 'fxdesk', 'monitor', { years: 1, ...normParams(params) }],
  fxCrosses: () => /** @type {const} */ (['api', 'fxdesk', 'crosses']),
  fix: (params = {}) => ['api', 'fxdesk', 'fix', { rule: 'fecha', ...normParams(params) }],
  fixTable: (params = {}) => ['api', 'fxdesk', 'fixTable', normParams(params)],
  fxForward: (params = {}) => ['api', 'fxdesk', 'forward', normParams(params)],
  economicCalendar: (params = {}) => ['api', 'calendar', 'economic', normParams(params)],
  macroIndicators: (params = {}) => ['api', 'macro', 'indicators', normParams(params)],
  macroWorld: (params = {}) => ['api', 'macro', 'world', normParams(params)],
  eventsSeason: (params = {}) => ['api', 'events', 'season', normParams(params)],
  earnings: (symbol) => ['api', 'earnings', String(symbol).toUpperCase()],
  holders: (symbol) => ['api', 'holders', String(symbol).toUpperCase()],
  shares: (symbol, params = {}) => ['api', 'shares', String(symbol).toUpperCase(), normParams(params)],
  filings: (symbol, params = {}) => ['api', 'filings', String(symbol).toUpperCase(), normParams(params)],
  ohlc: (symbol, params = {}) => ['api', 'ohlc', String(symbol).toUpperCase(), { range: '6mo', interval: '1d', ...normParams(params) }],
  movers: (params = {}) => ['api', 'movers', normParams(params)],
  breadth: (params = {}) => ['api', 'breadth', normParams(params)],
  sectors: (params = {}) => ['api', 'sectors', normParams(params)],
  fund: (symbol) => ['api', 'funds', String(symbol).toUpperCase()],
  referenceMx: () => /** @type {const} */ (['api', 'reference', 'mx']),
  updateFactor: (params = {}) => ['api', 'reference', 'mx', 'updateFactor', normParams(params)],
  industries: (params = {}) => ['api', 'business', 'industries', normParams(params)],
  creditHealth: (symbol, params = {}) => ['api', 'creditHealth', String(symbol).toUpperCase(), normParams(params)],
}

// ─── Opciones por endpoint (para useQuery / prefetchQuery) ──────────────────

export const quotesQuery = (symbols) => ({
  queryKey: queryKeys.quotes(symbols),
  queryFn: ({ signal }) => api.getQuotes(symbols, { signal }),
  staleTime: STALE_TIME.quotes,
  refetchInterval: visibleInterval(QUOTES_REFETCH_MS),
  refetchIntervalInBackground: false,
  enabled: Array.isArray(symbols) && symbols.length > 0,
})

export const searchQuery = (q, limit = 10) => ({
  queryKey: queryKeys.search(q, limit),
  queryFn: ({ signal }) => api.search(q, { limit, signal }),
  staleTime: STALE_TIME.search,
  enabled: String(q ?? '').trim().length > 0,
})

export const historyQuery = (symbol, params = {}) => ({
  queryKey: queryKeys.history(symbol, params),
  queryFn: ({ signal }) => api.getHistory(symbol, params, { signal }),
  staleTime: STALE_TIME.history,
  enabled: Boolean(symbol),
})

export const panelQuery = (symbols, params = {}) => ({
  queryKey: queryKeys.panel(symbols, params),
  queryFn: ({ signal }) => api.getPanel(symbols, params, { signal }),
  staleTime: STALE_TIME.panel,
  enabled: Array.isArray(symbols) && symbols.length > 0,
})

export const fxQuery = (pair = 'USDMXN') => ({
  queryKey: queryKeys.fx(pair),
  queryFn: ({ signal }) => api.getFx(pair, { signal }),
  staleTime: STALE_TIME.fx,
})

export const fxHistoryQuery = (params = {}) => ({
  queryKey: queryKeys.fxHistory(params),
  queryFn: ({ signal }) => api.getFxHistory(params, { signal }),
  staleTime: STALE_TIME.history,
})

export const ratesMxQuery = () => ({
  queryKey: queryKeys.ratesMx(),
  queryFn: ({ signal }) => api.getRatesMx({ signal }),
  staleTime: STALE_TIME.rates,
})

export const riskFreeQuery = (params = {}) => ({
  queryKey: queryKeys.riskFree(params),
  queryFn: ({ signal }) => api.getRiskFree(params, { signal }),
  staleTime: STALE_TIME.rates,
})

/** Serie mensual del INPC. Cambia una vez al mes: se trata como fundamental. */
export const inpcQuery = (params = {}) => ({
  queryKey: queryKeys.inpc(params),
  queryFn: ({ signal }) => api.getInpc(params, { signal }),
  staleTime: STALE_TIME.fundamentals,
})

export const macroUsQuery = () => ({
  queryKey: queryKeys.macroUs(),
  queryFn: ({ signal }) => api.getMacroUs({ signal }),
  staleTime: STALE_TIME.macro,
})

export const marketsOverviewQuery = () => ({
  queryKey: queryKeys.marketsOverview(),
  queryFn: ({ signal }) => api.getMarketsOverview({ signal }),
  staleTime: STALE_TIME.quotes,
  refetchInterval: visibleInterval(QUOTES_REFETCH_MS),
  refetchIntervalInBackground: false,
})

export const marketsWorldQuery = () => ({
  queryKey: queryKeys.marketsWorld(),
  queryFn: ({ signal }) => api.getMarketsWorld({ signal }),
  staleTime: STALE_TIME.macro,
})

export const newsQuery = (params = {}) => ({
  queryKey: queryKeys.news(params),
  queryFn: ({ signal }) => api.getNews(params, { signal }),
  staleTime: STALE_TIME.news,
})

export const eventsQuery = (symbols) => ({
  queryKey: queryKeys.events(symbols),
  queryFn: ({ signal }) => api.getEvents(symbols, { signal }),
  staleTime: STALE_TIME.events,
  enabled: Array.isArray(symbols) && symbols.length > 0,
})

export const instrumentQuery = (symbol) => ({
  queryKey: queryKeys.instrument(symbol),
  queryFn: ({ signal }) => api.getInstrument(symbol, { signal }),
  staleTime: STALE_TIME.instrument,
  enabled: Boolean(symbol),
})

/** @param {string} symbol @param {'annual' | 'quarterly'} [freq] */
export const statementsQuery = (symbol, freq = 'annual') => ({
  queryKey: queryKeys.statements(symbol, freq),
  queryFn: ({ signal }) => api.getStatements(symbol, { freq }, { signal }),
  staleTime: STALE_TIME.fundamentals,
  enabled: Boolean(symbol),
})

export const dividendsQuery = (symbol) => ({
  queryKey: queryKeys.dividends(symbol),
  queryFn: ({ signal }) => api.getDividends(symbol, { signal }),
  staleTime: STALE_TIME.fundamentals,
  enabled: Boolean(symbol),
})

export const valuationQuery = (symbol, params = {}) => ({
  queryKey: queryKeys.valuation(symbol, params),
  queryFn: ({ signal }) => api.getValuation(symbol, params, { signal }),
  staleTime: STALE_TIME.fundamentals,
  enabled: Boolean(symbol),
})

export const assumptionsQuery = () => ({
  queryKey: queryKeys.assumptions(),
  queryFn: ({ signal }) => api.getAssumptions({ signal }),
  staleTime: STALE_TIME.fundamentals,
})

export const momentumQuery = (symbol) => ({
  queryKey: queryKeys.momentum(symbol),
  queryFn: ({ signal }) => api.getMomentum(symbol, { signal }),
  staleTime: STALE_TIME.history,
  enabled: Boolean(symbol),
})

/**
 * Con `universe: 'custom'` y sin claves la consulta no sale (el API contestaría 422), igual que
 * `searchQuery` con texto vacío.
 * @param {{ universe?: 'mx' | 'us' | 'custom', symbols?: string[] }} [params]
 */
export const factorScreenerQuery = (params = {}) => ({
  queryKey: queryKeys.factorScreener(params),
  queryFn: ({ signal }) => api.getFactorScreener(params, { signal }),
  staleTime: STALE_TIME.screeners,
  enabled: params.universe !== 'custom' || (params.symbols ?? []).some((s) => String(s ?? '').trim().length > 0),
})

/** @param {'us' | 'mx'} [universe] */
export const magicScreenerQuery = (universe = 'us') => ({
  queryKey: queryKeys.magicScreener(universe),
  queryFn: ({ signal }) => api.getMagicScreener({ universe }, { signal }),
  staleTime: STALE_TIME.screeners,
})

export const fibrasScreenerQuery = (extra = []) => ({
  queryKey: queryKeys.fibrasScreener(extra),
  queryFn: ({ signal }) => api.getFibrasScreener({ extra }, { signal }),
  staleTime: STALE_TIME.screeners,
})

export const insidersQuery = (symbol) => ({
  queryKey: queryKeys.insiders(symbol),
  queryFn: ({ signal }) => api.getInsiders(symbol, { signal }),
  staleTime: STALE_TIME.fundamentals,
  enabled: Boolean(symbol),
})

// ─── Fase 5 ─────────────────────────────────────────────────────────────────
// Cada xQuery usa su función de endpoints.js (que valida los parámetros antes de salir a la red) y
// la frescura de su clase. Las features les suman `enabled: feature.enabled` con useFeature.

/** @param {{ country: 'mx' | 'us', compare?: ('1w' | '1m' | '1y')[] }} params */
export const curvesQuery = (params) => ({
  queryKey: queryKeys.curves(params),
  queryFn: ({ signal }) => api.getCurves(params, { signal }),
  staleTime: STALE_TIME.curves,
})

/** @param {{ history?: '1y' | '5y' }} [params] */
export const curveSpreadsQuery = (params = {}) => ({
  queryKey: queryKeys.curveSpreads(params),
  queryFn: ({ signal }) => api.getCurveSpreads(params, { signal }),
  staleTime: STALE_TIME.curves,
})

export const moneyMarketQuery = () => ({
  queryKey: queryKeys.moneyMarket(),
  queryFn: ({ signal }) => api.getMoneyMarket({ signal }),
  staleTime: STALE_TIME.rates,
})

/** Encuesta de Banxico, tasa real y forwards implícitos: cambian con las tasas. */
export const expectationsQuery = () => ({
  queryKey: queryKeys.expectations(),
  queryFn: ({ signal }) => api.getExpectations({ signal }),
  staleTime: STALE_TIME.rates,
})

/** @param {{ years?: 1 | 3 | 5 | 10 }} [params] */
export const fxMonitorQuery = (params = {}) => ({
  queryKey: queryKeys.fxMonitor(params),
  queryFn: ({ signal }) => api.getFxMonitor(params, { signal }),
  staleTime: STALE_TIME.macro,
})

export const fxCrossesQuery = () => ({
  queryKey: queryKeys.fxCrosses(),
  queryFn: ({ signal }) => api.getFxCrosses({ signal }),
  staleTime: STALE_TIME.macro,
})

/** FIX de una fecha con su regla (fecha o DOF). @param {{ date: string, rule?: 'fecha' | 'dof' }} params */
export const fixQuery = (params) => ({
  queryKey: queryKeys.fix(params),
  queryFn: ({ signal }) => api.getFix(params, { signal }),
  staleTime: STALE_TIME.macro,
  enabled: Boolean(params?.date),
})

/** @param {{ start: string, end: string, rule?: 'fecha' | 'dof', monthEnd?: boolean }} params */
export const fixTableQuery = (params) => ({
  queryKey: queryKeys.fixTable(params),
  queryFn: ({ signal }) => api.getFixTable(params, { signal }),
  staleTime: STALE_TIME.macro,
  enabled: Boolean(params?.start && params?.end),
})

/** @param {{ days?: number[], date?: string, mxn?: 'tiie' | 'cetes' | 'fondeo', usd?: 'ust' | 'sofr' }} [params] */
export const fxForwardQuery = (params = {}) => ({
  queryKey: queryKeys.fxForward(params),
  queryFn: ({ signal }) => api.getFxForward(params, { signal }),
  staleTime: STALE_TIME.macro,
})

/** @param {{ start: string, end: string, country?: ('mx' | 'us')[] }} params */
export const economicCalendarQuery = (params) => ({
  queryKey: queryKeys.economicCalendar(params),
  queryFn: ({ signal }) => api.getEconomicCalendar(params, { signal }),
  staleTime: STALE_TIME.reference,
  enabled: Boolean(params?.start && params?.end),
})

/** @param {{ country: 'mx' | 'us', years?: 5 | 10 | 'max' }} params */
export const macroIndicatorsQuery = (params) => ({
  queryKey: queryKeys.macroIndicators(params),
  queryFn: ({ signal }) => api.getMacroIndicators(params, { signal }),
  staleTime: STALE_TIME.macro,
})

/** Datos anuales del Banco Mundial. @param {{ countries?: string[], indicators?: string[] }} [params] */
export const macroWorldQuery = (params = {}) => ({
  queryKey: queryKeys.macroWorld(params),
  queryFn: ({ signal }) => api.getMacroWorld(/** @type {any} */ (params), { signal }),
  staleTime: STALE_TIME.reference,
})

/** @param {{ universe: 'mx' | 'us', days?: 30 | 60 | 90 }} params */
export const eventsSeasonQuery = (params) => ({
  queryKey: queryKeys.eventsSeason(params),
  queryFn: ({ signal }) => api.getEventsSeason(params, { signal }),
  staleTime: STALE_TIME.events,
})

/** @param {string} symbol */
export const earningsQuery = (symbol) => ({
  queryKey: queryKeys.earnings(symbol),
  queryFn: ({ signal }) => api.getEarnings(symbol, { signal }),
  staleTime: STALE_TIME.fundamentals,
  enabled: Boolean(symbol),
})

/** @param {string} symbol */
export const holdersQuery = (symbol) => ({
  queryKey: queryKeys.holders(symbol),
  queryFn: ({ signal }) => api.getHolders(symbol, { signal }),
  staleTime: STALE_TIME.fundamentals,
  enabled: Boolean(symbol),
})

/** @param {string} symbol @param {{ start?: string }} [params] */
export const sharesQuery = (symbol, params = {}) => ({
  queryKey: queryKeys.shares(symbol, params),
  queryFn: ({ signal }) => api.getShares(symbol, params, { signal }),
  staleTime: STALE_TIME.fundamentals,
  enabled: Boolean(symbol),
})

/** @param {string} symbol @param {{ forms?: string[], limit?: number }} [params] */
export const filingsQuery = (symbol, params = {}) => ({
  queryKey: queryKeys.filings(symbol, params),
  queryFn: ({ signal }) => api.getFilings(symbol, params, { signal }),
  staleTime: STALE_TIME.fundamentals,
  enabled: Boolean(symbol),
})

/**
 * Velas: las intradía (5m y 1h) se refrescan cada minuto con la pestaña visible; las demás tienen
 * la frescura de la historia.
 * @param {string} symbol
 * @param {{ range?: '1d' | '5d' | '1mo' | '6mo' | '1y' | '5y' | 'max', interval?: '5m' | '1h' | '1d' | '1wk' | '1mo', compare?: '^MXX' | '^GSPC' | 'SPY' }} [params]
 */
export const ohlcQuery = (symbol, params = {}) => {
  const intraday = params.interval === '5m' || params.interval === '1h'
  return {
    queryKey: queryKeys.ohlc(symbol, params),
    queryFn: ({ signal }) => api.getOhlc(symbol, params, { signal }),
    staleTime: intraday ? STALE_TIME.intraday : STALE_TIME.history,
    refetchInterval: intraday ? visibleInterval(STALE_TIME.intraday) : false,
    refetchIntervalInBackground: false,
    enabled: Boolean(symbol),
  }
}

/** @param {{ market: 'mx' | 'us', kind: 'gainers' | 'losers' | 'active', limit?: number }} params */
export const moversQuery = (params) => ({
  queryKey: queryKeys.movers(params),
  queryFn: ({ signal }) => api.getMovers(params, { signal }),
  staleTime: STALE_TIME.quotes,
})

/** @param {{ market: 'mx' | 'us' }} params */
export const breadthQuery = (params) => ({
  queryKey: queryKeys.breadth(params),
  queryFn: ({ signal }) => api.getBreadth(params, { signal }),
  staleTime: STALE_TIME.quotes,
})

/** @param {{ market: 'mx' | 'us' }} params */
export const sectorsQuery = (params) => ({
  queryKey: queryKeys.sectors(params),
  queryFn: ({ signal }) => api.getSectors(params, { signal }),
  staleTime: STALE_TIME.quotes,
})

/** @param {string} symbol */
export const fundQuery = (symbol) => ({
  queryKey: queryKeys.fund(symbol),
  queryFn: ({ signal }) => api.getFund(symbol, { signal }),
  staleTime: STALE_TIME.fundamentals,
  enabled: Boolean(symbol),
})

export const referenceMxQuery = () => ({
  queryKey: queryKeys.referenceMx(),
  queryFn: ({ signal }) => api.getReferenceMx({ signal }),
  staleTime: STALE_TIME.reference,
})

/** @param {{ from: string, to: string }} params AAAA-MM */
export const updateFactorQuery = (params) => ({
  queryKey: queryKeys.updateFactor(params),
  queryFn: ({ signal }) => api.getUpdateFactor(params, { signal }),
  staleTime: STALE_TIME.macro,
  enabled: Boolean(params?.from && params?.to),
})

/** @param {{ market: 'US' | 'EM' }} params */
export const industriesQuery = (params) => ({
  queryKey: queryKeys.industries(params),
  queryFn: ({ signal }) => api.getIndustries(params, { signal }),
  staleTime: STALE_TIME.reference,
})

/** @param {string} symbol @param {{ years?: 3 | 5 }} [params] */
export const creditHealthQuery = (symbol, params = {}) => ({
  queryKey: queryKeys.creditHealth(symbol, params),
  queryFn: ({ signal }) => api.getCreditHealth(symbol, params, { signal }),
  staleTime: STALE_TIME.fundamentals,
  enabled: Boolean(symbol),
})
