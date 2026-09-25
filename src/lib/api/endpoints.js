// Una función async por endpoint del contrato v2 (docs/api-v2.md): los errores, incluso los de
// validación local (símbolo inválido), siempre llegan como promesa rechazada. Todas aceptan `{ signal }` al
// final para que TanStack Query pueda cancelar, y devuelven el JSON tal cual lo manda el API.
//
//   import { getQuotes } from '../lib/api/endpoints.js'
//   const { quotes, missing, meta } = await getQuotes(['AAPL', 'WALMEX.MX'], { signal })
//
// Antes de llamar se espera el sondeo de /health (capabilities.js). Si el servidor es el API
// viejo, las rutas v2 no existen (el v1 contesta 200 con {"error": "Ruta no encontrada"}): se
// lanza ApiError LEGACY_SERVER, salvo en historia, cotizaciones, FX y rf cuando
// VITE_ALLOW_LEGACY=true, que pasan por los adaptadores de legacy.js.
import { apiFetch } from './client.js'
import { ALLOW_LEGACY, SYMBOL_RE } from './config.js'
import { ApiError } from './http.js'
import { startCapabilitiesProbe } from './capabilities.js'
import { legacyFx, legacyHistory, legacyQuotes, legacyRiskFree } from './legacy.js'

/**
 * @typedef {import('./types.js').Range} Range
 * @typedef {import('./types.js').Interval} Interval
 * @typedef {import('./types.js').CurrencyMode} CurrencyMode
 * @typedef {{ signal?: AbortSignal }} CallOptions
 */

/** Máximo de símbolos por llamada a /v2/quotes y /v2/panel. */
export const MAX_SYMBOLS = 50

/** @param {string} symbol @returns {string} símbolo en mayúsculas, validado */
export function normalizeSymbol(symbol) {
  const s = String(symbol ?? '').trim()
  if (!SYMBOL_RE.test(s)) {
    throw new ApiError({ status: 400, code: 'INVALID_SYMBOL', message: `"${s.slice(0, 24)}" no es una clave válida.` })
  }
  return s.toUpperCase()
}

/** @param {string[]} symbols @returns {string[]} únicos, en mayúsculas, validados */
export function normalizeSymbols(symbols) {
  const out = [...new Set((symbols ?? []).map(normalizeSymbol))]
  if (out.length === 0) throw new ApiError({ status: 400, code: 'VALIDATION_ERROR', message: 'Falta al menos una clave.' })
  if (out.length > MAX_SYMBOLS) {
    throw new ApiError({ status: 400, code: 'VALIDATION_ERROR', message: `Se pueden pedir hasta ${MAX_SYMBOLS} claves a la vez.` })
  }
  return out
}

const seg = (value) => encodeURIComponent(value)

function legacyUnsupported() {
  return new ApiError({
    status: 501,
    code: 'LEGACY_SERVER',
    message: 'El servidor todavía no está actualizado y no tiene esta función.',
  })
}

/**
 * Espera el sondeo de /health sin ignorar la cancelación.
 * @param {AbortSignal} [signal]
 */
async function serverStatus(signal) {
  const probe = startCapabilitiesProbe()
  if (!signal) return (await probe).status
  if (signal.aborted) throw signal.reason ?? new DOMException('Operación cancelada', 'AbortError')
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Operación cancelada', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    probe.then(
      (s) => {
        signal.removeEventListener('abort', onAbort)
        resolve(s.status)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

/**
 * GET a una ruta v2, o error claro si el servidor es el viejo.
 * @param {string} path
 * @param {Record<string, unknown> | undefined} query
 * @param {CallOptions} [options]
 */
async function v2Get(path, query, { signal } = {}) {
  if ((await serverStatus(signal)) === 'legacy') throw legacyUnsupported()
  return apiFetch(path, { query, signal })
}

// ─── Plataforma ─────────────────────────────────────────────────────────────

/** @param {CallOptions} [options] @returns {Promise<import('./types.js').HealthResponse>} */
export async function getHealth({ signal } = {}) {
  return apiFetch('/health', { signal, auth: false })
}

/** @param {CallOptions} [options] @returns {Promise<import('./types.js').MeResponse>} */
export async function getMe({ signal } = {}) {
  return v2Get('/auth/me', undefined, { signal })
}

// ─── Datos de mercado ───────────────────────────────────────────────────────

/**
 * @param {string[]} symbols hasta 50
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').QuotesResponse>}
 */
export async function getQuotes(symbols, { signal } = {}) {
  const list = normalizeSymbols(symbols)
  if ((await serverStatus(signal)) === 'legacy') {
    if (ALLOW_LEGACY) return legacyQuotes(list, { signal })
    throw legacyUnsupported()
  }
  return apiFetch('/v2/quotes', { query: { symbols: list }, signal })
}

/**
 * @param {string} q texto libre ("walmart", "cemex", "AAPL")
 * @param {{ limit?: number } & CallOptions} [options]
 * @returns {Promise<import('./types.js').SearchResponse>}
 */
export async function search(q, { limit = 10, signal } = {}) {
  return v2Get('/v2/search', { q: String(q ?? '').trim(), limit }, { signal })
}

// Periodos e intervalos del contrato (Range e Interval en types.js; kaizen_api/schemas.py). Uno
// fuera de la lista el API lo contesta con 422; aquí se rechaza antes, con el dato en el mensaje,
// para que una pantalla que pida "3y" falle en las pruebas y no en producción.
const RANGES = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max'])
const INTERVALS = new Set(['1d', '1wk', '1mo'])

function assertPeriod(range, interval) {
  const bad = !RANGES.has(range) ? `periodo "${range}"` : !INTERVALS.has(interval) ? `intervalo "${interval}"` : null
  if (bad) throw new ApiError({ status: 400, code: 'VALIDATION_ERROR', message: `La app pidió un ${bad} que el servidor no acepta.` })
}

/**
 * @param {string} symbol
 * @param {{ range?: Range, interval?: Interval, ccy?: CurrencyMode }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').HistoryResponse>}
 */
export async function getHistory(symbol, { range = '1y', interval = '1d', ccy = 'native' } = {}, { signal } = {}) {
  const s = normalizeSymbol(symbol)
  assertPeriod(range, interval)
  if ((await serverStatus(signal)) === 'legacy') {
    if (ALLOW_LEGACY) return legacyHistory(s, { range, ccy }, { signal })
    throw legacyUnsupported()
  }
  return apiFetch(`/v2/history/${seg(s)}`, { query: { range, interval, ccy }, signal })
}

/**
 * Precios alineados por fecha (INNER JOIN, sin forward fill). Los rendimientos se calculan en
 * el cliente (src/lib/finance). `adjust: 'splits'` pide cierres sin ajustar por dividendos (solo
 * por splits); solo se manda si se pide, porque un API sin la capacidad `panel.splits` lo ignora y
 * contesta sin `adjustment`, que es lo mismo que `'total'`.
 * @param {string[]} symbols
 * @param {{ range?: Range, interval?: Interval, ccy?: CurrencyMode, adjust?: 'splits' }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').PanelResponse>}
 */
export async function getPanel(symbols, { range = '5y', interval = '1wk', ccy = 'MXN', adjust } = {}, { signal } = {}) {
  assertPeriod(range, interval)
  return v2Get('/v2/panel', { symbols: normalizeSymbols(symbols), range, interval, ccy, adjust: adjust === 'splits' ? adjust : undefined }, { signal })
}

/**
 * @param {string} [pair]
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').FxResponse>}
 */
export async function getFx(pair = 'USDMXN', { signal } = {}) {
  if ((await serverStatus(signal)) === 'legacy') {
    if (ALLOW_LEGACY && pair === 'USDMXN') return legacyFx({ signal })
    throw legacyUnsupported()
  }
  return apiFetch('/v2/fx', { query: { pair }, signal })
}

/**
 * @param {{ pair?: string, start?: string, end?: string }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').FxHistoryResponse>}
 */
export async function getFxHistory({ pair = 'USDMXN', start, end } = {}, { signal } = {}) {
  return v2Get('/v2/fx/history', { pair, start, end }, { signal })
}

// ─── Tasas y macro ──────────────────────────────────────────────────────────

/** @param {CallOptions} [options] @returns {Promise<import('./types.js').RatesMxResponse>} */
export async function getRatesMx({ signal } = {}) {
  return v2Get('/v2/rates/mx', undefined, { signal })
}

/**
 * Serie de la tasa libre de riesgo (rendimiento simple anualizado, fracción).
 * @param {{ start?: string, end?: string, tenorDays?: number }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').RiskFreeResponse>}
 */
export async function getRiskFree({ start, end, tenorDays = 28 } = {}, { signal } = {}) {
  if ((await serverStatus(signal)) === 'legacy') {
    if (ALLOW_LEGACY) return legacyRiskFree({ signal })
    throw legacyUnsupported()
  }
  return apiFetch('/v2/rates/rf', { query: { start, end, tenorDays }, signal })
}

/**
 * Nivel mensual del INPC general (capacidad `rates.inpc`). 503 NOT_CONFIGURED sin token de Banxico.
 * @param {{ start?: string, end?: string }} [params] AAAA-MM-DD
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').InpcResponse>}
 */
export async function getInpc({ start, end } = {}, { signal } = {}) {
  return v2Get('/v2/rates/mx/inpc', { start, end }, { signal })
}

/** @param {CallOptions} [options] @returns {Promise<import('./types.js').MacroUsResponse>} */
export async function getMacroUs({ signal } = {}) {
  return v2Get('/v2/macro/us', undefined, { signal })
}

// ─── Mercados y noticias ────────────────────────────────────────────────────

/** @param {CallOptions} [options] @returns {Promise<import('./types.js').MarketsOverviewResponse>} */
export async function getMarketsOverview({ signal } = {}) {
  return v2Get('/v2/markets/overview', undefined, { signal })
}

/** @param {CallOptions} [options] @returns {Promise<import('./types.js').MarketsWorldResponse>} */
export async function getMarketsWorld({ signal } = {}) {
  return v2Get('/v2/markets/world', undefined, { signal })
}

/**
 * @param {{ symbol?: string, lang?: 'es' | 'en' | 'all', limit?: number }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').NewsResponse>}
 */
export async function getNews({ symbol, lang = 'all', limit = 30 } = {}, { signal } = {}) {
  return v2Get('/v2/news', { symbol: symbol ? normalizeSymbol(symbol) : undefined, lang, limit }, { signal })
}

/**
 * @param {string[]} symbols
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').EventsResponse>}
 */
export async function getEvents(symbols, { signal } = {}) {
  return v2Get('/v2/events', { symbols: normalizeSymbols(symbols) }, { signal })
}

// ─── Investigación ──────────────────────────────────────────────────────────

/** @param {string} symbol @param {CallOptions} [options] @returns {Promise<import('./types.js').InstrumentResponse>} */
export async function getInstrument(symbol, { signal } = {}) {
  return v2Get(`/v2/instrument/${seg(normalizeSymbol(symbol))}`, undefined, { signal })
}

/**
 * @param {string} symbol
 * @param {{ freq?: 'annual' | 'quarterly' }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').StatementsResponse>}
 */
export async function getStatements(symbol, { freq = 'annual' } = {}, { signal } = {}) {
  return v2Get(`/v2/instrument/${seg(normalizeSymbol(symbol))}/statements`, { freq }, { signal })
}

/** @param {string} symbol @param {CallOptions} [options] @returns {Promise<import('./types.js').DividendsResponse>} */
export async function getDividends(symbol, { signal } = {}) {
  return v2Get(`/v2/instrument/${seg(normalizeSymbol(symbol))}/dividends`, undefined, { signal })
}

/**
 * Supuestos opcionales como fracciones (erp 0.055, crp 0.021, terminalGrowth 0.035).
 * @param {string} symbol
 * @param {{ erp?: number, crp?: number, terminalGrowth?: number, years?: number, growth?: number }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').ValuationResponse>}
 */
export async function getValuation(symbol, params = {}, { signal } = {}) {
  const { erp, crp, terminalGrowth, years, growth } = params
  return v2Get(`/v2/valuation/${seg(normalizeSymbol(symbol))}`, { erp, crp, terminalGrowth, years, growth }, { signal })
}

/**
 * Prima de mercado por omisión y prima país, con su fuente (capacidad `assumptions`).
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').AssumptionsResponse>}
 */
export async function getAssumptions({ signal } = {}) {
  return v2Get('/v2/assumptions', undefined, { signal })
}

/** @param {string} symbol @param {CallOptions} [options] @returns {Promise<import('./types.js').MomentumResponse>} */
export async function getMomentum(symbol, { signal } = {}) {
  return v2Get(`/v2/momentum/${seg(normalizeSymbol(symbol))}`, undefined, { signal })
}

// ─── Screeners ──────────────────────────────────────────────────────────────

/**
 * @param {{ universe?: 'mx' | 'us' | 'custom', symbols?: string[] }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').FactorScreenerResponse>}
 */
export async function getFactorScreener({ universe = 'mx', symbols } = {}, { signal } = {}) {
  const list = universe === 'custom' ? normalizeSymbols(symbols ?? []) : undefined
  return v2Get('/v2/screeners/factors', { universe, symbols: list }, { signal })
}

/**
 * @param {{ universe?: 'us' | 'mx' }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').MagicScreenerResponse>}
 */
export async function getMagicScreener({ universe = 'us' } = {}, { signal } = {}) {
  return v2Get('/v2/screeners/magic', { universe }, { signal })
}

/**
 * @param {{ extra?: string[] }} [params] FIBRAs extra además de la lista base
 * @param {CallOptions} [options]
 * @returns {Promise<import('./types.js').FibrasScreenerResponse>}
 */
export async function getFibrasScreener({ extra } = {}, { signal } = {}) {
  const list = extra && extra.length ? normalizeSymbols(extra) : undefined
  return v2Get('/v2/screeners/fibras', { extra: list }, { signal })
}

/** @param {string} symbol @param {CallOptions} [options] @returns {Promise<import('./types.js').InsidersResponse>} */
export async function getInsiders(symbol, { signal } = {}) {
  return v2Get(`/v2/insiders/${seg(normalizeSymbol(symbol))}`, undefined, { signal })
}
