// Movimientos del libro de ida y vuelta en CSV (src/lib/csv.js). La exportación vive aquí porque
// usa las etiquetas de la pantalla; la lectura es la de src/lib/portfolio/tx-csv.js, la misma que
// usa la bienvenida, y se reexporta para quien ya la importaba de aquí.
import { objectsToCSV } from '../../../lib/csv.js'
import { TX_LABELS } from '../tx-labels.js'

export { parseCell, parseDateCell, parseTransactionsCSV, txSignature } from '../../../lib/portfolio/tx-csv.js'

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
