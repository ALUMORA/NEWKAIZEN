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

// ─── Fase 5 ─────────────────────────────────────────────────────────────────
// Una función por ruta nueva del contrato (docs/overhaul/specs/fase5-spec.md). Los parámetros se
// validan ANTES de salir a la red, igual que getPanel con el periodo: una pantalla que pida algo
// fuera del contrato falla en sus pruebas con el dato en el mensaje, no con un 422 en producción.

/** @param {string} what */
function invalid(what) {
  return new ApiError({ status: 400, code: 'VALIDATION_ERROR', message: `La app pidió ${what}, que el servidor no acepta.` })
}

/**
 * @template T
 * @param {string} name @param {T} value @param {readonly T[]} allowed
 * @param {{ optional?: boolean }} [opts]
 */
function oneOf(name, value, allowed, { optional = false } = {}) {
  if (value == null && optional) return undefined
  if (!allowed.includes(value)) throw invalid(`${name} "${String(value)}"`)
  return value
}

/**
 * Lista de valores permitidos (se manda como "a,b,c"). Vacía o sin dar: undefined.
 * @param {string} name @param {unknown} values @param {readonly string[]} allowed
 */
function listOf(name, values, allowed) {
  if (values == null) return undefined
  const list = [...new Set((Array.isArray(values) ? values : [values]).map((v) => String(v).trim()))]
  if (list.length === 0) return undefined
  for (const v of list) if (!allowed.includes(v)) throw invalid(`${name} "${v}"`)
  return list
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** @param {string} name @param {unknown} value @param {{ optional?: boolean }} [opts] @returns {string | undefined} */
function isoDate(name, value, { optional = false } = {}) {
  if (value == null && optional) return undefined
  const s = String(value ?? '')
  const d = ISO_DATE_RE.test(s) ? new Date(`${s}T00:00:00Z`) : null
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw invalid(`${name} "${s}" (se espera AAAA-MM-DD)`)
  return s
}

/** @param {string} name @param {unknown} value @returns {string} */
function month(name, value) {
  const s = String(value ?? '')
  if (!MONTH_RE.test(s)) throw invalid(`${name} "${s}" (se espera AAAA-MM)`)
  return s
}

/** Días entre dos fechas AAAA-MM-DD ya validadas. @param {string} a @param {string} b */
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** @param {string} start @param {string} end @param {number} maxDays @param {string} label */
function dateWindow(start, end, maxDays, label) {
  const days = daysBetween(start, end)
  if (days < 0) throw invalid(`un rango que empieza (${start}) después de que termina (${end})`)
  if (days > maxDays) throw invalid(`un rango de ${days} días; el máximo es ${label}`)
}

/** @param {string} name @param {unknown} value @param {number} min @param {number} max @param {{ optional?: boolean }} [opts] */
function intIn(name, value, min, max, { optional = false } = {}) {
  if (value == null && optional) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) throw invalid(`${name} ${String(value)} (entero de ${min} a ${max})`)
  return n
}

export const COUNTRIES = /** @type {const} */ (['mx', 'us'])
export const CURVE_COMPARE = /** @type {const} */ (['1w', '1m', '1y'])
export const FX_MONITOR_YEARS = /** @type {const} */ ([1, 3, 5, 10])
export const FIX_RULES = /** @type {const} */ (['fecha', 'dof'])
export const FORWARD_MXN = /** @type {const} */ (['tiie', 'cetes', 'fondeo'])
export const FORWARD_USD = /** @type {const} */ (['ust', 'sofr'])
export const MACRO_YEARS = /** @type {const} */ ([5, 10, 'max'])
export const MACRO_WORLD_INDICATORS = /** @type {const} */ (['gdpUsd', 'gdpGrowth', 'inflation', 'debt'])
export const SEASON_DAYS = /** @type {const} */ ([30, 60, 90])
export const FILING_FORMS = /** @type {const} */ (['10-K', '10-Q', '8-K', '20-F', '6-K', 'SC 13D', 'SC 13G', 'DEF 14A'])
export const OHLC_RANGES = /** @type {const} */ (['1d', '5d', '1mo', '6mo', '1y', '5y', 'max'])
export const OHLC_INTERVALS = /** @type {const} */ (['5m', '1h', '1d', '1wk', '1mo'])
export const OHLC_COMPARE = /** @type {const} */ (['^MXX', '^GSPC', 'SPY'])
export const MOVERS_KINDS = /** @type {const} */ (['gainers', 'losers', 'active'])
export const INDUSTRY_MARKETS = /** @type {const} */ (['US', 'EM'])
export const CREDIT_HEALTH_YEARS = /** @type {const} */ ([3, 5])

/**
 * Combinaciones de /v2/ohlc que Yahoo no sirve y el API contesta con 400: velas de 5 minutos más
 * allá de un mes y de una hora más allá de un año. El servidor manda; aquí solo se adelanta el
 * rechazo de las que seguro fallan.
 */
const OHLC_MAX_RANGE = Object.freeze({ '5m': ['1d', '5d', '1mo'], '1h': ['1d', '5d', '1mo', '6mo', '1y'] })

/** @param {string} range @param {string} interval */
export function isValidOhlc(range, interval) {
  if (!OHLC_RANGES.includes(/** @type {any} */ (range)) || !OHLC_INTERVALS.includes(/** @type {any} */ (interval))) return false
  const allowed = OHLC_MAX_RANGE[interval]
  return !allowed || allowed.includes(range)
}

/** @typedef {import('./types.js').V5Response} V5Response */

// Tasas y curvas (V5TS)

/**
 * @param {{ country: import('./types.js').Country, compare?: ('1w' | '1m' | '1y')[] }} params
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getCurves({ country, compare } = /** @type {any} */ ({}), { signal } = {}) {
  const query = { country: oneOf('el país', country, COUNTRIES), compare: listOf('la comparación', compare, CURVE_COMPARE) }
  return v2Get('/v2/curves', query, { signal })
}

/** @param {{ history?: '1y' | '5y' }} [params] @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getCurveSpreads({ history } = {}, { signal } = {}) {
  return v2Get('/v2/curves/spreads', { history: oneOf('la historia', history, ['1y', '5y'], { optional: true }) }, { signal })
}

/** @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getMoneyMarket({ signal } = {}) {
  return v2Get('/v2/money-market', undefined, { signal })
}

/** @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getExpectations({ signal } = {}) {
  return v2Get('/v2/expectations', undefined, { signal })
}

// Tipo de cambio (V5FX)

/** @param {{ years?: 1 | 3 | 5 | 10 }} [params] @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getFxMonitor({ years = 1 } = {}, { signal } = {}) {
  return v2Get('/v2/fxdesk/monitor', { years: oneOf('el horizonte en años', years, FX_MONITOR_YEARS) }, { signal })
}

/** @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getFxCrosses({ signal } = {}) {
  return v2Get('/v2/fxdesk/crosses', undefined, { signal })
}

/**
 * FIX de una fecha, con la fecha del FIX que corresponde según la regla.
 * @param {{ date: string, rule?: import('./types.js').FixRule }} params
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getFix({ date, rule = 'fecha' } = /** @type {any} */ ({}), { signal } = {}) {
  return v2Get('/v2/fxdesk/fix', { date: isoDate('la fecha', date), rule: oneOf('la regla', rule, FIX_RULES) }, { signal })
}

/**
 * Tabla de FIX entre dos fechas (máximo 3 años), opcionalmente solo cierres de mes.
 * @param {{ start: string, end: string, rule?: import('./types.js').FixRule, monthEnd?: boolean }} params
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getFixTable({ start, end, rule, monthEnd } = /** @type {any} */ ({}), { signal } = {}) {
  const s = isoDate('el inicio', start)
  const e = isoDate('el fin', end)
  const [sy, sm, sd] = s.split('-').map(Number)
  const limit = new Date(Date.UTC(sy + 3, sm - 1, sd)).toISOString().slice(0, 10)
  dateWindow(s, e, daysBetween(s, limit), '3 años')
  if (monthEnd != null && typeof monthEnd !== 'boolean') throw invalid(`cierres de mes "${String(monthEnd)}"`)
  const query = { start: s, end: e, rule: oneOf('la regla', rule, FIX_RULES, { optional: true }), monthEnd: monthEnd == null ? undefined : String(monthEnd) }
  return v2Get('/v2/fxdesk/fix-table', query, { signal })
}

/**
 * Forward teórico USD/MXN por plazos en días (1 a 365) o a una fecha, no las dos cosas.
 * @param {{ days?: number[], date?: string, mxn?: 'tiie' | 'cetes' | 'fondeo', usd?: 'ust' | 'sofr' }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getFxForward({ days, date, mxn, usd } = {}, { signal } = {}) {
  if (days != null && date != null) throw invalid('plazos y fecha a la vez')
  const list = days == null ? undefined : [...new Set((Array.isArray(days) ? days : [days]).map((d) => intIn('el plazo en días', d, 1, 365)))]
  const query = {
    days: list && list.length ? list : undefined,
    date: isoDate('la fecha', date, { optional: true }),
    mxn: oneOf('la referencia en pesos', mxn, FORWARD_MXN, { optional: true }),
    usd: oneOf('la referencia en dólares', usd, FORWARD_USD, { optional: true }),
  }
  return v2Get('/v2/fxdesk/forward', query, { signal })
}

// Economía y calendario (V5EC)

/**
 * @param {{ start: string, end: string, country?: import('./types.js').Country[] }} params máximo 90 días
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getEconomicCalendar({ start, end, country } = /** @type {any} */ ({}), { signal } = {}) {
  const s = isoDate('el inicio', start)
  const e = isoDate('el fin', end)
  dateWindow(s, e, 90, '90 días')
  return v2Get('/v2/calendar/economic', { start: s, end: e, country: listOf('el país', country, COUNTRIES) }, { signal })
}

/**
 * @param {{ country: import('./types.js').Country, years?: 5 | 10 | 'max' }} params
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getMacroIndicators({ country, years } = /** @type {any} */ ({}), { signal } = {}) {
  const query = { country: oneOf('el país', country, COUNTRIES), years: oneOf('el horizonte', years, MACRO_YEARS, { optional: true }) }
  return v2Get('/v2/macro/indicators', query, { signal })
}

/**
 * Comparador de países del Banco Mundial (claves ISO de tres letras, hasta 10).
 * @param {{ countries?: string[], indicators?: ('gdpUsd' | 'gdpGrowth' | 'inflation' | 'debt')[] }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getMacroWorld({ countries, indicators } = {}, { signal } = {}) {
  let list
  if (countries != null) {
    list = [...new Set((Array.isArray(countries) ? countries : [countries]).map((c) => String(c).trim().toUpperCase()))]
    for (const c of list) if (!/^[A-Z]{3}$/.test(c)) throw invalid(`el país "${c}" (clave ISO de tres letras)`)
    if (list.length > 10) throw invalid(`${list.length} países; el máximo es 10`)
    if (list.length === 0) list = undefined
  }
  return v2Get('/v2/macro/world', { countries: list, indicators: listOf('el indicador', indicators, MACRO_WORLD_INDICATORS) }, { signal })
}

// Agenda y fondos (V5PF)

/**
 * @param {{ universe: import('./types.js').Country, days?: 30 | 60 | 90 }} params
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getEventsSeason({ universe, days } = /** @type {any} */ ({}), { signal } = {}) {
  const query = { universe: oneOf('el universo', universe, COUNTRIES), days: oneOf('la ventana en días', days, SEASON_DAYS, { optional: true }) }
  return v2Get('/v2/events/season', query, { signal })
}

/** @param {string} symbol @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getFund(symbol, { signal } = {}) {
  return v2Get(`/v2/funds/${seg(normalizeSymbol(symbol))}`, undefined, { signal })
}

// Ficha: resultados, tenencia, acciones y documentos (V5FI)

/** @param {string} symbol @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getEarnings(symbol, { signal } = {}) {
  return v2Get(`/v2/earnings/${seg(normalizeSymbol(symbol))}`, undefined, { signal })
}

/** @param {string} symbol @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getHolders(symbol, { signal } = {}) {
  return v2Get(`/v2/holders/${seg(normalizeSymbol(symbol))}`, undefined, { signal })
}

/**
 * @param {string} symbol
 * @param {{ start?: string }} [params] por omisión el servidor toma 3 años atrás
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getShares(symbol, { start } = {}, { signal } = {}) {
  const s = normalizeSymbol(symbol)
  return v2Get(`/v2/shares/${seg(s)}`, { start: isoDate('el inicio', start, { optional: true }) }, { signal })
}

/**
 * @param {string} symbol
 * @param {{ forms?: string[], limit?: number }} [params] limit de 1 a 50
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getFilings(symbol, { forms, limit } = {}, { signal } = {}) {
  const s = normalizeSymbol(symbol)
  const query = { forms: listOf('el tipo de documento', forms, FILING_FORMS), limit: intIn('el límite', limit, 1, 50, { optional: true }) }
  return v2Get(`/v2/filings/${seg(s)}`, query, { signal })
}

// Gráfica técnica (V5TC)

/**
 * Velas OHLC. Las combinaciones de rango e intervalo que Yahoo no sirve se rechazan aquí.
 * @param {string} symbol
 * @param {{ range?: import('./types.js').OhlcRange, interval?: import('./types.js').OhlcInterval, compare?: '^MXX' | '^GSPC' | 'SPY' }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getOhlc(symbol, { range = '1y', interval = '1d', compare } = {}, { signal } = {}) {
  const s = normalizeSymbol(symbol)
  oneOf('el periodo', range, OHLC_RANGES)
  oneOf('el intervalo', interval, OHLC_INTERVALS)
  if (!isValidOhlc(range, interval)) throw invalid(`velas de ${interval} para un periodo de ${range}`)
  return v2Get(`/v2/ohlc/${seg(s)}`, { range, interval, compare: oneOf('la referencia', compare, OHLC_COMPARE, { optional: true }) }, { signal })
}

// Movimientos, amplitud y sectores (V5MK)

/**
 * @param {{ market: import('./types.js').Country, kind: 'gainers' | 'losers' | 'active', limit?: number }} params limit de 10 a 50
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getMovers({ market, kind, limit } = /** @type {any} */ ({}), { signal } = {}) {
  const query = {
    market: oneOf('el mercado', market, COUNTRIES),
    kind: oneOf('el tipo de lista', kind, MOVERS_KINDS),
    limit: intIn('el límite', limit, 10, 50, { optional: true }),
  }
  return v2Get('/v2/movers', query, { signal })
}

/** @param {{ market: import('./types.js').Country }} params @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getBreadth({ market } = /** @type {any} */ ({}), { signal } = {}) {
  return v2Get('/v2/breadth', { market: oneOf('el mercado', market, COUNTRIES) }, { signal })
}

/** @param {{ market: import('./types.js').Country }} params @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getSectors({ market } = /** @type {any} */ ({}), { signal } = {}) {
  return v2Get('/v2/sectors', { market: oneOf('el mercado', market, COUNTRIES) }, { signal })
}

// Empresas (V5EM)

/** @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getReferenceMx({ signal } = {}) {
  return v2Get('/v2/reference/mx', undefined, { signal })
}

/**
 * Factor de actualización entre dos meses del INPC.
 * @param {{ from: string, to: string }} params AAAA-MM
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getUpdateFactor({ from, to } = /** @type {any} */ ({}), { signal } = {}) {
  const f = month('el mes inicial', from)
  const t = month('el mes final', to)
  if (f > t) throw invalid(`un mes inicial (${f}) posterior al final (${t})`)
  return v2Get('/v2/reference/mx/update-factor', { from: f, to: t }, { signal })
}

/** @param {{ market: 'US' | 'EM' }} params @param {CallOptions} [options] @returns {Promise<V5Response>} */
export async function getIndustries({ market } = /** @type {any} */ ({}), { signal } = {}) {
  return v2Get('/v2/business/industries', { market: oneOf('el mercado', market, INDUSTRY_MARKETS) }, { signal })
}

/**
 * @param {string} symbol
 * @param {{ years?: 3 | 5 }} [params]
 * @param {CallOptions} [options]
 * @returns {Promise<V5Response>}
 */
export async function getCreditHealth(symbol, { years } = {}, { signal } = {}) {
  const s = normalizeSymbol(symbol)
  return v2Get(`/v2/credit-health/${seg(s)}`, { years: oneOf('los años', years, CREDIT_HEALTH_YEARS, { optional: true }) }, { signal })
}
