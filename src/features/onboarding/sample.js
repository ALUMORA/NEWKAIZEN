import { parseTransactionsCSV } from '../../lib/portfolio/tx-csv.js'

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

/**
 * Lo que hace la bienvenida con el texto de un CSV: movimientos válidos, filas con problema
 * (contando el encabezado como la fila 1) y columnas que no se importan. Usa el mismo parser que
 * Movimientos (src/lib/portfolio/tx-csv.js), así que el mismo archivo da lo mismo en las dos.
 * @param {string} text
 * @returns {{ ok: any[], bad: { row: number, reason: string }[], unknown: string[] }}
 */
export function readOnboardingCsv(text) {
  const { ok, bad, ignored } = parseTransactionsCSV(text)
  return { ok, bad, unknown: ignored }
}
