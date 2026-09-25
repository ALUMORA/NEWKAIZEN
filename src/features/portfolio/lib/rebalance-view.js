// Cálculos de /portafolio/rebalanceo que no dependen de React: el efectivo con el que se valúa
// el portafolio y los movimientos que se escriben al libro cuando la persona registra el plan.
// Módulo puro: la fecha y los ids entran por parámetro.
import { ledgerSnapshots } from '../../../lib/finance/ledger.js'

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Efectivo por moneda a una fecha, ya considerando como aportadas las compras que ningún depósito
 * financió: el mismo `fundedCash` con que valúan el resumen y el rendimiento. El saldo crudo de
 * `cashBalances` queda negativo en un libro de solo compras, y con él el plan pedía vender casi
 * todo para "pagar" ese faltante.
 * @param {any[]} transactions
 * @param {string} date AAAA-MM-DD
 * @returns {{ MXN: number, USD: number }}
 */
export function rebalanceCash(transactions, date) {
  const snap = ledgerSnapshots(transactions, [date])[0]
  return { MXN: snap?.fundedCash?.MXN ?? 0, USD: snap?.fundedCash?.USD ?? 0 }
}

/**
 * Movimientos del plan para el libro. Cada uno va en la moneda en que ya está la posición, no en
 * la de la cotización: una emisora comprada en pesos en el SIC que hoy cotiza en dólares se
 * registra en pesos, porque mezclar monedas en un lote deja su costo en s/d. Lo que todavía no
 * se tiene va en la moneda de su cotización. Si hace falta el tipo de cambio y no lo hay, esa
 * emisora sale en `blocked` y no se escribe nada.
 * @param {{
 *   trades: { symbol: string, side: 'compra' | 'venta', quantity: number, price: number }[],
 *   positions: { symbol: string, currency: string }[],
 *   quotes: Record<string, { price: number, currency: string }>,
 *   usdRate: number | null,
 *   date: string,
 *   makeId: () => string,
 * }} input `price` de cada trade va en pesos, como lo calcula el plan
 * @returns {{ transactions: any[], blocked: string[] }}
 */
export function planTransactions({ trades, positions, quotes, usdRate, date, makeId }) {
  const lotCurrency = new Map(positions.map((p) => [p.symbol, p.currency]))
  const rate = isNum(usdRate) && usdRate > 0 ? usdRate : null
  /** @type {any[]} */
  const transactions = []
  /** @type {string[]} */
  const blocked = []
  for (const t of trades) {
    const quote = quotes[t.symbol]
    const currency = lotCurrency.get(t.symbol) ?? (quote?.currency === 'USD' ? 'USD' : 'MXN')
    let price = t.price
    if (currency === 'USD') {
      if (rate === null) {
        blocked.push(t.symbol)
        continue
      }
      price = quote?.currency === 'USD' && isNum(quote.price) ? quote.price : t.price / rate
    }
    transactions.push({
      id: makeId(),
      type: t.side === 'venta' ? 'sell' : 'buy',
      date,
      symbol: t.symbol,
      quantity: t.quantity,
      price,
      currency,
      fxRate: currency === 'USD' ? rate : null,
      fees: 0,
      amount: null,
      ratio: null,
      note: 'Rebalanceo',
    })
  }
  return { transactions, blocked }
}
