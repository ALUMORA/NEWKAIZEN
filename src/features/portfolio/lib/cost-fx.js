// Tipo de cambio de compra de cada posición en dólares, ponderado por lo que costó cada compra y
// no por cuántos títulos trajo. `avgFx` de src/lib/finance/ledger.js pondera por cantidad (así
// está probado allá), y con compras a precios distintos eso descuadra el costo en pesos: 10 a 100
// dólares con 17 y 10 a 200 con 20 costaron 57,000 pesos, pero 20 × 150 × 18.5 da 55,500. Aquí se
// recorre el libro con las mismas reglas del costo promedio (orden, ventas recortadas, splits,
// posición que se vuelve a abrir) llevando el costo en dólares y en pesos a la par, así que
// costo en dólares × este tipo de cambio es exactamente lo que se pagó en pesos.
import { orderTransactions } from '../../../lib/finance/ledger.js'

const EPSILON = 1e-9

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * @param {any[] | null | undefined} transactions
 * @returns {Map<string, number | null>} pesos por dólar por símbolo abierto en dólares; null si a
 *   alguna compra vigente le falta el tipo de cambio o el precio
 */
export function costWeightedFx(transactions) {
  /** @type {Map<string, { qty: number, usd: number, mxn: number, known: boolean, currency: string }>} */
  const lots = new Map()
  for (const tx of orderTransactions(transactions)) {
    const symbol = typeof tx?.symbol === 'string' ? tx.symbol : ''
    if (!symbol) continue
    const lot = lots.get(symbol) ?? { qty: 0, usd: 0, mxn: 0, known: true, currency: tx.currency === 'USD' ? 'USD' : 'MXN' }
    if (tx.type === 'buy') {
      const qty = isNum(tx.quantity) ? tx.quantity : 0
      if (qty <= 0) continue
      if (lot.qty <= EPSILON) Object.assign(lot, { qty: 0, usd: 0, mxn: 0, known: true, currency: tx.currency === 'USD' ? 'USD' : 'MXN' })
      lot.qty += qty
      const fees = isNum(tx.fees) && tx.fees > 0 ? tx.fees : 0
      if (tx.currency === 'USD' && lot.currency === 'USD' && isNum(tx.price) && isNum(tx.fxRate) && tx.fxRate > 0) {
        const amount = qty * tx.price + fees
        lot.usd += amount
        lot.mxn += amount * tx.fxRate
      } else {
        lot.known = false
      }
    } else if (tx.type === 'sell') {
      const asked = isNum(tx.quantity) ? tx.quantity : 0
      const q = Math.min(asked, lot.qty)
      if (q <= 0) continue
      const keep = (lot.qty - q) / lot.qty
      lot.usd *= keep
      lot.mxn *= keep
      lot.qty -= q
      if (lot.qty <= EPSILON) Object.assign(lot, { qty: 0, usd: 0, mxn: 0, known: true })
    } else if (tx.type === 'split') {
      if (isNum(tx.ratio) && tx.ratio > 0) lot.qty *= tx.ratio
    } else {
      continue
    }
    lots.set(symbol, lot)
  }
  /** @type {Map<string, number | null>} */
  const out = new Map()
  for (const [symbol, lot] of lots) {
    if (lot.qty <= EPSILON || lot.currency !== 'USD') continue
    out.set(symbol, lot.known && lot.usd > 0 ? lot.mxn / lot.usd : null)
  }
  return out
}
