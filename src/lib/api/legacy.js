// Adaptadores del API viejo (v1) a la forma del v2, para la transición mientras Render siga con
// el backend anterior. Solo se usan si VITE_ALLOW_LEGACY=true y /health dijo "legacy"
// (endpoints.js decide). Cubren lo mínimo: historia, cotizaciones, tipo de cambio y tasa libre
// de riesgo. Todo lo demás del v2 no existe en el servidor viejo.
//
// El v1 contesta HTTP 200 con {"error": "..."} cuando falla: aquí se convierte en ApiError 502.
// Tampoco se aceptan sus valores fijos (USD/MXN 17.5, rf 8.6 %): el contrato v2 prohíbe
// presentarlos como dato, así que se responde 503 como lo haría el v2.
import { apiFetch } from './client.js'
import { ApiError } from './http.js'

const V1_PERIODS = ['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y']
// Intervalo que usa get_chart del backend viejo para cada periodo.
const V1_INTERVAL = { '1mo': '1d', '3mo': '1d', '6mo': '1wk', '1y': '1wk', '2y': '1wk', '5y': '1wk', '10y': '1wk' }

/**
 * @param {{ asOf?: string | null, fallback?: boolean, notes?: string[] }} [init]
 * @returns {import('./types.js').Meta}
 */
function legacyMeta({ asOf = null, fallback = false, notes = [] } = {}) {
  return {
    asOf,
    source: 'legacy',
    delayMinutes: null,
    stale: false,
    fallback,
    generatedAt: new Date().toISOString(),
    notes: ['Dato del servidor anterior (API v1).', ...notes],
  }
}

function upstreamError(raw) {
  return new ApiError({
    status: 502,
    code: 'UPSTREAM_UNAVAILABLE',
    message: 'El servidor anterior no pudo obtener este dato.',
    details: raw ? { raw: String(raw).slice(0, 300) } : null,
  })
}

function noRealValue(what) {
  return new ApiError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message: `No hay un dato real de ${what} en este momento.`,
  })
}

/** El v1 señala errores con {"error": ...} y status 200. */
function unwrap(body) {
  if (!body || typeof body !== 'object') throw upstreamError(body)
  if (body.error) throw upstreamError(body.error)
  return body
}

const isMx = (symbol) => symbol.toUpperCase().endsWith('.MX')

/**
 * /chart/{s}?period&ccy=MXN → HistoryResponse sin fechas por punto (dates: null).
 * @param {string} symbol
 * @param {{ range?: string, ccy?: 'native' | 'MXN' | 'USD' }} [params]
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('./types.js').HistoryResponse>}
 */
export async function legacyHistory(symbol, { range = '1y', ccy = 'native' } = {}, { signal } = {}) {
  const notes = ['alineación aproximada']
  let period = range
  if (!V1_PERIODS.includes(period)) {
    period = '10y'
    notes.push('El servidor anterior da como máximo 10 años.')
  }
  if (ccy === 'USD' && isMx(symbol)) {
    throw new ApiError({ status: 501, code: 'NOT_IMPLEMENTED', message: 'El servidor anterior no convierte a dólares.' })
  }
  const body = unwrap(
    await apiFetch(`/chart/${encodeURIComponent(symbol)}`, {
      query: { period, ccy: ccy === 'MXN' ? 'MXN' : undefined },
      signal,
      auth: false,
    }),
  )
  const close = Array.isArray(body.closes) ? body.closes.filter((v) => typeof v === 'number' && Number.isFinite(v)) : []
  if (close.length === 0) throw upstreamError('sin cierres')
  return {
    symbol: symbol.toUpperCase(),
    currency: typeof body.currency === 'string' ? body.currency : isMx(symbol) ? 'MXN' : 'USD',
    interval: /** @type {import('./types.js').Interval} */ (V1_INTERVAL[period] ?? '1wk'),
    adjusted: true,
    dates: null,
    close,
    fx: ccy === 'MXN' && !isMx(symbol) ? { pair: 'USDMXN', source: 'yahoo' } : null,
    meta: legacyMeta({ notes }),
  }
}

/**
 * /stock/{s} por cada símbolo → QuotesResponse. Solo trae precio: sin cambio del día.
 * @param {string[]} symbols
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('./types.js').QuotesResponse>}
 */
export async function legacyQuotes(symbols, { signal } = {}) {
  const results = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const body = unwrap(await apiFetch(`/stock/${encodeURIComponent(symbol)}`, { signal, auth: false }))
        if (typeof body.price !== 'number' || !Number.isFinite(body.price)) return { symbol, quote: null }
        /** @type {import('./types.js').Quote} */
        const quote = {
          symbol: symbol.toUpperCase(),
          name: typeof body.name === 'string' ? body.name : symbol.toUpperCase(),
          price: body.price,
          previousClose: null,
          change: null,
          changePct: null,
          currency: typeof body.currency === 'string' ? body.currency : isMx(symbol) ? 'MXN' : 'USD',
          exchange: '',
          type: 'equity',
          marketState: null,
          asOf: null,
        }
        return { symbol, quote }
      } catch (err) {
        if (signal?.aborted) throw err
        return { symbol, quote: null }
      }
    }),
  )
  return {
    quotes: results.filter((r) => r.quote).map((r) => /** @type {import('./types.js').Quote} */ (r.quote)),
    missing: results.filter((r) => !r.quote).map((r) => r.symbol.toUpperCase()),
    meta: legacyMeta({ notes: ['Sin cambio del día ni hora de la cotización.'] }),
  }
}

/**
 * /fx → FxResponse. El 17.5 fijo del v1 no se acepta.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('./types.js').FxResponse>}
 */
export async function legacyFx({ signal } = {}) {
  const body = unwrap(await apiFetch('/fx', { signal, auth: false }))
  if (body.fallback || typeof body.USDMXN !== 'number' || !Number.isFinite(body.USDMXN)) throw noRealValue('tipo de cambio')
  return {
    pair: 'USDMXN',
    rate: body.USDMXN,
    asOf: null,
    source: 'yahoo',
    stale: false,
    meta: legacyMeta({ notes: ['Último cierre de Yahoo (USDMXN=X), no es el FIX de Banxico.'] }),
  }
}

/**
 * /rf → serie constante de un punto, marcada fallback: el v1 solo da el Bono M 10Y del último
 * mes publicado (OCDE vía FRED), no CETES 28.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('./types.js').RiskFreeResponse>}
 */
export async function legacyRiskFree({ signal } = {}) {
  const body = unwrap(await apiFetch('/rf', { signal, auth: false }))
  if (body.fallback || typeof body.rate !== 'number' || !Number.isFinite(body.rate)) throw noRealValue('tasa libre de riesgo')
  const asOf = typeof body.asOf === 'string' ? body.asOf : null
  return {
    tenorDays: 28,
    convention: 'simple_act360',
    dates: [asOf ?? new Date().toISOString().slice(0, 10)],
    values: [body.rate],
    source: 'legacy_bono_m_10y',
    fallback: true,
    meta: legacyMeta({
      asOf,
      fallback: true,
      notes: [`Serie constante: ${typeof body.label === 'string' ? body.label : 'Bono M 10Y'} en lugar de CETES 28.`],
    }),
  }
}
