// Movimientos del libro de ida y vuelta en CSV (src/lib/csv.js). El encabezado va en español y
// al importar también se aceptan los nombres en inglés, los mismos que acepta la bienvenida.
// Cada fila pasa por validateTransaction de storage, igual que lo que se captura a mano.
import { objectsToCSV, parseCSV, rowsToObjects } from '../../../lib/csv.js'
import { validateTransaction } from '../../../lib/storage.js'
import { TX_LABELS } from '../tx-labels.js'

/** Columnas del CSV exportado, en el orden en que salen. */
const COLUMNS = [
  { key: 'date', label: 'Fecha' },
  { key: 'type', label: 'Tipo' },
  { key: 'symbol', label: 'Clave' },
  { key: 'quantity', label: 'Títulos' },
  { key: 'price', label: 'Precio' },
  { key: 'amount', label: 'Monto' },
  { key: 'fees', label: 'Comisión' },
  { key: 'currency', label: 'Moneda' },
  { key: 'fxRate', label: 'Tipo de cambio' },
  { key: 'ratio', label: 'Proporción' },
  { key: 'note', label: 'Nota' },
]

/** Quita acentos, espacios y mayúsculas para comparar encabezados y tipos. @param {string} s */
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
 * Número de una celda: acepta "1,234.56", "$ 2 500", "−5" y "0,375" (coma decimal cuando no
 * puede ser de miles). Vacío es null; lo que no se entiende es NaN, y validateTransaction lo
 * rechaza con su motivo.
 * @param {string} text
 * @returns {number | null}
 */
export function parseCell(text) {
  let s = String(text ?? '').trim().replace(/−/g, '-').replace(/[$\s]|MXN|USD/gi, '')
  if (s === '') return null
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '')
  else if (/^-?[1-9]\d{0,2}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '')
  else if (s.includes(',')) s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : Number.NaN
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
 * Libro → texto CSV con BOM, listo para downloadCSV.
 * @param {any[]} transactions
 */
export function transactionsToCSV(transactions) {
  const columns = COLUMNS.map((c) => ({
    label: c.label,
    key: (/** @type {any} */ tx) => {
      if (c.key === 'type') return TX_LABELS[tx.type] ?? tx.type
      if (c.key === 'fees') return tx.fees ? tx.fees : null
      return tx[c.key] ?? null
    },
  }))
  return objectsToCSV(Array.isArray(transactions) ? transactions : [], columns)
}

/** Firma para reconocer un movimiento repetido. @param {any} tx */
export function txSignature(tx) {
  return [tx.type, tx.date ?? '', tx.symbol ?? '', tx.quantity ?? '', tx.price ?? '', tx.amount ?? '', tx.ratio ?? '', tx.currency].join('|')
}

/**
 * Texto CSV → movimientos válidos, filas con problema (número de fila del archivo, contando el
 * encabezado como la 1) y cuántos ya estaban en `existing`, que no se vuelven a agregar.
 * Los ids del archivo no se conservan: cada movimiento importado recibe uno nuevo.
 * @param {string} text
 * @param {any[]} [existing]
 * @returns {{ ok: any[], bad: { row: number, reason: string }[], repeated: number, empty: boolean }}
 */
export function parseTransactionsCSV(text, existing = []) {
  const rows = parseCSV(text, { unguard: true })
  if (rows.length < 2) return { ok: [], bad: [], repeated: 0, empty: true }
  // Conteo por firma: reimportar el mismo archivo no duplica nada, pero dos compras idénticas del
  // mismo día dentro del archivo (dos ejecuciones de una orden) sí entran las dos.
  /** @type {Map<string, number>} */
  const known = new Map()
  for (const tx of existing) known.set(txSignature(tx), (known.get(txSignature(tx)) ?? 0) + 1)
  const header = rows[0].map((h) => HEADERS[fold(h)] ?? null)
  /** @type {any[]} */
  const ok = []
  /** @type {{ row: number, reason: string }[]} */
  const bad = []
  let repeated = 0
  if (!header.includes('type')) {
    return { ok, bad: [{ row: 1, reason: 'falta la columna Tipo' }], repeated, empty: false }
  }
  rowsToObjects(rows).forEach((_, index) => {
    const cells = rows[index + 1]
    /** @type {Record<string, unknown>} */
    const raw = {}
    header.forEach((field, i) => {
      if (!field) return
      const text = String(cells[i] ?? '').trim()
      if (field === 'type') raw.type = TYPES[fold(text)] ?? text
      else if (field === 'date') raw.date = parseDateCell(text)
      else if (field === 'currency') raw.currency = text ? text.toUpperCase() : undefined
      else if (field === 'symbol') raw.symbol = text === '' ? null : text.toUpperCase()
      else if (NUMERIC.has(field)) raw[field] = parseCell(text)
      else raw[field] = text
    })
    if (raw.fees === null) delete raw.fees
    delete raw.id
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
  return { ok, bad, repeated, empty: false }
}
