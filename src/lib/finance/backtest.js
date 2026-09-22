// Backtest de una mezcla de activos, con dos estrategias honestas y distintas.
//
// El backtest viejo aplicaba los pesos de HOY a toda la historia y llamaba "rendimiento anual" al
// promedio aritmético por 52. Aquí:
// - `buyAndHold` compra una vez al inicio y no vuelve a tocar nada: los pesos se van de lado
//   solos, que es lo que de verdad le pasa a una cartera que nadie rebalancea. Es el caso base.
// - `constantMix` regresa a los pesos objetivo cada cierto tiempo. Rebalancear cada periodo con
//   estos números da .9975 y no rebalancear da .995: la diferencia no es ruido, es la estrategia.
// - El resumen se calcula con performance.summary, o sea CAGR, no promedios por 52.

import { ascendingIsoDates, EPS, isNum, normalizedWeights, numericArray, parseIsoDate, sumOf } from './_util.js'
import { simpleReturns } from './returns.js'
import { informationRatio, trackingError } from './benchmark.js'

/**
 * @typedef {{
 *   dates?: string[] | null,
 *   startDate?: string | null,
 *   values: Record<string, number[]>,
 * }} PanelLike
 */

/**
 * Resultado de un backtest. Las dos funciones devuelven esta misma forma, con la MISMA
 * correspondencia entre arreglos, para que una gráfica se arme igual venga de donde venga:
 *
 * - `values` es la trayectoria de 1 peso, empieza en 1 y su largo es siempre `returns.length + 1`.
 * - `dates` va 1 a 1 con `returns`: es la fecha de LLEGADA de cada periodo.
 * - `valueDates` va 1 a 1 con `values`: la fecha de arranque seguida de las de llegada.
 *
 * O sea que `dates.length === returns.length` y `valueDates.length === values.length`, siempre.
 * Cualquiera de los dos puede venir en null cuando el panel no trajo calendario: `constantMix`
 * solo puede armar `valueDates` si el panel incluye `startDate`, porque sus fechas son las de
 * llegada y la del arranque no está en ningún lado.
 *
 * @typedef {{
 *   dates: string[] | null,
 *   valueDates: string[] | null,
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
 * Calendario de un panel, ya validado. Un panel sin `dates` es legítimo (queda null); uno con
 * `dates` que no cuadran es un dato malo y no debe seguir corriendo.
 * @param {PanelLike} panel
 * @param {number} expectedLength cuántas fechas debe traer
 * @returns {string[] | null | undefined} el calendario, null si el panel no trae fechas, o
 *   `undefined` para avisar que las fechas vienen mal y el llamador debe devolver null
 */
function panelDates(panel, expectedLength) {
  const raw = panel.dates
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw) || raw.length !== expectedLength) return undefined
  if (ascendingIsoDates(raw) === null) return undefined
  return [...raw]
}

/**
 * Compra inicial y nada más: las participaciones quedan fijas y los pesos se mueven con los
 * precios. Mínimo 2 fechas.
 * @param {PanelLike} pricePanel precios YA alineados por fecha y en una sola moneda (ver
 *   returns.alignPanel); si trae `dates`, tiene que ser una fecha ISO por precio, ascendentes
 *   y sin repetir
 * @param {Record<string, number>} initialWeights pesos iniciales por símbolo; se normalizan para
 *   que sumen 1
 * @returns {BacktestResult | null} `values` es la trayectoria de 1 peso y empieza en 1;
 *   `valueDates` son las fechas del panel tal cual y `dates` las de llegada (una menos);
 *   `turnover` siempre 0. null si falta algún símbolo, si un precio inicial no es positivo, si
 *   el panel no cuadra o si `dates` no es un calendario ISO ascendente del largo de las series
 */
export function buyAndHold(pricePanel, initialWeights) {
  const panel = readPanel(pricePanel, 2)
  if (panel === null) return null
  const w0 = normalizedWeights(initialWeights, panel.symbols)
  if (w0 === null) return null
  const valueDates = panelDates(pricePanel, panel.length)
  if (valueDates === undefined) return null
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
    dates: valueDates === null ? null : valueDates.slice(1),
    valueDates,
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
 * @param {PanelLike} returnPanel rendimientos por periodo YA alineados y en una sola moneda;
 *   `dates` son las fechas de LLEGADA de cada periodo (una por rendimiento) y hacen falta para
 *   las frecuencias de calendario; `startDate` es opcional y sirve para armar `valueDates`, o sea
 *   para poder graficar la trayectoria con su propio eje de fechas
 * @param {Record<string, number>} weights pesos objetivo por símbolo, se normalizan a 1
 * @param {'never' | 'monthly' | 'quarterly' | 'annual' | number} [rebalanceEvery] número de
 *   periodos entre rebalanceos (1 por omisión, o sea cada periodo), `'never'` para dejar correr,
 *   o una frecuencia de calendario
 * @returns {BacktestResult | null} `values` empieza en 1 y trae un elemento más que `returns`;
 *   `dates` va 1 a 1 con `returns` y `valueDates` 1 a 1 con `values` (null si no hay
 *   `startDate`); `turnover` es la suma de Σ|w_objetivo − w_actual|/2 de cada rebalanceo, o sea
 *   la fracción de la cartera que se movió. null si el panel no cuadra, si `dates` no es un
 *   calendario ISO ascendente del largo de los rendimientos, si `startDate` no es anterior a la
 *   primera fecha de llegada, si la frecuencia no se entiende o si se pide calendario sin fechas
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
  const dates = panelDates(returnPanel, panel.length)
  if (dates === undefined) return null
  if (calendar && dates === null) return null

  // `values` arranca antes del primer periodo, así que su eje de fechas necesita la del arranque.
  /** @type {string[] | null} */
  let valueDates = null
  const startDate = returnPanel.startDate
  if (startDate !== undefined && startDate !== null) {
    const startMs = parseIsoDate(startDate)
    const firstMs = dates === null ? null : parseIsoDate(dates[0])
    if (startMs === null || firstMs === null || startMs >= firstMs) return null
    valueDates = [startDate, .../** @type {string[]} */ (dates)]
  }

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
  return { dates, valueDates, values, returns, turnover, weights: finalWeights, rebalances }
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
 *   k: number,
 *   n: number,
 * }} BenchmarkComparison
 */

/**
 * Compara dos trayectorias de valor contra el mismo calendario. Mínimo 2 valores en cada una.
 *
 * Sin `k` el tracking error y el information ratio salen POR PERIODO (k = 1), no anuales: el
 * `k` que se usó viene en el resultado justamente para que nadie etiquete como anual algo que
 * no lo es. Pásalo (252, 52 o 12) si vas a presentarlos como cifras anuales.
 *
 * @param {number[]} values trayectoria del portafolio
 * @param {number[]} benchValues trayectoria del índice, misma moneda y mismas fechas
 * @param {{ k?: number } | null} [options] `k` periodos por año para anualizar el tracking
 *   error; 1 por omisión, o sea sin anualizar
 * @returns {BenchmarkComparison | null} null si los largos no coinciden, si `k` no es positivo o
 *   si hay ceros que impiden calcular rendimientos
 */
export function withBenchmark(values, benchValues, options) {
  const { k = 1 } = options ?? {}
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
    k,
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
