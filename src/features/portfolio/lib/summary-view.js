// Cálculos de /portafolio (resumen): posiciones del libro valuadas con la cotización de hoy
// (/v2/quotes) y convertidas a pesos con el tipo de cambio del día (/v2/fx). El resultado no
// realizado en pesos sale de positionPnl, igual que en Rendimiento. Módulo puro.
//
// El libro se corta en `today`: un movimiento con fecha futura no cuenta todavía ni en posiciones
// ni en efectivo (antes contaba en unas y no en el otro), y se reporta en `futureCount`. La
// variación del día de lo que cotiza en dólares compara q × P1 × X1 contra q × P0 × X0, con X0 el
// FIX anterior (`usdmxnPrev`); sin él, usa X1 para los dos y lo marca en `dayFxFallback`.
import { derivePositionsDetailed, ledgerSnapshots } from '../../../lib/finance/ledger.js'
import { costWeightedFx } from './cost-fx.js'

/** @param {unknown} v @returns {v is number} */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * @param {{
 *   transactions: any[],
 *   quotes: any[] | undefined,
 *   usdmxn: number | null | undefined,
 *   usdmxnPrev?: number | null,
 *   today: string,
 * }} input `usdmxnPrev`: último FIX con fecha anterior al del tipo de cambio de hoy
 */
export function summarize({ transactions, quotes, usdmxn, usdmxnPrev = null, today }) {
  /** @type {Map<string, any>} */
  const bySymbol = new Map((quotes ?? []).map((q) => [q.symbol, q]))
  const rate = isNum(usdmxn) && usdmxn > 0 ? usdmxn : null
  const prevRate = isNum(usdmxnPrev) && usdmxnPrev > 0 ? usdmxnPrev : null
  const toMxn = (/** @type {string} */ ccy) => (ccy === 'USD' ? rate : 1)
  const toMxnPrev = (/** @type {string} */ ccy) => (ccy === 'USD' ? prevRate : 1)

  const all = Array.isArray(transactions) ? transactions : []
  const isFuture = (/** @type {any} */ t) => typeof t?.date === 'string' && t.date > today
  const current = all.filter((t) => !isFuture(t))
  const buyFx = costWeightedFx(current)
  let dayFxFallback = false
  const rows = derivePositionsDetailed(current, { asOf: today }).map((p) => {
    const fx0 = buyFx.get(p.symbol) ?? null
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
    // En pesos sí se puede aunque las monedas no coincidan: valor de hoy en pesos contra costo en
    // pesos. Es el caso de una emisora del SIC comprada en pesos que hoy cotiza en dólares, que es
    // como la mayoría compra acciones de Estados Unidos desde México; antes salía s/d.
    const costMxn = isNum(p.costBasis) ? (p.currency === 'USD' ? (isNum(fx0) ? p.costBasis * fx0 : null) : p.costBasis) : null
    const pnlMxn = value !== null && costMxn !== null ? value - costMxn : null
    const change = isNum(q?.change) ? q.change : null
    // Variación del día en pesos: valor de hoy menos el de ayer, cada uno con su tipo de cambio.
    // P0 es el cierre anterior; si la fuente no lo manda, sale de P1 − cambio.
    let changeMxn = null
    if (change !== null && factor !== null && price !== null) {
      const factor0 = toMxnPrev(ccy)
      const p0 = isNum(q?.previousClose) ? q.previousClose : price - change
      if (factor0 !== null) {
        changeMxn = p.quantity * (price * factor - p0 * factor0)
      } else {
        changeMxn = p.quantity * change * factor
        dayFxFallback = true
      }
    }
    return {
      symbol: p.symbol,
      name: typeof q?.name === 'string' ? q.name : null,
      quantity: p.quantity,
      price,
      currency: ccy,
      avgCost: p.avgCost,
      value,
      weight: /** @type {number | null} */ (null),
      pnl: sameCcy ? pnl : pnlMxn,
      pnlPct: sameCcy ? pnlPct : pnlMxn !== null && costMxn !== null && costMxn > 0 ? pnlMxn / costMxn : null,
      pnlCurrency: sameCcy ? ccy : 'MXN',
      pnlMxn,
      costMxn,
      changePct: isNum(q?.changePct) ? q.changePct : null,
      changeMxn,
      quoted: price !== null,
      mismatch: q != null && !sameCcy,
      lotCurrency: p.currency,
    }
  })

  const snapshot = ledgerSnapshots(current, [today])[0]
  const funded = snapshot?.fundedCash ?? { MXN: 0, USD: 0 }
  // Sin tipo de cambio, el efectivo en dólares se queda fuera y se avisa; el de pesos sigue.
  const cashUsdUnconverted = Boolean(funded.USD) && rate === null
  const cash = (funded.MXN ?? 0) + (funded.USD && rate !== null ? funded.USD * rate : 0)
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
    cashUsdUnconverted,
    holdings,
    total,
    unrealized,
    unrealizedPct: unrealized !== null && cost > 0 ? unrealized / cost : null,
    unrealizedExcluded: rows.length - withPnl.length,
    dayChange,
    dayChangePct: dayChange !== null && dayBase > 0 ? dayChange / dayBase : null,
    dayFxFallback,
    futureCount: all.length - current.length,
    unquoted: rows.filter((r) => !r.quoted).map((r) => r.symbol),
    mismatched: rows.filter((r) => r.mismatch).map((r) => r.symbol),
  }
}

const MX_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' })

/**
 * Último FIX publicado antes del día del tipo de cambio de hoy (`asOf` de /v2/fx), que es el X0 de
 * la variación del día. El día se toma en la Ciudad de México: a las 20:00 del 21 ya es 22 en UTC.
 * @param {{ dates?: string[], values?: (number | null)[] } | null | undefined} history /v2/fx/history
 * @param {string | null | undefined} asOf instante ISO o fecha AAAA-MM-DD
 * @returns {number | null}
 */
export function previousFix(history, asOf) {
  if (typeof asOf !== 'string' || !asOf) return null
  let day = asOf.slice(0, 10)
  if (asOf.length > 10) {
    const t = new Date(asOf)
    if (Number.isNaN(t.getTime())) return null
    day = MX_DATE.format(t)
  }
  const dates = history?.dates ?? []
  const values = history?.values ?? []
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const v = values[i]
    if (dates[i] < day && isNum(v) && v > 0) return v
  }
  return null
}
