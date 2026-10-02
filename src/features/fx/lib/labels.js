// Textos y formatos compartidos por las tres pantallas de tipo de cambio.
import { MINUS, fmtNumber, isNum } from '../../../lib/format.js'

/** Hoy en la Ciudad de México, AAAA-MM-DD. */
export function todayMx(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** @param {string} iso @param {number} years */
export function yearsBefore(iso, years) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y - years, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0)
  return dt.toISOString().slice(0, 10)
}

/** Tipo de cambio con cuatro decimales, como lo publica Banxico: "18.3021". */
export function fmtRate(value) {
  return fmtNumber(value, { decimals: 4 })
}

/** Centavos con signo: "+15.00 centavos", "−3.20 centavos". */
export function fmtCents(value) {
  if (!isNum(value)) return 's/d'
  return `${fmtNumber(value, { decimals: 2, sign: true })} centavos`
}

/** Pista del movimiento del dólar frente al peso (sin bueno ni malo). */
export function pesoHint(value) {
  if (!isNum(value) || Math.abs(value) < 0.005) return 'sin cambio'
  return value > 0 ? 'peso más débil' : 'peso más fuerte'
}

export const PROVIDER_LABEL = {
  banxico: 'Banxico',
  ecb: 'BCE vía Frankfurter',
  mezcla: 'Bancos centrales vía Frankfurter',
}

export const PAIR_LABEL = {
  EURMXN: 'Euro',
  JPYMXN: 'Yen japonés',
  GBPMXN: 'Libra esterlina',
  CNYMXN: 'Yuan chino',
  CADMXN: 'Dólar canadiense',
  BRLMXN: 'Real brasileño',
  COPMXN: 'Peso colombiano',
  CLPMXN: 'Peso chileno',
  ARSMXN: 'Peso argentino',
  PENMXN: 'Sol peruano',
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** "2026-09" → "sep 2026". */
export function fmtMonth(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ''))
  if (!m) return 's/d'
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** Contratos con signo y agrupación: "+75,167", "−12,615". */
export function fmtContracts(value) {
  return fmtNumber(value, { decimals: 0, sign: true })
}

export { MINUS }
