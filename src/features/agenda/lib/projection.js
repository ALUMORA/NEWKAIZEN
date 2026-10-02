// Proyección de ingresos por dividendos de la agenda (V5PF). Módulo puro: sin React, sin fetch y
// sin Date.now(); la fecha de hoy entra por parámetro.
//
// Por cada posición con resumen de dividendos: cantidad × último dividendo pagado en cada mes de
// paidMonths, en los próximos 12 meses. Si el dividendo es en dólares se pasa a pesos con el tipo de
// cambio que se reciba (sin él, la emisora queda fuera y se avisa). El neto resta la retención
// informativa de dividendWithholding (10%, LISR art. 140). El monto futuro no se conoce: se usa el
// último pagado y así se etiqueta en pantalla.
import { dividendWithholding } from '../../../lib/finance/tax-mx.js'

/** @typedef {import('../types.js').DividendSummary} DividendSummary */
/** @typedef {import('../types.js').Projection} Projection */
/** @typedef {import('../types.js').ProjectionRow} ProjectionRow */
/** @typedef {import('../types.js').AgendaEvent} AgendaEvent */
/** @typedef {import('../types.js').AgendaOrigin} AgendaOrigin */

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/**
 * Los 12 meses que empiezan en el de `today`.
 * @param {string} today AAAA-MM-DD
 * @returns {{ key: string, label: string, month: number }[]}
 */
export function nextTwelveMonths(today) {
  const year = Number(today.slice(0, 4))
  const month0 = Number(today.slice(5, 7)) - 1
  return Array.from({ length: 12 }, (_, i) => {
    const m = (month0 + i) % 12
    const y = year + Math.floor((month0 + i) / 12)
    return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTHS_SHORT[m]} ${String(y).slice(2)}`, month: m + 1 }
  })
}

/** "octubre de 2026" para AAAA-MM. @param {string} key */
export function monthTitle(key) {
  const m = Number(key.slice(5, 7)) - 1
  return `${MONTHS_LONG[m] ?? key} de ${key.slice(0, 4)}`
}

/**
 * @param {{
 *   positions: { symbol: string, quantity: number }[],
 *   summaries: DividendSummary[] | null | undefined,
 *   usdmxn: number | null | undefined,
 *   today: string,
 *   withholdingRate?: number,
 * }} input
 * @returns {Projection}
 */
export function projectDividends({ positions, summaries, usdmxn, today, withholdingRate }) {
  const months = nextTwelveMonths(today).map((m) => ({ ...m, gross: 0, net: 0 }))
  const bySymbol = new Map((summaries ?? []).map((s) => [String(s.symbol).toUpperCase(), s]))
  const rate = isNum(usdmxn) && usdmxn > 0 ? usdmxn : null
  const withholding = dividendWithholding(1, withholdingRate === undefined ? {} : { rate: withholdingRate })
  const netFactor = withholding ? withholding.net : 0.9
  let fxMissing = false
  /** @type {ProjectionRow[]} */
  const rows = positions.map((p) => {
    const s = bySymbol.get(String(p.symbol).toUpperCase())
    const perPayment = s && isNum(s.lastPaidAmount) && s.lastPaidAmount > 0 ? s.lastPaidAmount : null
    const paidMonths = s && Array.isArray(s.paidMonths) ? [...new Set(s.paidMonths.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b) : []
    const currency = s?.currency ?? null
    const isUsd = currency === 'USD'
    const factor = isUsd ? rate : 1
    const rowFxMissing = perPayment !== null && isUsd && factor === null
    if (rowFxMissing) fxMissing = true
    const perPaymentMxn = perPayment !== null && factor !== null ? perPayment * factor : null
    const missing = perPayment === null || paidMonths.length === 0
    let annualGross = 0
    if (!missing && perPaymentMxn !== null) {
      const payment = p.quantity * perPaymentMxn
      for (const m of months) {
        if (paidMonths.includes(m.month)) {
          m.gross += payment
          m.net += payment * netFactor
          annualGross += payment
        }
      }
    }
    return {
      symbol: p.symbol,
      quantity: p.quantity,
      currency,
      perPayment,
      perPaymentMxn,
      paidMonths,
      frequency: s?.frequency ?? null,
      annualGross,
      annualNet: annualGross * netFactor,
      missing,
      fxMissing: rowFxMissing,
    }
  })
  const totalGross = rows.reduce((a, r) => a + r.annualGross, 0)
  return { months, rows, totalGross, totalNet: totalGross * netFactor, fxMissing, rate: withholding ? withholding.rate : 0.1 }
}

/**
 * Origen de cada símbolo: portafolio, lista o los dos.
 * @param {string[]} portfolio
 * @param {string[]} list
 * @returns {Map<string, AgendaOrigin>}
 */
export function originMap(portfolio, list) {
  const p = new Set(portfolio.map((s) => s.toUpperCase()))
  const l = new Set(list.map((s) => s.toUpperCase()))
  /** @type {Map<string, AgendaOrigin>} */
  const out = new Map()
  for (const s of [...p, ...l]) out.set(s, p.has(s) && l.has(s) ? 'ambos' : p.has(s) ? 'portafolio' : 'lista')
  return out
}

/**
 * Eventos entre hoy y hoy + days (inclusive), en orden de fecha, con su origen.
 * @param {AgendaEvent[] | null | undefined} items
 * @param {{ today: string, days: number, origins: Map<string, AgendaOrigin>, filter?: 'ambos' | 'portafolio' | 'lista' }} options
 */
export function upcomingEvents(items, { today, days, origins, filter = 'ambos' }) {
  const end = addDays(today, days)
  return (items ?? [])
    .filter((e) => typeof e?.date === 'string' && e.date.slice(0, 10) >= today && e.date.slice(0, 10) <= end)
    .map((e) => ({ ...e, date: e.date.slice(0, 10), origin: origins.get(String(e.symbol).toUpperCase()) ?? 'lista' }))
    .filter((e) => filter === 'ambos' || e.origin === filter || e.origin === 'ambos')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.symbol < b.symbol ? -1 : 1))
}

/**
 * Agrupa eventos ya ordenados por mes (AAAA-MM).
 * @template {{ date: string }} T
 * @param {T[]} events
 * @returns {{ key: string, events: T[] }[]}
 */
export function groupByMonth(events) {
  /** @type {Map<string, T[]>} */
  const map = new Map()
  for (const e of events) {
    const key = e.date.slice(0, 7)
    const list = map.get(key) ?? []
    list.push(e)
    map.set(key, list)
  }
  return [...map.entries()].map(([key, list]) => ({ key, events: list }))
}

/** @param {string} iso AAAA-MM-DD @param {number} days */
export function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const EVENT_LABELS = /** @type {const} */ ({ earnings: 'Reporte', exDividend: 'Ex dividendo', dividendPay: 'Pago' })
