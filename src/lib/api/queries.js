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
//   búsqueda 24 h.
// Reintentos: el cliente ya reintenta el arranque en frío; aquí a lo más uno más para errores de
// red o 5xx, y nunca para 4xx.
import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './http.js'
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
})

export const QUOTES_REFETCH_MS = 60 * SECOND

/**
 * Política de reintento de TanStack: nunca 4xx (ni cancelaciones), a lo más 1 reintento.
 * @param {number} failureCount
 * @param {unknown} error
 */
export function shouldRetry(failureCount, error) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  if (error instanceof ApiError && error.code === 'LEGACY_SERVER') return false
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
  macroUs: () => /** @type {const} */ (['api', 'macro', 'us']),
  marketsOverview: () => /** @type {const} */ (['api', 'markets', 'overview']),
  marketsWorld: () => /** @type {const} */ (['api', 'markets', 'world']),
  news: (params = {}) => ['api', 'news', { lang: 'all', limit: 30, ...params }],
  events: (symbols) => ['api', 'events', sortedUpper(symbols)],
  instrument: (symbol) => ['api', 'instrument', String(symbol).toUpperCase()],
  statements: (symbol, freq = 'annual') => ['api', 'instrument', String(symbol).toUpperCase(), 'statements', freq],
  dividends: (symbol) => ['api', 'instrument', String(symbol).toUpperCase(), 'dividends'],
  valuation: (symbol, params = {}) => ['api', 'valuation', String(symbol).toUpperCase(), params],
  momentum: (symbol) => ['api', 'momentum', String(symbol).toUpperCase()],
  factorScreener: (params = {}) => ['api', 'screeners', 'factors', { universe: 'mx', ...params }],
  magicScreener: (universe = 'us') => ['api', 'screeners', 'magic', universe],
  fibrasScreener: (extra = []) => ['api', 'screeners', 'fibras', sortedUpper(extra)],
  insiders: (symbol) => ['api', 'insiders', String(symbol).toUpperCase()],
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

export const momentumQuery = (symbol) => ({
  queryKey: queryKeys.momentum(symbol),
  queryFn: ({ signal }) => api.getMomentum(symbol, { signal }),
  staleTime: STALE_TIME.history,
  enabled: Boolean(symbol),
})

export const factorScreenerQuery = (params = {}) => ({
  queryKey: queryKeys.factorScreener(params),
  queryFn: ({ signal }) => api.getFactorScreener(params, { signal }),
  staleTime: STALE_TIME.screeners,
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
