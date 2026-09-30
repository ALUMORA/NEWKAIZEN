// Lectura de movimientos desde un CSV. Es el único parser: lo usan la bienvenida y Movimientos,
// así que el mismo archivo da los mismos movimientos por las dos puertas.
//
// Lo que acepta:
// - Encabezados en español o en inglés, con o sin acentos, mayúsculas, espacios, guiones o guiones
//   bajos, más alias comunes (ticker, emisora, shares, comisiones, fx, factor, notas).
// - Tipos en español o en inglés (compra, venta, dividendo, depósito, retiro, split, comisión).
// - Fechas AAAA-MM-DD o DD/MM/AAAA como las escribe Excel en español.
// - Números con punto o coma decimal. Cuando una cifra es ambigua ("1,000" o "1.500"), manda la
//   marca decimal que el propio archivo deja ver en sus otras cifras ("60.5" o "60,5"); si ninguna
//   la deja ver, un archivo separado por punto y coma se lee con coma decimal, que es como lo
//   guarda Excel cuando la coma es el decimal.
// - Celdas que el exportador protegió con apóstrofo para que no parecieran fórmula.
//
// Lo que no reconoce no se tira en silencio: `ignored` trae los nombres de esas columnas para que
// la pantalla lo diga. Cada fila pasa por validateTransaction de storage, igual que lo que se
// captura a mano, y los ids del archivo no se conservan.
import { detectDelimiter, parseCSV, parseLocaleNumber } from '../csv.js'
import { validateTransaction } from '../storage.js'

/** Quita acentos, espacios, guiones y mayúsculas para comparar encabezados y tipos. @param {unknown} s */
const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')

/** @type {Record<string, string>} */
const HEADERS = {
  fecha: 'date', date: 'date',
  tipo: 'type', type: 'type',
  clave: 'symbol', simbolo: 'symbol', symbol: 'symbol', ticker: 'symbol', emisora: 'symbol',
  titulos: 'quantity', cantidad: 'quantity', quantity: 'quantity', shares: 'quantity',
  precio: 'price', price: 'price',
  monto: 'amount', amount: 'amount',
  comision: 'fees', comisiones: 'fees', fees: 'fees', fee: 'fees',
  moneda: 'currency', currency: 'currency',
  tipodecambio: 'fxRate', fxrate: 'fxRate', fx: 'fxRate',
  proporcion: 'ratio', ratio: 'ratio', factor: 'ratio',
  nota: 'note', note: 'note', notas: 'note',
}

/** @type {Record<string, string>} */
const TYPES = {
  compra: 'buy', buy: 'buy',
  venta: 'sell', sell: 'sell',
  dividendo: 'dividend', dividend: 'dividend',
  deposito: 'deposit', deposit: 'deposit',
  retiro: 'withdrawal', withdrawal: 'withdrawal',
  split: 'split',
  comision: 'fee', fee: 'fee',
}

const NUMERIC = new Set(['quantity', 'price', 'amount', 'fees', 'fxRate', 'ratio'])

/**
 * Campo del movimiento al que corresponde un encabezado, o null si no es uno de los que se leen.
 * @param {unknown} header
 * @returns {string | null}
 */
export function fieldOfHeader(header) {
  return HEADERS[fold(header)] ?? null
}

/**
 * Separa los encabezados en los que se importan y los que se ignoran.
 * @param {unknown[]} header primera fila del CSV
 * @returns {{ known: string[], unknown: string[] }}
 */
export function csvColumns(header) {
  const names = (Array.isArray(header) ? header : []).map((h) => String(h ?? '').trim()).filter(Boolean)
  return { known: names.filter((h) => fieldOfHeader(h)), unknown: names.filter((h) => !fieldOfHeader(h)) }
}

/**
 * Número de una celda con parseLocaleNumber de src/lib/csv.js: "1,234.56", "1.234,56", "$ 2 500",
 * "−5" y "0,375". Vacío es null; lo que no se entiende es NaN, y validateTransaction lo rechaza
 * con su motivo.
 * @param {string} text
 * @param {{ decimalComma?: boolean }} [options]
 * @returns {number | null}
 */
export function parseCell(text, { decimalComma = false } = {}) {
  return parseLocaleNumber(text, { decimalComma })
}

/**
 * Fecha de una celda: AAAA-MM-DD tal cual, o DD/MM/AAAA como la escribe Excel en español.
 * @param {string} text
 * @returns {string | null}
 */
export function parseDateCell(text) {
  const s = String(text ?? '').trim()
  if (s === '') return null
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  return s
}

/**
 * Marca decimal que deja ver una cifra, o null si no deja ver ninguna ("1,000", "1.500", "25").
 * @param {string} text
 * @returns {',' | '.' | null}
 */
function decimalMarkOf(text) {
  const s = String(text ?? '').replace(/[^\d.,]/g, '')
  const comma = s.lastIndexOf(',')
  const dot = s.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) return comma > dot ? ',' : '.'
  const mark = comma >= 0 ? ',' : dot >= 0 ? '.' : null
  if (mark === null) return null
  const parts = s.split(mark)
  // La misma marca dos veces ("1.234.567") solo puede agrupar miles: el decimal es la otra.
  if (parts.length > 2) return mark === ',' ? '.' : ','
  // "0,375" no agrupa miles; "1,234" y "1.500" pueden ser cualquiera de las dos cosas.
  if (parts[0] !== '' && parts[0] !== '0' && parts[1].length === 3) return null
  return mark
}

/**
 * ¿Las cifras del archivo van con coma decimal? Manda lo que dejan ver las cifras no ambiguas;
 * si no hay ninguna o se contradicen, decide el separador.
 * @param {string[][]} body filas de datos
 * @param {(string | null)[]} fields campo de cada columna
 * @param {string} delimiter
 */
function usesDecimalComma(body, fields, delimiter) {
  let comma = false
  let dot = false
  for (const cells of body) {
    fields.forEach((field, i) => {
      if (!field || !NUMERIC.has(field)) return
      const mark = decimalMarkOf(cells[i] ?? '')
      if (mark === ',') comma = true
      else if (mark === '.') dot = true
    })
  }
  if (comma !== dot) return comma
  return delimiter === ';'
}

/** Firma para reconocer un movimiento repetido. @param {any} tx */
export function txSignature(tx) {
  return [tx.type, tx.date ?? '', tx.symbol ?? '', tx.quantity ?? '', tx.price ?? '', tx.amount ?? '', tx.ratio ?? '', tx.currency].join('|')
}

/**
 * @typedef {{
 *   ok: import('../storage.js').Transaction[],
 *   bad: { row: number, reason: string }[],
 *   repeated: number,
 *   empty: boolean,
 *   ignored: string[],
 * }} CsvImport
 */

/**
 * Texto CSV → movimientos válidos, filas con problema (número de fila del archivo, contando el
 * encabezado como la 1), cuántos ya estaban en `existing` y no se vuelven a agregar, si el
 * archivo venía sin filas, y los nombres de las columnas que no se leen.
 * @param {string} text
 * @param {any[]} [existing] movimientos que ya están en el libro
 * @returns {CsvImport}
 */
export function parseTransactionsCSV(text, existing = []) {
  const delimiter = detectDelimiter(text)
  const rows = parseCSV(text, { delimiter, unguard: true })
  const ignored = csvColumns(rows[0] ?? []).unknown
  /** @type {CsvImport['ok']} */
  const ok = []
  /** @type {CsvImport['bad']} */
  const bad = []
  let repeated = 0
  if (rows.length < 2) return { ok, bad, repeated, empty: true, ignored }
  const fields = rows[0].map(fieldOfHeader)
  if (!fields.includes('type')) {
    return { ok, bad: [{ row: 1, reason: 'falta la columna Tipo' }], repeated, empty: false, ignored }
  }
  // Conteo por firma: reimportar el mismo archivo no duplica nada, pero dos compras idénticas del
  // mismo día dentro del archivo (dos ejecuciones de una orden) sí entran las dos.
  /** @type {Map<string, number>} */
  const known = new Map()
  for (const tx of Array.isArray(existing) ? existing : []) known.set(txSignature(tx), (known.get(txSignature(tx)) ?? 0) + 1)
  const body = rows.slice(1)
  const decimalComma = usesDecimalComma(body, fields, delimiter)
  body.forEach((cells, index) => {
    /** @type {Record<string, unknown>} */
    const raw = {}
    fields.forEach((field, i) => {
      if (!field) return
      const text = String(cells[i] ?? '').trim()
      if (field === 'type') raw.type = TYPES[fold(text)] ?? text
      else if (field === 'date') raw.date = parseDateCell(text)
      else if (field === 'currency') raw.currency = text ? text.toUpperCase() : undefined
      else if (field === 'symbol') raw.symbol = text === '' ? null : text.toUpperCase()
      else if (NUMERIC.has(field)) raw[field] = parseCell(text, { decimalComma })
      else raw[field] = text
    })
    if (raw.fees === null) delete raw.fees
    const res = validateTransaction(raw)
    if (!res.tx) {
      bad.push({ row: index + 2, reason: res.reason })
      return
    }
    const signature = txSignature(res.tx)
    const left = known.get(signature) ?? 0
    if (left > 0) {
      known.set(signature, left - 1)
      repeated += 1
      return
    }
    ok.push(res.tx)
  })
  return { ok, bad, repeated, empty: false, ignored }
}
