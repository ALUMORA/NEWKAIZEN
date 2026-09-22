// Backtest de una mezcla de activos, con dos estrategias honestas y distintas.
//
// El backtest viejo aplicaba los pesos de HOY a toda la historia y llamaba "rendimiento anual" al
// promedio aritmético por 52. Aquí:
// - `buyAndHold` compra una vez al inicio y no vuelve a tocar nada: los pesos se van de lado
//   solos, que es lo que de verdad le pasa a una cartera que nadie rebalancea. Es el caso base.
// - `constantMix` regresa a los pesos objetivo cada cierto tiempo. Rebalancear cada periodo con
//   estos números da .9975 y no rebalancear da .995: la diferencia no es ruido, es la estrategia.
// - El resumen se calcula con performance.summary, o sea CAGR, no promedios por 52.

import { EPS, isNum, normalizedWeights, numericArray, parseIsoDate, sumOf } from './_util.js'
import { simpleReturns } from './returns.js'
import { informationRatio, trackingError } from './benchmark.js'

/** @typedef {{ dates?: string[] | null, values: Record<string, number[]> }} PanelLike */

/**
 * @typedef {{
 *   dates: string[] | null,
 *   values: number[],
 *   returns: number[],
 *   turnover: number,
 *   weights: Record<string, number>,
 *   rebalances: number,
 * }} BacktestResult
 */

/**
 * Símbolos del panel, ordenados, con sus series del mismo largo.
 * @param {PanelLike} panel
 * @param {number} minLength
 * @returns {{ symbols: string[], series: number[][], length: number } | null}
 */
function readPanel(panel, minLength) {
  if (!panel || !panel.values || typeof panel.values !== 'object') return null
  const symbols = Object.keys(panel.values).sort()
  if (symbols.length === 0) return null
  /** @type {number[][]} */
  const series = []
  let length = -1
  for (const symbol of symbols) {
    const row = numericArray(panel.values[symbol], minLength)
    if (row === null) return null
    if (length === -1) length = row.length
    else if (row.length !== length) return null
    series.push(row)
  }
  return { symbols, series, length }
}

/**
 * Compra inicial y nada más: las participaciones quedan fijas y los pesos se mueven con los
 * precios. Mínimo 2 fechas.
 * @param {{ dates?: string[] | null, values: Record<string, number[]> }} pricePanel precios YA
 *   alineados por fecha y en una sola moneda (ver returns.alignPanel)
 * @param {Record<string, number>} initialWeights pesos iniciales por símbolo; se normalizan para
 *   que sumen 1
 * @returns {BacktestResult | null} `values` es la trayectoria de 1 peso y empieza en 1;
 *   `turnover` siempre 0. null si falta algún símbolo, si un precio inicial no es positivo o si
 *   el panel no cuadra
 */
export function buyAndHold(pricePanel, initialWeights) {
  const panel = readPanel(pricePanel, 2)
  if (panel === null) return null
  const w0 = normalizedWeights(initialWeights, panel.symbols)
  if (w0 === null) return null
  /** @type {number[]} */
  const shares = new Array(panel.symbols.length)
  for (let i = 0; i < panel.symbols.length; i++) {
    const p0 = panel.series[i][0]
    if (p0 <= 0) return null
    shares[i] = w0[i] / p0
  }
  /** @type {number[]} */
  const values = new Array(panel.length)
  for (let t = 0; t < panel.length; t++) {
    let value = 0
    for (let i = 0; i < panel.symbols.length; i++) value += shares[i] * panel.series[i][t]
    values[t] = value
  }
  const returns = simpleReturns(values)
  if (returns === null) return null
  /** @type {Record<string, number>} */
  const finalWeights = {}
  const last = values[values.length - 1]
  for (let i = 0; i < panel.symbols.length; i++) {
    finalWeights[panel.symbols[i]] = Math.abs(last) < EPS ? 0 : (shares[i] * panel.series[i][panel.length - 1]) / last
  }
  return {
    dates: Array.isArray(pricePanel.dates) ? pricePanel.dates.slice(0, panel.length) : null,
    values,
    returns,
    turnover: 0,
    weights: finalWeights,
    rebalances: 0,
  }
}

/**
 * Etiqueta de calendario de una fecha, según la frecuencia de rebalanceo.
 * @param {string} date
 * @param {'monthly' | 'quarterly' | 'annual'} frequency
 * @returns {string | null}
 */
function calendarBucket(date, frequency) {
  if (parseIsoDate(date) === null) return null
  const year = date.slice(0, 4)
  const month = Number(date.slice(5, 7))
  if (frequency === 'annual') return year
  if (frequency === 'quarterly') return `${year}-T${Math.ceil(month / 3)}`
  return date.slice(0, 7)
}

/**
 * Mezcla constante: cada rebalanceo devuelve la cartera a los pesos objetivo, vendiendo lo que
 * subió y comprando lo que bajó. Mínimo 1 periodo.
 * @param {{ dates?: string[] | null, values: Record<string, number[]> }} returnPanel rendimientos
 *   por periodo YA alineados y en una sola moneda; `dates` son las fechas de llegada de cada
 *   periodo y hacen falta para las frecuencias de calendario
 * @param {Record<string, number>} weights pesos objetivo por símbolo, se normalizan a 1
 * @param {'never' | 'monthly' | 'quarterly' | 'annual' | number} [rebalanceEvery] número de
 *   periodos entre rebalanceos (1 por omisión, o sea cada periodo), `'never'` para dejar correr,
 *   o una frecuencia de calendario
 * @returns {BacktestResult | null} `values` empieza en 1 y trae un elemento más que `returns`;
 *   `turnover` es la suma de Σ|w_objetivo − w_actual|/2 de cada rebalanceo, o sea la fracción de
 *   la cartera que se movió. null si el panel no cuadra, si la frecuencia no se entiende o si
 *   se pide calendario sin fechas
 */
export function constantMix(returnPanel, weights, rebalanceEvery = 1) {
  const panel = readPanel(returnPanel, 1)
  if (panel === null) return null
  const target = normalizedWeights(weights, panel.symbols)
  if (target === null) return null

  const calendar = rebalanceEvery === 'monthly' || rebalanceEvery === 'quarterly' || rebalanceEvery === 'annual'
  const asNumber = typeof rebalanceEvery === 'number' ? rebalanceEvery : NaN
  const everyN = isNum(asNumber) && asNumber >= 1 ? Math.floor(asNumber) : null
  if (!calendar && everyN === null && rebalanceEvery !== 'never') return null
  const dates = Array.isArray(returnPanel.dates) ? returnPanel.dates : null
  if (calendar && (dates === null || dates.length !== panel.length)) return null

  let w = [...target]
  /** @type {number[]} */
  const values = new Array(panel.length + 1)
  /** @type {number[]} */
  const returns = new Array(panel.length)
  values[0] = 1
  let turnover = 0
  let rebalances = 0
  let sinceRebalance = 0

  for (let t = 0; t < panel.length; t++) {
    let periodReturn = 0
    for (let i = 0; i < panel.symbols.length; i++) periodReturn += w[i] * panel.series[i][t]
    returns[t] = periodReturn
    values[t + 1] = values[t] * (1 + periodReturn)
    const growth = 1 + periodReturn
    if (Math.abs(growth) < EPS) return null
    w = w.map((wi, i) => (wi * (1 + panel.series[i][t])) / growth)

    sinceRebalance++
    let rebalance = false
    if (t < panel.length - 1) {
      if (everyN !== null) rebalance = sinceRebalance >= everyN
      else if (calendar && dates !== null) {
        const here = calendarBucket(dates[t], /** @type {'monthly' | 'quarterly' | 'annual'} */ (rebalanceEvery))
        const next = calendarBucket(dates[t + 1], /** @type {'monthly' | 'quarterly' | 'annual'} */ (rebalanceEvery))
        if (here === null || next === null) return null
        rebalance = here !== next
      }
    }
    if (rebalance) {
      let moved = 0
      for (let i = 0; i < w.length; i++) moved += Math.abs(target[i] - w[i])
      turnover += moved / 2
      w = [...target]
      rebalances++
      sinceRebalance = 0
    }
  }

  /** @type {Record<string, number>} */
  const finalWeights = {}
  for (let i = 0; i < panel.symbols.length; i++) finalWeights[panel.symbols[i]] = w[i]
  return { dates, values, returns, turnover, weights: finalWeights, rebalances }
}

/**
 * @typedef {{
 *   portReturns: number[],
 *   benchReturns: number[],
 *   active: number[],
 *   totalPort: number,
 *   totalBench: number,
 *   excess: number,
 *   trackingError: number | null,
 *   informationRatio: number | null,
 *   n: number,
 * }} BenchmarkComparison
 */

/**
 * Compara dos trayectorias de valor contra el mismo calendario. Mínimo 2 valores en cada una.
 * @param {number[]} values trayectoria del portafolio
 * @param {number[]} benchValues trayectoria del índice, misma moneda y mismas fechas
 * @param {{ k: number }} options `k` periodos por año para anualizar el tracking error
 * @returns {BenchmarkComparison | null} null si los largos no coinciden o si hay ceros que
 *   impiden calcular rendimientos
 */
export function withBenchmark(values, benchValues, { k }) {
  const v = numericArray(values, 2)
  const b = numericArray(benchValues, 2)
  if (v === null || b === null || v.length !== b.length || !isNum(k) || k <= 0) return null
  const portReturns = simpleReturns(v)
  const benchReturns = simpleReturns(b)
  if (portReturns === null || benchReturns === null) return null
  if (Math.abs(v[0]) < EPS || Math.abs(b[0]) < EPS) return null
  const active = portReturns.map((r, i) => r - benchReturns[i])
  const totalPort = v[v.length - 1] / v[0] - 1
  const totalBench = b[b.length - 1] / b[0] - 1
  return {
    portReturns,
    benchReturns,
    active,
    totalPort,
    totalBench,
    excess: totalPort - totalBench,
    trackingError: trackingError(active, k),
    informationRatio: informationRatio(active, k),
    n: active.length,
  }
}

/**
 * Rotación anualizada de una corrida: turnover total entre los años que duró.
 * @param {number} turnover turnover acumulado que devuelve `constantMix`
 * @param {number} periods número de periodos de la corrida
 * @param {number} k periodos por año
 * @returns {number | null}
 */
export function annualTurnover(turnover, periods, k) {
  if (!isNum(turnover) || !isNum(periods) || !isNum(k) || periods <= 0 || k <= 0) return null
  return turnover / (periods / k)
}

/**
 * Suma de los pesos de un objeto, para validar antes de correr un backtest.
 * @param {Record<string, number>} weights
 * @returns {number | null}
 */
export function weightsSum(weights) {
  if (!weights || typeof weights !== 'object') return null
  const values = numericArray(Object.values(weights))
  return values === null ? null : sumOf(values)
}
