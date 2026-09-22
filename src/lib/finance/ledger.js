// STUB de S2: posiciones a partir de los movimientos con costo promedio. El stream A reemplaza
// el interior (fechas, FX por operación, P&L realizado, efectivo) manteniendo esta firma:
//
//   derivePositions(transactions, { asOf }) → [{ symbol, quantity, avgCost, currency, costBasis }]
//
// Contrato mínimo que ya cumple (src/lib/portfolio/ledger.contract.test.js):
// - buy suma cantidad y costo (precio × cantidad + comisiones, en la moneda del movimiento).
// - sell resta cantidad y quita costo al costo promedio vigente (el promedio no cambia).
// - split multiplica la cantidad por `ratio` y divide el costo promedio; el costo total no cambia.
// - dividend, deposit, withdrawal y fee no mueven posiciones.
// - Los movimientos sin fecha (saldos iniciales migrados) van antes que los fechados; con
//   `asOf` (YYYY-MM-DD) se ignoran los posteriores a esa fecha.
// - Una compra sin precio deja el costo del símbolo como desconocido (null).
// - Se omiten posiciones cerradas (cantidad ~0). Orden por símbolo.

/** @typedef {import('../storage.js').Transaction} Transaction */

/**
 * @typedef {{
 *   symbol: string,
 *   quantity: number,
 *   avgCost: number | null,
 *   currency: 'MXN' | 'USD',
 *   costBasis: number | null,
 * }} Position
 */

const EPSILON = 1e-9

/**
 * Posiciones abiertas por símbolo con el método de costo promedio.
 * @param {Transaction[]} transactions
 * @param {{ asOf?: string | null }} [options] fecha de corte YYYY-MM-DD (inclusive)
 * @returns {Position[]}
 */
export function derivePositions(transactions, { asOf = null } = {}) {
  const ordered = (Array.isArray(transactions) ? transactions : [])
    .map((tx, index) => ({ tx, index }))
    .filter(({ tx }) => tx && (asOf == null || tx.date == null || tx.date <= asOf))
    .sort((a, b) => {
      const da = a.tx.date ?? ''
      const db = b.tx.date ?? ''
      if (da !== db) return da < db ? -1 : 1
      return a.index - b.index
    })

  /** @type {Map<string, { quantity: number, cost: number | null, currency: 'MXN' | 'USD' }>} */
  const book = new Map()

  for (const { tx } of ordered) {
    const symbol = tx.symbol
    if (!symbol) continue
    const pos = book.get(symbol) ?? { quantity: 0, cost: 0, currency: tx.currency }
    if (tx.type === 'buy') {
      const qty = tx.quantity ?? 0
      if (qty <= 0) continue
      if (pos.quantity <= EPSILON) {
        pos.cost = 0
        pos.currency = tx.currency
      }
      pos.quantity += qty
      pos.cost = pos.cost === null || tx.price == null ? null : pos.cost + qty * tx.price + (tx.fees ?? 0)
    } else if (tx.type === 'sell') {
      const qty = Math.min(tx.quantity ?? 0, pos.quantity)
      if (qty <= 0) continue
      const avg = pos.cost === null ? null : pos.cost / pos.quantity
      pos.quantity -= qty
      if (pos.quantity <= EPSILON) {
        pos.quantity = 0
        pos.cost = 0
      } else if (avg !== null) pos.cost -= avg * qty
    } else if (tx.type === 'split') {
      if (!(tx.ratio > 0)) continue
      pos.quantity *= tx.ratio
    } else {
      continue
    }
    book.set(symbol, pos)
  }

  return [...book.entries()]
    .filter(([, p]) => p.quantity > EPSILON)
    .map(([symbol, p]) => ({
      symbol,
      quantity: p.quantity,
      avgCost: p.cost === null ? null : p.cost / p.quantity,
      currency: p.currency,
      costBasis: p.cost,
    }))
    .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0))
}
