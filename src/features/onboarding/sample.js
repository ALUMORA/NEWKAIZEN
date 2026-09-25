import { parseLocaleNumber } from '../../lib/csv.js'

// Portafolio de ejemplo de la bienvenida. Cifras inventadas para explorar la app: el nombre y la
// nota dicen EJEMPLO para que nadie las confunda con las suyas.
export const SAMPLE_NAME = 'Portafolio de EJEMPLO'
export const SAMPLE_NOTE = 'EJEMPLO: movimientos inventados para conocer Kaizen. Puedes borrarlo cuando quieras.'

export const SAMPLE_TRANSACTIONS = Object.freeze([
  { type: 'deposit', date: '2026-01-05', symbol: null, quantity: null, price: null, currency: 'MXN', amount: 100000, note: 'EJEMPLO' },
  { type: 'buy', date: '2026-01-06', symbol: 'NAFTRAC.MX', quantity: 600, price: 58.4, currency: 'MXN', fees: 35, note: 'EJEMPLO' },
  { type: 'buy', date: '2026-01-06', symbol: 'WALMEX.MX', quantity: 300, price: 61.2, currency: 'MXN', fees: 20, note: 'EJEMPLO' },
  { type: 'buy', date: '2026-02-10', symbol: 'FEMSAUBD.MX', quantity: 80, price: 168.5, currency: 'MXN', fees: 15, note: 'EJEMPLO' },
  { type: 'dividend', date: '2026-04-20', symbol: 'WALMEX.MX', quantity: null, price: null, currency: 'MXN', amount: 240, note: 'EJEMPLO' },
])

// Encabezados que se aceptan en el CSV, en español o en inglés.
const HEADERS = {
  tipo: 'type', type: 'type',
  fecha: 'date', date: 'date',
  simbolo: 'symbol', símbolo: 'symbol', symbol: 'symbol', clave: 'symbol',
  cantidad: 'quantity', quantity: 'quantity', titulos: 'quantity', títulos: 'quantity',
  precio: 'price', price: 'price',
  moneda: 'currency', currency: 'currency',
  comision: 'fees', comisión: 'fees', fees: 'fees',
  monto: 'amount', amount: 'amount',
  tipodecambio: 'fxRate', fxrate: 'fxRate',
  nota: 'note', note: 'note',
}
const TYPES = { compra: 'buy', venta: 'sell', dividendo: 'dividend', deposito: 'deposit', depósito: 'deposit', retiro: 'withdrawal', split: 'split', comision: 'fee', comisión: 'fee' }
const NUMERIC = new Set(['quantity', 'price', 'fees', 'amount', 'fxRate'])

/** Encabezado normalizado a su campo, o undefined si no es uno de los que se aceptan. @param {string} key */
const fieldOf = (key) => HEADERS[String(key ?? '').trim().toLowerCase().replace(/\s+/g, '')]

/**
 * Separa los encabezados del CSV en los que se importan y los que se ignoran, para decirlo en
 * pantalla en vez de tirarlos callados.
 * @param {string[]} header primera fila del CSV
 * @returns {{ known: string[], unknown: string[] }}
 */
export function csvColumns(header) {
  const names = (header ?? []).map((h) => String(h ?? '').trim()).filter(Boolean)
  return { known: names.filter((h) => fieldOf(h)), unknown: names.filter((h) => !fieldOf(h)) }
}

/**
 * Convierte filas del CSV (objetos por encabezado) a movimientos crudos para validateTransaction.
 * Los números aceptan coma decimal ("1.234,56", "1234,56"); con `decimalComma` (archivo separado
 * por punto y coma) la coma siempre es decimal. Un número que no se puede leer queda en NaN y
 * validateTransaction rechaza la fila con su motivo.
 * @param {Record<string, string>[]} rows
 * @param {{ decimalComma?: boolean }} [options]
 */
export function rowsToRawTransactions(rows, { decimalComma = false } = {}) {
  return rows.map((row) => {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [key, value] of Object.entries(row)) {
      const field = fieldOf(key)
      if (!field) continue
      const text = String(value ?? '').trim()
      if (field === 'type') out.type = TYPES[text.toLowerCase()] ?? text.toLowerCase()
      else if (field === 'currency') out.currency = text ? text.toUpperCase() : undefined
      else if (NUMERIC.has(field)) out[field] = parseLocaleNumber(text, { decimalComma })
      else out[field] = text === '' ? null : text
    }
    return out
  })
}
