// Rebalanceo en acciones enteras: qué comprar y qué vender para acercarse a los pesos objetivo
// que la persona fijó. Módulo puro: sin React, sin fetch y sin Date.now().
//
// NO ES UNA RECOMENDACIÓN DE INVERSIÓN. "comprar" y "vender" aquí son pasos mecánicos para llegar
// a un objetivo que la persona eligió, no una opinión sobre ningún instrumento.
//
// Método:
// 1. Valor total V = efectivo + Σ cantidad × precio. Los pesos se miden contra V.
// 2. Base: cantidad entera hacia abajo de (objetivo × V / precio). Hacia abajo, para que la base
//    siempre quepa en el efectivo disponible. Si lo que se tiene trae una cola fraccionaria, esa
//    cola se queda quieta y solo se mueve la parte entera: el plan nunca pide vender 0.5 títulos.
// 3. Sobrante: se compra de una en una la acción que más baje la desviación Σ|peso − objetivo|,
//    mientras alcance el efectivo.
// 4. Mejora local por pares: vender uno de Y para comprar uno de X, mientras eso baje la
//    desviación y el efectivo lo permita. Es lo que rescata los casos donde el piso vendió algo
//    caro que el paso codicioso ya no alcanza a recomprar.
//
// LÍMITE CONOCIDO: el paso 3 por sí solo es codicioso, no óptimo. Medido con 1,500 carteras
// aleatorias de dos activos contra la búsqueda exhaustiva: sin el paso 4 se quedaba corto en
// 10.2 % de los casos, con brecha de desviación de hasta .270526; el peor caso concreto dejaba
// 37 % del portafolio sin invertir. El paso 4 cierra esos casos, pero no garantiza el óptimo
// entero: sigue siendo búsqueda local y con tres o más activos puede haber combinaciones que
// solo se alcanzan moviendo tres posiciones a la vez.
//
// La desviación que se reporta suma solo los símbolos negociables, NO el peso del efectivo
// sobrante. O sea que cuando queda efectivo sin invertir, el número reportado queda por abajo de
// la distancia real al objetivo, y la diferencia es justo ese peso. Quien lo pinte en pantalla
// debe mostrar el efectivo sobrante junto al plan.

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
      skipped.push({ symbol, reason: 'No hay precio para esa clave.' })
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
    const base = allowSell ? Math.floor((target[symbol] * value) / price[symbol] + EPS) : current[symbol]
    // El movimiento va en enteros aunque lo que se tenga traiga fracción: se pega el delta a
    // entero y la cola fraccionaria se queda donde está. Si no, el plan pediría vender 0.5
    // títulos justo debajo de la nota que promete que no hay fracciones.
    qty[symbol] = current[symbol] + Math.trunc(base - current[symbol])
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

  // Mejora local por pares: vender lo mínimo de un símbolo para que alcance uno de otro. Solo
  // aplica cuando se permite vender, y solo mientras baje la desviación de verdad. Es lo que
  // rescata el caso en que el piso vendió algo caro que el paso codicioso ya no puede recomprar.
  if (allowSell) {
    /** @param {string} symbol @param {number} delta */
    const pairGain = (symbol, delta) => {
      const w = (qty[symbol] * price[symbol]) / value
      return Math.abs(w - target[symbol]) - Math.abs(w + (delta * price[symbol]) / value - target[symbol])
    }
    for (let step = 0; step < MAX_STEPS; step += 1) {
      /** @type {[string, string] | null} */
      let pair = null
      let bestGain = 1e-12
      /** @type {number} */
      let bestUnits = 0
      for (const buySymbol of tradable) {
        for (const sellSymbol of tradable) {
          if (buySymbol === sellSymbol) continue
          // cuántos títulos de `sellSymbol` hay que vender para que alcance uno de `buySymbol`
          const units = Math.ceil((price[buySymbol] - left - EPS) / price[sellSymbol])
          if (units < 1) continue // eso ya lo cubre el paso codicioso
          if (qty[sellSymbol] < units - EPS) continue
          // no proponer movimientos que el propio piso de minTrade va a deshacer después
          if (floor > 0 && (price[buySymbol] < floor || units * price[sellSymbol] < floor)) continue
          const gain = pairGain(buySymbol, 1) + pairGain(sellSymbol, -units)
          if (gain > bestGain + 1e-15) {
            pair = [buySymbol, sellSymbol]
            bestUnits = units
            bestGain = gain
          }
        }
      }
      if (pair === null) break
      qty[pair[0]] += 1
      qty[pair[1]] -= bestUnits
      left += bestUnits * price[pair[1]] - price[pair[0]]
    }
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
  if (left / value > 0.01) {
    notes.push('La desviación que se reporta no incluye el efectivo sobrante, y aquí queda una parte sin invertir.')
  }

  return {
    trades: [...sells, ...buys],
    after: { holdings: qty, weights, cash: left, value },
    deviation: { before, after: deviationOf(qty) },
    targets: target,
    skipped,
    notes,
  }
}
