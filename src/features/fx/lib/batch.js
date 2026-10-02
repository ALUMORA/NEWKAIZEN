// Conversión por lote de pagos en dólares a pesos con el FIX de Banxico (V5FX, /empresas/tipo-de-cambio).
// Funciones puras: leer el CSV que sube la persona (fecha, monto en USD), sacar el rango de fechas
// para pedir una sola tabla de FIX y cruzar cada renglón con la fila de esa fecha.
import { detectDelimiter, parseCSV, parseLocaleNumber, toCSV } from '../../../lib/csv.js'

/** Tope de la tabla de FIX del API: 3 × 366 días (endpoints.js y fxdesk.FIX_TABLE_MAX_DAYS). */
export const BATCH_MAX_DAYS = 3 * 366
/** Tope de renglones por lote, para que la previa y la descarga no congelen el navegador. */
export const BATCH_MAX_ROWS = 5000
/** Encabezados del CSV de salida. */
export const BATCH_HEADER = ['fecha', 'monto_usd', 'fix_fecha', 'tipo_de_cambio', 'monto_mxn']

const DATE_NAMES = ['fecha', 'date', 'fecha_pago', 'fecha de pago']
const AMOUNT_NAMES = ['monto', 'monto_usd', 'monto usd', 'usd', 'importe', 'amount']

/** @param {number} y @param {number} m @param {number} d */
function isoIfValid(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Fecha escrita como AAAA-MM-DD o DD/MM/AAAA (la de México) → AAAA-MM-DD, o null si no existe.
 * @param {unknown} text
 */
export function parseBatchDate(text) {
  const s = String(text ?? '').trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return isoIfValid(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) return isoIfValid(Number(m[3]), Number(m[2]), Number(m[1]))
  return null
}

/**
 * Separador del lote. Con un monto como "1.000,25" la primera línea trae una coma y un punto y
 * coma, y el empate de detectDelimiter cae en la coma: aquí el punto y coma gana, porque con él la
 * coma solo puede ser decimal (así guarda Excel en español).
 * @param {string} text
 */
export function batchDelimiter(text) {
  const first = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  if (first.includes(';')) return ';'
  return detectDelimiter(text)
}

/**
 * @typedef {{ line: number, date: string, amountUsd: number }} BatchRow
 * @typedef {{ line: number, message: string }} BatchError
 * @typedef {{ rows: BatchRow[], errors: BatchError[] }} ParsedBatch
 */

/**
 * Lee el CSV del lote. Acepta encabezado (fecha, monto) o ninguno (primera columna fecha, segunda
 * monto), coma, punto y coma o tabulador, y montos como "1,000.50" o "1.000,50".
 * @param {string} text
 * @returns {ParsedBatch}
 */
export function parseBatch(text) {
  const delimiter = batchDelimiter(text)
  const table = parseCSV(text, { delimiter, unguard: true })
  /** @type {BatchRow[]} */
  const rows = []
  /** @type {BatchError[]} */
  const errors = []
  if (!table.length) return { rows, errors: [{ line: 0, message: 'El archivo está vacío.' }] }
  let dateCol = 0
  let amountCol = 1
  let start = 0
  const head = table[0].map((h) => h.trim().toLowerCase())
  if (!parseBatchDate(table[0][0])) {
    const d = head.findIndex((h) => DATE_NAMES.includes(h))
    const a = head.findIndex((h) => AMOUNT_NAMES.includes(h))
    if (d >= 0) dateCol = d
    if (a >= 0) amountCol = a
    start = 1
  }
  for (let i = start; i < table.length; i += 1) {
    const line = i + 1
    const cells = table[i]
    if (cells.every((c) => c.trim() === '')) continue
    if (rows.length >= BATCH_MAX_ROWS) {
      errors.push({ line, message: `El lote admite hasta ${BATCH_MAX_ROWS.toLocaleString('es-MX')} renglones; el resto no se leyó.` })
      break
    }
    const date = parseBatchDate(cells[dateCol])
    const amount = parseLocaleNumber(cells[amountCol], { decimalComma: delimiter === ';' })
    if (!date) {
      errors.push({ line, message: `Renglón ${line}: la fecha "${cells[dateCol] ?? ''}" no se entiende. Usa AAAA-MM-DD o DD/MM/AAAA.` })
      continue
    }
    if (amount === null || !Number.isFinite(amount)) {
      errors.push({ line, message: `Renglón ${line}: el monto "${cells[amountCol] ?? ''}" no es un número.` })
      continue
    }
    rows.push({ line, date, amountUsd: amount })
  }
  if (!rows.length && !errors.length) errors.push({ line: 0, message: 'El archivo no trae renglones con fecha y monto.' })
  return { rows, errors }
}

/** @param {string} a @param {string} b días naturales de a a b */
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/**
 * Rango de fechas del lote para pedir una sola tabla de FIX. `tooLong` si pasa de 3 años.
 * @param {BatchRow[]} rows
 * @returns {{ start: string, end: string, days: number, tooLong: boolean } | null}
 */
export function batchRange(rows) {
  if (!rows.length) return null
  let start = rows[0].date
  let end = rows[0].date
  for (const r of rows) {
    if (r.date < start) start = r.date
    if (r.date > end) end = r.date
  }
  const days = daysBetween(start, end)
  return { start, end, days, tooLong: days > BATCH_MAX_DAYS }
}

/** @param {number} n */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * @typedef {{ line: number, date: string, amountUsd: number, fixDate: string | null,
 *   rate: number | null, amountMxn: number | null }} ConvertedRow
 */

/**
 * Cruza cada renglón con la fila de la tabla de FIX de su misma fecha (`rows[i].date`). Sin fila o
 * con `value: null`, el tipo y el monto en pesos quedan null (la pantalla dice s/d).
 * @param {BatchRow[]} rows
 * @param {{ date: string, fixDate: string | null, value: number | null }[]} fixRows
 * @returns {ConvertedRow[]}
 */
export function convertBatch(rows, fixRows) {
  const byDate = new Map((fixRows ?? []).map((r) => [r.date, r]))
  return rows.map((r) => {
    const fix = byDate.get(r.date)
    const rate = fix && Number.isFinite(fix.value) ? fix.value : null
    return {
      line: r.line,
      date: r.date,
      amountUsd: r.amountUsd,
      fixDate: rate === null ? null : fix.fixDate ?? null,
      rate,
      amountMxn: rate === null ? null : round2(r.amountUsd * rate),
    }
  })
}

/**
 * Totales del lote: dólares, pesos de los renglones con tipo y cuántos quedaron sin tipo.
 * @param {ConvertedRow[]} converted
 */
export function batchTotals(converted) {
  let usd = 0
  let mxn = 0
  let missing = 0
  for (const r of converted) {
    usd += r.amountUsd
    if (r.amountMxn === null) missing += 1
    else mxn += r.amountMxn
  }
  return { usd: round2(usd), mxn: round2(mxn), missing, count: converted.length }
}

/**
 * CSV de salida (con BOM para Excel): fecha, monto_usd, fix_fecha, tipo_de_cambio, monto_mxn.
 * Los faltantes van como "s/d", igual que en pantalla.
 * @param {ConvertedRow[]} converted
 */
export function batchToCSV(converted) {
  const body = converted.map((r) => [
    r.date,
    r.amountUsd.toFixed(2),
    r.fixDate ?? 's/d',
    r.rate === null ? 's/d' : r.rate.toFixed(4),
    r.amountMxn === null ? 's/d' : r.amountMxn.toFixed(2),
  ])
  return toCSV([BATCH_HEADER, ...body])
}
