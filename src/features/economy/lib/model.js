// Lógica pura de las pantallas de economía y calendario: semanas, meses, agrupación y formatos.
import { fmtBp, fmtDate, fmtMoney, fmtNumber, fmtPct, MISSING } from '../../../lib/format.js'

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** @param {string} iso */
function toUtc(iso) {
  return new Date(`${iso}T00:00:00Z`)
}
/** @param {Date} d */
function iso(d) {
  return d.toISOString().slice(0, 10)
}
/** @param {string} date @param {number} days */
export function addDays(date, days) {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}

/** Hoy en la Ciudad de México como YYYY-MM-DD. @param {Date} [now] */
export function todayMx(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Lunes de la semana de una fecha. @param {string} date */
export function mondayOf(date) {
  const d = toUtc(date)
  const dow = (d.getUTCDay() + 6) % 7
  return addDays(date, -dow)
}

/**
 * Ventana que pide la pantalla: semana de lunes a domingo, o el mes calendario completo.
 * @param {'semana' | 'mes'} view @param {string} anchor YYYY-MM-DD
 */
export function windowFor(view, anchor) {
  if (view === 'mes') {
    const start = `${anchor.slice(0, 7)}-01`
    const next = toUtc(start)
    next.setUTCMonth(next.getUTCMonth() + 1)
    return { start, end: addDays(iso(next), -1) }
  }
  const start = mondayOf(anchor)
  return { start, end: addDays(start, 6) }
}

/** Mueve el ancla una semana o un mes. @param {'semana' | 'mes'} view @param {string} anchor @param {number} step */
export function shiftAnchor(view, anchor, step) {
  if (view === 'mes') {
    const d = toUtc(`${anchor.slice(0, 7)}-01`)
    d.setUTCMonth(d.getUTCMonth() + step)
    return iso(d)
  }
  return addDays(mondayOf(anchor), 7 * step)
}

/** Lee ?semana= (fecha válida) o cae a hoy. @param {string | null} raw @param {string} today */
export function parseAnchor(raw, today) {
  if (raw && ISO_RE.test(raw) && !Number.isNaN(toUtc(raw).getTime()) && iso(toUtc(raw)) === raw) return raw
  return today
}

/** ?pais=mx,us a lista válida; vacío o basura a los dos. @param {string | null} raw @returns {('mx' | 'us')[]} */
export function parseCountries(raw) {
  const list = String(raw ?? '').split(',').map((s) => s.trim().toLowerCase())
  /** @type {('mx' | 'us')[]} */
  const out = []
  for (const c of ['mx', 'us']) if (list.includes(c)) out.push(/** @type {'mx' | 'us'} */ (c))
  return out.length ? out : ['mx', 'us']
}

/** Texto del rango: "28 sep 2026 al 4 oct 2026". @param {{ start: string, end: string }} w */
export function windowText(w) {
  return `${fmtDate(w.start)} al ${fmtDate(w.end)}`
}

/**
 * Eventos agrupados por día, en orden.
 * @param {import('../types.js').EconomicEvent[]} events
 * @returns {{ date: string, events: import('../types.js').EconomicEvent[] }[]}
 */
export function groupByDay(events) {
  /** @type {Map<string, import('../types.js').EconomicEvent[]>} */
  const map = new Map()
  for (const ev of events) {
    if (!map.has(ev.date)) map.set(ev.date, [])
    map.get(ev.date)?.push(ev)
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, list]) => ({ date, events: list }))
}

/**
 * Anterior o publicado de un evento según su unidad.
 * @param {number | null} value @param {'fraction' | 'index' | 'thousandsPersons' | null} unit
 */
export function fmtEventValue(value, unit) {
  if (value == null) return MISSING
  if (unit === 'fraction') return fmtPct(value, { decimals: 2 })
  if (unit === 'thousandsPersons') return `${fmtNumber(value, { decimals: 0, sign: true })} mil`
  return fmtNumber(value, { decimals: 2 })
}

export const KIND_LABEL = { decision: 'Decisión', minutes: 'Minuta', release: 'Indicador', report: 'Informe' }
export const COUNTRY_LABEL = { MX: 'México', US: 'EE. UU.' }

/**
 * Valor principal de un indicador del tablero, con su unidad.
 * @param {number | null | undefined} value @param {string} unit
 */
export function fmtIndicator(value, unit) {
  if (value == null) return MISSING
  switch (unit) {
    case 'fraction':
      return fmtPct(value, { decimals: 2 })
    case 'usdMillions':
      return fmtMoney(value * 1e6, 'USD', { compact: true })
    case 'mxnMillions2018':
      return fmtMoney(value * 1e6, 'MXN', { compact: true })
    case 'usdBillionsChained2017':
      return fmtMoney(value * 1e9, 'USD', { compact: true })
    case 'usdPerBarrel':
      return fmtMoney(value, 'USD', { decimals: 2 })
    case 'thousandsPersons':
      return fmtNumber(value * 1000, { compact: true })
    default:
      return fmtNumber(value, { decimals: 2 })
  }
}

/** Aclaración de la unidad bajo la cifra. @param {string} unit */
export function unitNote(unit) {
  return {
    usdMillions: 'dólares',
    mxnMillions2018: 'pesos de 2018',
    usdBillionsChained2017: 'dólares encadenados de 2017',
    usdPerBarrel: 'por barril',
    thousandsPersons: 'personas empleadas',
  }[unit] ?? ''
}

/** Formato de la gráfica según la unidad. @param {string} unit @returns {'pct' | 'number' | 'money'} */
export function chartFormat(unit) {
  if (unit === 'fraction') return 'pct'
  if (unit === 'usdPerBarrel') return 'money'
  return 'number'
}

/** Celda del comparador de países. @param {number | null} value @param {'usd' | 'fraction'} unit */
export function fmtWorld(value, unit) {
  if (value == null) return MISSING
  return unit === 'usd' ? fmtMoney(value, 'USD', { compact: true }) : fmtPct(value, { decimals: 1 })
}

/** "Faltan 35 días", "Hoy", "Mañana". @param {number | null | undefined} days */
export function countdownText(days) {
  if (days == null) return MISSING
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Mañana'
  return `${days} días`
}

export { fmtBp }
