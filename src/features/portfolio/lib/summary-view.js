// Cálculos de /portafolio (resumen): posiciones del libro valuadas con la cotización de hoy
// (/v2/quotes) y convertidas a pesos con el tipo de cambio del día (/v2/fx). El resultado no
// realizado en pesos sale de positionPnl, igual que en Rendimiento. Módulo puro.
import { derivePositionsDetailed, ledgerSnapshots, positionPnl } from '../../../lib/finance/ledger.js'

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * @param {{
 *   transactions: any[],
 *   quotes: any[] | undefined,
 *   usdmxn: number | null | undefined,
 *   today: string,
 * }} input
 */
export function summarize({ transactions, quotes, usdmxn, today }) {
  /** @type {Map<string, any>} */
  const bySymbol = new Map((quotes ?? []).map((q) => [q.symbol, q]))
  const rate = isNum(usdmxn) && usdmxn > 0 ? usdmxn : null
  const toMxn = (/** @type {string} */ ccy) => (ccy === 'USD' ? rate : 1)

  const rows = derivePositionsDetailed(transactions).map((p) => {
    const q = bySymbol.get(p.symbol)
    const price = isNum(q?.price) ? q.price : null
    const ccy = q?.currency === 'USD' || q?.currency === 'MXN' ? q.currency : p.currency
    const factor = toMxn(ccy)
    const value = price !== null && factor !== null ? p.quantity * price * factor : null
    // El resultado en la moneda de la emisora solo tiene sentido si la cotización viene en la
    // misma moneda en la que se capturaron las compras.
    const sameCcy = ccy === p.currency
    const pnl = sameCcy && price !== null && isNum(p.costBasis) ? p.quantity * price - p.costBasis : null
    const pnlPct = sameCcy && price !== null && isNum(p.avgCost) && p.avgCost > 0 ? price / p.avgCost - 1 : null
    const split = sameCcy
      ? positionPnl({ quantity: p.quantity, price0: p.avgCost, price1: price, fx0: p.currency === 'USD' ? p.avgFx : 1, fx1: toMxn(p.currency) })
      : null
    const change = isNum(q?.change) ? q.change : null
    return {
      symbol: p.symbol,
      name: typeof q?.name === 'string' ? q.name : null,
      quantity: p.quantity,
      price,
      currency: ccy,
      avgCost: p.avgCost,
      value,
      weight: /** @type {number | null} */ (null),
      pnl,
      pnlPct,
      pnlMxn: split?.total ?? null,
      costMxn: split && isNum(p.costBasis) ? p.costBasis * (p.currency === 'USD' ? /** @type {number} */ (p.avgFx) : 1) : null,
      changePct: isNum(q?.changePct) ? q.changePct : null,
      changeMxn: change !== null && factor !== null ? p.quantity * change * factor : null,
      quoted: price !== null,
      mismatch: q != null && !sameCcy,
    }
  })

  const snapshot = ledgerSnapshots(transactions, [today])[0]
  const funded = snapshot?.fundedCash ?? { MXN: 0, USD: 0 }
  const cash = (funded.MXN ?? 0) + (funded.USD ? (rate !== null ? funded.USD * rate : Number.NaN) : 0)
  const cashMxn = isNum(cash) ? cash : null

  const holdings = rows.reduce((a, r) => a + (r.value ?? 0), 0)
  const total = holdings + (cashMxn ?? 0)
  for (const r of rows) r.weight = r.value !== null && total > 0 ? r.value / total : null

  const withPnl = rows.filter((r) => isNum(r.pnlMxn) && isNum(r.costMxn))
  const unrealized = withPnl.length ? withPnl.reduce((a, r) => a + /** @type {number} */ (r.pnlMxn), 0) : null
  const cost = withPnl.reduce((a, r) => a + /** @type {number} */ (r.costMxn), 0)
  const withChange = rows.filter((r) => isNum(r.changeMxn) && isNum(r.value))
  const dayChange = withChange.length ? withChange.reduce((a, r) => a + /** @type {number} */ (r.changeMxn), 0) : null
  const dayBase = withChange.reduce((a, r) => a + /** @type {number} */ (r.value) - /** @type {number} */ (r.changeMxn), 0)

  return {
    rows,
    cashMxn,
    cashUsd: funded.USD ?? 0,
    holdings,
    total,
    unrealized,
    unrealizedPct: unrealized !== null && cost > 0 ? unrealized / cost : null,
    unrealizedExcluded: rows.length - withPnl.length,
    dayChange,
    dayChangePct: dayChange !== null && dayBase > 0 ? dayChange / dayBase : null,
    unquoted: rows.filter((r) => !r.quoted).map((r) => r.symbol),
    mismatched: rows.filter((r) => r.mismatch).map((r) => r.symbol),
  }
}
