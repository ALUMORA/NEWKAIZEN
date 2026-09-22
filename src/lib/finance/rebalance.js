// Rebalanceo en acciones enteras: qué comprar y qué vender para acercarse a los pesos objetivo
// que la persona fijó. Módulo puro: sin React, sin fetch y sin Date.now().
//
// NO ES UNA RECOMENDACIÓN DE INVERSIÓN. "comprar" y "vender" aquí son pasos mecánicos para llegar
// a un objetivo que la persona eligió, no una opinión sobre ningún instrumento.
//
// Método, tal como lo fija el spec:
// 1. Valor total V = efectivo + Σ cantidad × precio. Los pesos se miden contra V, o sea que el
//    efectivo cuenta y su objetivo implícito es cero.
// 2. Base: cantidad entera hacia abajo de (objetivo × V / precio). Hacia abajo, para que la base
//    siempre quepa en el efectivo disponible.
// 3. Sobrante: se compra de una en una la acción que más baje la desviación Σ|peso − objetivo|,
//    mientras alcance el efectivo.
//
// LÍMITE CONOCIDO: el paso 3 es codicioso, no óptimo. Con precios muy dispares puede quedarse en
// un óptimo local. Ejemplo medido: 10 A y 2 B, precios 250 y 1500, objetivos 60/40 y 1,200 de
// efectivo. El método da 16 A y 1 B con desviación .179104, y la mejor combinación entera es
// 14 A y 2 B con .125373. Pasa porque la base vende una B que ya no se puede recomprar. Está en
// el golden de este módulo (`rebalance.json`, caso `greedy-vs-optimo`) para que quede medido.

/** @typedef {Record<string, number>} Amounts */

/**
 * @typedef {{ symbol: string, side: 'compra' | 'venta', quantity: number, amount: number, price: number }} Trade
 */

/**
 * @typedef {{
 *   trades: Trade[],
 *   after: { holdings: Amounts, weights: Amounts, cash: number, value: number },
 *   deviation: { before: number, after: number },
 *   targets: Amounts,
 *   skipped: { symbol: string, reason: string }[],
 *   notes: string[],
 * }} RebalancePlan
 */

const EPS = 1e-9
const MAX_STEPS = 100_000

/** @param {unknown} v */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Plan de rebalanceo en acciones enteras.
 *
 * Mínimo: precios positivos para todo lo que ya se tiene y un valor total mayor que cero.
 * Devuelve null (no un plan vacío) cuando el efectivo no es un número, cuando una posición que se
 * tiene no trae precio utilizable (sin él no se puede valuar el portafolio) o cuando el valor
 * total no es positivo. Un símbolo que solo está en los objetivos y no trae precio se salta, se
 * reporta en `skipped` y su objetivo se reparte entre los demás.
 *
 * @param {{
 *   holdings?: Amounts,
 *   prices?: Amounts,
 *   targets?: Amounts,
 *   cash?: number,
 *   allowSell?: boolean,
 *   minTrade?: number,
 * }} input pesos objetivo como fracciones que suman 1
 * @returns {RebalancePlan | null}
 */
export function wholeShareRebalance({
  holdings = {},
  prices = {},
  targets = {},
  cash = 0,
  allowSell = true,
  minTrade = 0,
} = {}) {
  if (!isNum(cash)) return null
  const price = /** @type {Amounts} */ ({})
  const current = /** @type {Amounts} */ ({})
  /** @type {{ symbol: string, reason: string }[]} */
  const skipped = []
  /** @type {string[]} */
  const notes = [
    'Son pasos mecánicos para llegar al objetivo que tú fijaste, no una recomendación de inversión.',
    'Las cantidades van en acciones o títulos enteros, sin fracciones.',
  ]

  const universe = [...new Set([...Object.keys(targets ?? {}), ...Object.keys(holdings ?? {})])].sort()
  /** @type {string[]} */
  const tradable = []
  for (const symbol of universe) {
    const p = prices?.[symbol]
    const held = isNum(holdings?.[symbol]) ? /** @type {number} */ (holdings[symbol]) : 0
    if (!isNum(p) || /** @type {number} */ (p) <= 0) {
      if (held > EPS) return null
      skipped.push({ symbol, reason: 'No hay precio para ese símbolo.' })
      continue
    }
    price[symbol] = /** @type {number} */ (p)
    current[symbol] = held
    tradable.push(symbol)
  }

  const invested = tradable.reduce((acc, s) => acc + current[s] * price[s], 0)
  const value = cash + invested
  if (!(value > 0)) return null

  /** @type {Amounts} */
  const target = {}
  let targetSum = 0
  for (const symbol of tradable) {
    const t = targets?.[symbol]
    const clean = isNum(t) && /** @type {number} */ (t) > 0 ? /** @type {number} */ (t) : 0
    target[symbol] = clean
    targetSum += clean
  }
  if (targetSum > 0 && Math.abs(targetSum - 1) > 1e-9) {
    for (const symbol of tradable) target[symbol] /= targetSum
    notes.push('Los objetivos no sumaban 100 %, así que se reescalaron para que sumen.')
  }
  if (skipped.length > 0) {
    notes.push(`Se dejaron fuera ${skipped.length} símbolos sin precio y su objetivo se repartió entre los demás.`)
  }

  /** @param {Amounts} qty */
  const deviationOf = (qty) =>
    tradable.reduce((acc, s) => acc + Math.abs((qty[s] * price[s]) / value - target[s]), 0)

  const before = deviationOf(current)

  /** @type {Amounts} */
  const qty = {}
  for (const symbol of tradable) {
    qty[symbol] = allowSell ? Math.floor((target[symbol] * value) / price[symbol] + EPS) : current[symbol]
  }
  let left = value - tradable.reduce((acc, s) => acc + qty[s] * price[s], 0)

  const floor = isNum(minTrade) && minTrade > 0 ? /** @type {number} */ (minTrade) : 0
  let omitted = 0
  if (floor > 0) {
    for (const symbol of tradable) {
      const delta = qty[symbol] - current[symbol]
      if (delta === 0 || Math.abs(delta) * price[symbol] >= floor) continue
      const freed = delta * price[symbol]
      if (left + freed < -EPS) continue // deshacer esa venta dejaría el efectivo en negativo
      qty[symbol] = current[symbol]
      left += freed
      omitted += 1
    }
  }

  for (let step = 0; step < MAX_STEPS; step += 1) {
    /** @type {string | null} */
    let best = null
    let bestGain = 1e-12
    for (const symbol of tradable) {
      const p = price[symbol]
      if (p > left + EPS) continue
      const w = (qty[symbol] * p) / value
      const gain = Math.abs(w - target[symbol]) - Math.abs(w + p / value - target[symbol])
      if (gain > bestGain + 1e-15) {
        best = symbol
        bestGain = gain
      }
    }
    if (best === null) break
    qty[best] += 1
    left -= price[best]
  }

  if (floor > 0) {
    for (const symbol of tradable) {
      const delta = qty[symbol] - current[symbol]
      if (delta <= 0 || delta * price[symbol] >= floor) continue
      qty[symbol] = current[symbol]
      left += delta * price[symbol]
      omitted += 1
    }
    if (omitted > 0) {
      notes.push(`Se omitieron los movimientos de menos de ${floor} en la moneda del portafolio.`)
    }
  }

  /** @type {Trade[]} */
  const buys = []
  /** @type {Trade[]} */
  const sells = []
  for (const symbol of tradable) {
    const delta = qty[symbol] - current[symbol]
    if (Math.abs(delta) < EPS) continue
    const trade = {
      symbol,
      side: /** @type {'compra' | 'venta'} */ (delta > 0 ? 'compra' : 'venta'),
      quantity: Math.abs(delta),
      amount: Math.abs(delta) * price[symbol],
      price: price[symbol],
    }
    if (delta > 0) buys.push(trade)
    else sells.push(trade)
  }

  /** @type {Amounts} */
  const weights = {}
  for (const symbol of tradable) weights[symbol] = (qty[symbol] * price[symbol]) / value

  return {
    trades: [...sells, ...buys],
    after: { holdings: qty, weights, cash: left, value },
    deviation: { before, after: deviationOf(qty) },
    targets: target,
    skipped,
    notes,
  }
}
