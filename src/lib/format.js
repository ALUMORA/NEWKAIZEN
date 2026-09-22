// Formato de números, dinero, porcentajes y fechas para es-MX. Reglas de la casa:
// - El dato faltante se muestra "s/d" (sin dato), nunca un guion largo ni "NaN".
// - El signo negativo es U+2212 (−), no el guion ASCII: se alinea con "+" y no se parte al final
//   de una línea.
// - Las fechas se muestran en la zona de la Ciudad de México y con meses de tres letras fijos
//   (ene, feb, ..., sep, ..., dic); no dependen de la versión de ICU del navegador.
// - Los colores de subida y bajada nunca van solos: signOf() da la dirección y el componente
//   también muestra el signo (y, si quiere, una flecha).

export const MISSING = 's/d'
export const MINUS = '\u2212'
/** Múltiplo negativo: no significativo (p. ej. P/U con utilidad negativa). */
export const NOT_MEANINGFUL = 'n/s'
export const NOT_MEANINGFUL_TITLE = 'No significativo: el múltiplo es negativo porque la utilidad o el flujo del denominador son negativos.'
export const TIME_ZONE = 'America/Mexico_City'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** @param {unknown} value @returns {value is number} */
export function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Acepta números y cadenas numéricas; todo lo demás es faltante. */
function toNum(value) {
  if (isNum(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

const formatters = new Map()
function grouped(decimals) {
  let f = formatters.get(decimals)
  if (!f) {
    f = new Intl.NumberFormat('es-MX', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: true,
    })
    formatters.set(decimals, f)
  }
  return f
}

/** Redondeo que no deja "−0.00": un valor que redondea a cero se vuelve cero. */
function roundTo(value, decimals) {
  const factor = 10 ** decimals
  const r = Math.round(Math.abs(value) * factor) / factor
  return r === 0 ? 0 : Math.sign(value) * r
}

function signPrefix(rounded, sign) {
  if (rounded < 0) return MINUS
  if (sign && rounded > 0) return '+'
  return ''
}

/** Escalas cortas en español: mil, millón (M), mil millones (mil M), billón (B = 10^12). */
const COMPACT_STEPS = [
  { div: 1e3, suffix: 'mil' },
  { div: 1e6, suffix: 'M' },
  { div: 1e9, suffix: 'mil M' },
  { div: 1e12, suffix: 'B' },
]

/**
 * Valor absoluto con agrupación y, si se pide, escala compacta.
 * @returns {{ text: string, rounded: number }}
 */
function magnitude(value, decimals, compact) {
  if (compact) {
    const abs = Math.abs(value)
    const fmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: decimals, minimumFractionDigits: 0 })
    let idx = -1
    COMPACT_STEPS.forEach((step, i) => {
      if (abs >= step.div) idx = i
    })
    let scaled = roundTo(idx < 0 ? abs : abs / COMPACT_STEPS[idx].div, decimals)
    // 999.96 o 999,960 redondean a "1,000" de su escala: se sube a la siguiente ("1 mil", "1 M").
    if (scaled >= 1000 && idx < COMPACT_STEPS.length - 1) {
      idx += 1
      scaled = roundTo(abs / COMPACT_STEPS[idx].div, decimals)
    }
    const text = idx < 0 ? fmt.format(scaled) : `${fmt.format(scaled)} ${COMPACT_STEPS[idx].suffix}`
    return { text, rounded: scaled === 0 ? 0 : Math.sign(value) * scaled }
  }
  const rounded = roundTo(value, decimals)
  return { text: grouped(decimals).format(Math.abs(rounded)), rounded }
}

/**
 * Número con agrupación es-MX. Compacto: "153.9 mil", "1.2 M", "3.4 mil M", "2.5 B".
 * @param {unknown} value
 * @param {{ decimals?: number, compact?: boolean, sign?: boolean }} [options]
 *   decimals: por defecto 2 (1 en compacto); sign: antepone "+" a positivos
 */
export function fmtNumber(value, { decimals, compact = false, sign = false } = {}) {
  const n = toNum(value)
  if (n === null) return MISSING
  const d = decimals ?? (compact ? 1 : 2)
  const { text, rounded } = magnitude(n, d, compact)
  return `${signPrefix(rounded, sign)}${text}`
}

/** Entero con agrupación: "12,345". */
export function fmtInt(value, { sign = false } = {}) {
  return fmtNumber(value, { decimals: 0, sign })
}

const CURRENCY_SYMBOL = { MXN: '$', USD: '$', CAD: '$', EUR: '€', GBP: '£', JPY: '¥' }

/**
 * Dinero con el código de moneda al final: "$1,234.56 MXN", "−$1,141.00 USD",
 * compacto "$1.2 M MXN". Sin moneda conocida: "1,234.56 CHF".
 * @param {unknown} value
 * @param {string} [currency] código ISO (MXN por defecto)
 * @param {{ decimals?: number, compact?: boolean, sign?: boolean }} [options]
 */
export function fmtMoney(value, currency = 'MXN', { decimals, compact = false, sign = false } = {}) {
  const n = toNum(value)
  if (n === null) return MISSING
  const d = decimals ?? (compact ? 1 : 2)
  const { text, rounded } = magnitude(n, d, compact)
  const code = String(currency || '').toUpperCase()
  const symbol = CURRENCY_SYMBOL[code] ?? ''
  const suffix = code ? ` ${code}` : ''
  return `${signPrefix(rounded, sign)}${symbol}${text}${suffix}`
}

/**
 * Fracción como porcentaje: 0.0123 → "1.23%"; con sign "+1.23%"; −0.0045 → "−0.45%".
 * @param {unknown} fraction
 * @param {{ decimals?: number, sign?: boolean }} [options]
 */
export function fmtPct(fraction, { decimals = 2, sign = false } = {}) {
  const n = toNum(fraction)
  if (n === null) return MISSING
  const { text, rounded } = magnitude(n * 100, decimals, false)
  return `${signPrefix(rounded, sign)}${text}%`
}

/**
 * Diferencia entre dos fracciones en puntos porcentuales, siempre con signo:
 * 0.0035 → "+0.35 pp".
 * @param {unknown} fractionDiff
 * @param {{ decimals?: number }} [options]
 */
export function fmtPp(fractionDiff, { decimals = 2 } = {}) {
  const n = toNum(fractionDiff)
  if (n === null) return MISSING
  const { text, rounded } = magnitude(n * 100, decimals, false)
  return `${signPrefix(rounded, true)}${text} pp`
}

/**
 * Puntos base, siempre con signo: 12 → "+12 pb", −25 → "−25 pb".
 * @param {unknown} bp
 * @param {{ decimals?: number }} [options]
 */
export function fmtBp(bp, { decimals = 0 } = {}) {
  const n = toNum(bp)
  if (n === null) return MISSING
  const { text, rounded } = magnitude(n, decimals, false)
  return `${signPrefix(rounded, true)}${text} pb`
}

/**
 * Múltiplo: 15.63 → "15.6x". Negativo → "n/s" (usar NOT_MEANINGFUL_TITLE como title).
 * @param {unknown} x
 * @param {{ decimals?: number }} [options]
 */
export function fmtMultiple(x, { decimals = 1 } = {}) {
  const n = toNum(x)
  if (n === null) return MISSING
  if (n < 0) return NOT_MEANINGFUL
  return `${grouped(decimals).format(roundTo(n, decimals))}x`
}

/**
 * Igual que fmtMultiple pero con el title para el caso "n/s".
 * @param {unknown} x
 * @param {{ decimals?: number }} [options]
 * @returns {{ text: string, title: string | undefined }}
 */
export function describeMultiple(x, options) {
  const text = fmtMultiple(x, options)
  return { text, title: text === NOT_MEANINGFUL ? NOT_MEANINGFUL_TITLE : undefined }
}

// ─── Fechas ─────────────────────────────────────────────────────────────────

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
// La misma fecha, pero al principio de una cadena que puede seguir con "T10:00:00Z".
const DATE_HEAD = /^\d{4}-\d{2}-\d{2}/

/**
 * Fecha de calendario YYYY-MM-DD que de verdad existe. La forma no basta: "2026-02-31" y
 * "2026-13-01" la cumplen y el navegador los corre al 3 de marzo y al enero siguiente. La prueba
 * es la vuelta completa en UTC (misma idea que isIsoDate de storage.js): si el texto que sale no
 * es el que entró, la fecha no existía. Una fecha imposible no se dibuja como si fuera buena: se
 * muestra "s/d".
 * @param {string} value
 * @returns {{ year: number, month: number, day: number } | null}
 */
function calendarDate(value) {
  const m = DATE_ONLY.exec(value)
  if (!m) return null
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * Fecha y hora en la Ciudad de México como números.
 * @param {Date} date
 */
function cdmxParts(date) {
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  }
}

/**
 * Milisegundos UTC de una fecha y hora, cuidando los años de menos de tres cifras: Date.UTC(50, …)
 * significa 1950, no el año 50.
 */
function utcMs(year, month, day, hour = 0, minute = 0) {
  const ms = Date.UTC(year, month - 1, day, hour, minute)
  if (year >= 0 && year < 100) {
    const d = new Date(ms)
    d.setUTCFullYear(year)
    return d.getTime()
  }
  return ms
}

/**
 * Las 00:00 de una fecha de calendario en la Ciudad de México, como instante. Se arma en UTC y se
 * corrige con el desfase que la zona reporta ahí mismo; con una corrección basta, porque México ya
 * no cambia de horario (y aun con cambio el error quedaría dentro de la hora del salto).
 * @param {{ year: number, month: number, day: number }} cal
 */
function cdmxStartOfDay(cal) {
  const guess = utcMs(cal.year, cal.month, cal.day)
  const p = cdmxParts(new Date(guess))
  return new Date(guess + (guess - utcMs(p.year, p.month, p.day, p.hour, p.minute)))
}

/** "19 sep 2026" a partir de una fecha de calendario. */
function calendarText(cal) {
  return `${cal.day} ${MONTHS[cal.month - 1]} ${cal.year}`
}

/**
 * ¿El valor es una fecha sola (YYYY-MM-DD, sin hora)? Devuelve el texto y su fecha de calendario,
 * que es null cuando la fecha no existe ("2026-02-31"). null si no tiene esa forma.
 * @param {unknown} value
 */
function asDateOnly(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return DATE_ONLY.test(text) ? { text, cal: calendarDate(text) } : null
}

/** @param {unknown} value @returns {Date | null} */
function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (isNum(value)) return new Date(value)
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim()
    // Toda cadena que empiece con YYYY-MM-DD pasa primero por la validación estricta, traiga
    // hora o no: así fmtDateTime y fmtRelative tampoco aceptan un 31 de febrero, que si no V8
    // corre al 3 de marzo. Las fechas del API llegan como instantes ISO completos, no solas.
    const head = DATE_HEAD.exec(text)
    if (head && !calendarDate(head[0])) return null
    const d = new Date(text)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * "19 sep 2026". Una fecha sola (YYYY-MM-DD) se toma como fecha de calendario, sin moverla de
 * zona; un instante se muestra en la fecha de la Ciudad de México. Una fecha que no existe
 * ("2026-02-31") da "s/d", no el 3 de marzo.
 * @param {unknown} value ISO, Date o epoch en ms
 */
export function fmtDate(value) {
  const only = asDateOnly(value)
  if (only) return only.cal ? calendarText(only.cal) : MISSING
  const d = toDate(value)
  if (!d) return MISSING
  const p = cdmxParts(d)
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`
}

/**
 * "19 sep 2026, 14:05" en la Ciudad de México (reloj de 24 h).
 *
 * Una fecha sola (YYYY-MM-DD) no trae hora, así que se dibuja como fecha de calendario, exactamente
 * igual que en fmtDate y sin inventarle un "00:00". Antes se construía new Date('2024-02-29'), o
 * sea medianoche UTC, y la Ciudad de México la bajaba al día anterior a las 18:00: el mismo valor
 * salía "29 feb 2024" con fmtDate y "28 feb 2024, 18:00" con fmtDateTime. Importa porque los
 * movimientos del storage guardan la fecha sola (date: 'YYYY-MM-DD').
 * @param {unknown} value
 */
export function fmtDateTime(value) {
  const only = asDateOnly(value)
  if (only) return only.cal ? calendarText(only.cal) : MISSING
  const d = toDate(value)
  if (!d) return MISSING
  const p = cdmxParts(d)
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/**
 * "hace 5 min", "hace 3 h", "hace 2 días"; en el futuro "en 5 min". Más de 30 días: la fecha.
 *
 * Una fecha sola (YYYY-MM-DD) se ancla a las 00:00 de ese día en la Ciudad de México, no a la
 * medianoche UTC: si no, "2026-09-19" se contaba desde las 18:00 del 18 y la fecha de respaldo
 * salía un día antes que la de fmtDate.
 * @param {unknown} value
 * @param {number | Date} [now]
 */
export function fmtRelative(value, now = Date.now()) {
  const only = asDateOnly(value)
  if (only && !only.cal) return MISSING
  const d = only ? cdmxStartOfDay(only.cal) : toDate(value)
  if (!d) return MISSING
  const nowMs = now instanceof Date ? now.getTime() : now
  const diff = nowMs - d.getTime()
  const future = diff < 0
  const abs = Math.abs(diff)
  const wrap = (text) => (future ? `en ${text}` : `hace ${text}`)
  if (abs < 45_000) return future ? 'en unos segundos' : 'hace unos segundos'
  const minutes = Math.round(abs / 60_000)
  if (minutes < 60) return wrap(`${Math.max(1, minutes)} min`)
  const hours = Math.round(abs / 3_600_000)
  if (hours < 24) return wrap(`${hours} h`)
  const days = Math.round(abs / 86_400_000)
  if (days <= 30) return wrap(days === 1 ? '1 día' : `${days} días`)
  return only ? calendarText(only.cal) : fmtDate(d)
}

/**
 * Dirección para colorear: "up", "down" o "flat" (también para faltantes).
 * @param {unknown} value
 * @param {number} [epsilon] |valor| <= epsilon cuenta como plano
 * @returns {'up' | 'down' | 'flat'}
 */
export function signOf(value, epsilon = 0) {
  const n = toNum(value)
  if (n === null || Math.abs(n) <= epsilon) return 'flat'
  return n > 0 ? 'up' : 'down'
}
