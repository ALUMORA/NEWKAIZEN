// Ventas por más títulos de los que había. El libro (src/lib/finance/ledger.js) las recorta a lo
// que había, o las ignora si no había nada, sin avisar. Aquí se repite el mismo recorrido de
// cantidades (mismo orden, mismos splits) para poder decirlo en pantalla.
import { orderTransactions } from '../../../lib/finance/ledger.js'

const EPSILON = 1e-9

/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * @typedef {{ id: string, symbol: string, date: string | null, asked: number, held: number }} Oversell
 */

/**
 * Ventas que piden más títulos de los que había en ese punto del libro.
 * `held` es lo que había antes de la venta; el libro solo cuenta esa cantidad.
 * @param {any[] | null | undefined} transactions
 * @returns {Oversell[]}
 */
export function findOversells(transactions) {
  /** @type {Map<string, number>} */
  const held = new Map()
  /** @type {Oversell[]} */
  const out = []
  for (const tx of orderTransactions(transactions)) {
    const symbol = typeof tx.symbol === 'string' ? tx.symbol : ''
    if (!symbol) continue
    const current = held.get(symbol) ?? 0
    if (tx.type === 'buy') {
      const q = num(tx.quantity)
      if (q > 0) held.set(symbol, current + q)
    } else if (tx.type === 'sell') {
      const asked = num(tx.quantity)
      if (asked > current + EPSILON) out.push({ id: tx.id, symbol, date: tx.date ?? null, asked, held: current })
      const sold = Math.min(asked, current)
      if (sold > 0) held.set(symbol, current - sold <= EPSILON ? 0 : current - sold)
    } else if (tx.type === 'split') {
      const ratio = num(tx.ratio)
      if (ratio > 0) held.set(symbol, current * ratio)
    }
  }
  return out
}
