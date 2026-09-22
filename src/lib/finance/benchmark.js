// Comparación contra un índice de referencia: beta, alfa, tracking error, information ratio,
// Treynor y razones de captura.
//
// Regla que no se negocia: el portafolio y el índice tienen que estar en la MISMA moneda y con
// las mismas fechas. El código viejo comparaba acciones .MX en pesos contra ETFs de Estados
// Unidos en dólares, así que su beta medía sobre todo el tipo de cambio. Quien llame a estas
// funciones ya debe haber alineado con returns.alignPanel y convertido con fx.js.

import { EPS, isNum, numericArray, perPeriodSeries, sumOf } from './_util.js'
import { mean, ols, stdev } from './stats.js'

/**
 * @typedef {{
 *   alpha: number,
 *   alphaAnnual: number,
 *   alphaAnnualArithmetic: number,
 *   beta: number,
 *   r2: number,
 *   residualStd: number,
 *   k: number,
 *   n: number,
 * }} BenchmarkRegression
 */

/**
 * Regresión del exceso del portafolio contra el exceso del índice.
 * `alpha` es por periodo; `alphaAnnual` la compone ((1+α)^k − 1) y `alphaAnnualArithmetic` la
 * multiplica (α·k), que es como la reportan muchas fichas. Mínimo 3 periodos.
 *
 * Sin `k` no se anualiza nada (k = 1) y los dos campos "anuales" valen lo mismo que `alpha`, que
 * es la alfa POR PERIODO. Por eso el `k` que se usó viene en el resultado: para que la pantalla
 * no pueda etiquetar como anual una cifra que no lo es.
 *
 * @param {number[]} portExcess rendimientos del portafolio menos rf, por periodo
 * @param {number[]} benchExcess rendimientos del índice menos rf, por periodo, misma moneda
 * @param {number} [k] periodos por año (252, 52 o 12); con 1, que es lo que toma por omisión, las
 *   cifras "anuales" son las del periodo
 * @returns {BenchmarkRegression | null} null si los largos no coinciden, con n < 3, si `k` no es
 *   positivo o si el índice no varía
 */
export function regress(portExcess, benchExcess, k = 1) {
  if (!isNum(k) || k <= 0) return null
  const fit = ols(portExcess, benchExcess)
  if (fit === null) return null
  return {
    alpha: fit.alpha,
    alphaAnnual: (1 + fit.alpha) ** k - 1,
    alphaAnnualArithmetic: fit.alpha * k,
    beta: fit.beta,
    r2: fit.r2,
    residualStd: fit.residualStd,
    k,
    n: fit.n,
  }
}

/**
 * Ajuste de Blume: 0.67·β + 0.33. Acerca la beta histórica a 1 porque las betas estimadas
 * tienden a revertir hacia el mercado en el periodo siguiente.
 * @param {number} beta beta cruda de la regresión
 * @returns {number | null}
 */
export function blumeBeta(beta) {
  if (!isNum(beta)) return null
  return 0.67 * beta + 0.33
}

/**
 * Tracking error anualizado: desviación estándar de muestra del rendimiento activo por √k.
 * Mínimo 2 periodos.
 * @param {number[]} active rendimiento del portafolio menos el del índice, por periodo
 * @param {number} k periodos por año
 * @returns {number | null}
 */
export function trackingError(active, k) {
  const sd = stdev(active)
  if (sd === null || !isNum(k) || k <= 0) return null
  return sd * Math.sqrt(k)
}

/**
 * Information ratio: rendimiento activo promedio anualizado (media·k) entre el tracking error.
 * Mínimo 2 periodos.
 * @param {number[]} active rendimiento activo por periodo
 * @param {number} k periodos por año
 * @returns {number | null} null si el tracking error es ~0
 */
export function informationRatio(active, k) {
  const te = trackingError(active, k)
  const m = mean(active)
  if (te === null || m === null || te < EPS) return null
  return (m * k) / te
}

/**
 * Razón de Treynor: exceso promedio anualizado entre la beta. Premio por unidad de riesgo de
 * mercado, a diferencia de Sharpe que divide entre el riesgo total. Mínimo 1 periodo.
 * @param {number[]} portReturns rendimientos del portafolio por periodo
 * @param {number | number[]} rfPerPeriod tasa libre de riesgo por periodo
 * @param {number} beta beta contra el índice
 * @param {number} k periodos por año
 * @returns {number | null} null si la beta es ~0
 */
export function treynor(portReturns, rfPerPeriod, beta, k) {
  const r = numericArray(portReturns, 1)
  if (r === null || !isNum(beta) || !isNum(k) || k <= 0) return null
  if (Math.abs(beta) < EPS) return null
  const rf = perPeriodSeries(rfPerPeriod, r.length)
  if (rf === null) return null
  let acc = 0
  for (let i = 0; i < r.length; i++) acc += r[i] - rf[i]
  return ((acc / r.length) * k) / beta
}

/**
 * Alfa de Jensen ANUALIZADA y compuesta: (1+α)^k − 1, con α de la regresión de los excesos.
 * Para la alfa por periodo, la beta y la R², usar `regress`. Mínimo 3 periodos.
 * @param {number[]} portReturns rendimientos del portafolio por periodo
 * @param {number[]} benchReturns rendimientos del índice por periodo, misma moneda y fechas
 * @param {number | number[]} rfPerPeriod tasa libre de riesgo por periodo
 * @param {number} k periodos por año
 * @returns {number | null}
 */
export function jensenAlpha(portReturns, benchReturns, rfPerPeriod, k) {
  const p = numericArray(portReturns, 3)
  const b = numericArray(benchReturns, 3)
  if (p === null || b === null || p.length !== b.length) return null
  const rf = perPeriodSeries(rfPerPeriod, p.length)
  if (rf === null) return null
  const fit = regress(
    p.map((v, i) => v - rf[i]),
    b.map((v, i) => v - rf[i]),
    k,
  )
  return fit === null ? null : fit.alphaAnnual
}

/**
 * @typedef {{ up: number | null, down: number | null, upPeriods: number, downPeriods: number }} CaptureRatios
 */

/**
 * Razones de captura, compuestas: en los periodos en que el índice subió se acumula el
 * rendimiento del portafolio y el del índice, y se dividen; igual para los periodos de baja.
 * 1.10 de captura al alza quiere decir que en las subidas ganó 10 % más que el índice; 0.80 a la
 * baja, que perdió 20 % menos.
 * @param {number[]} port rendimientos del portafolio por periodo
 * @param {number[]} bench rendimientos del índice por periodo, misma moneda y fechas
 * @returns {CaptureRatios | null} null si los largos no coinciden. `up` o `down` vienen en null
 *   cuando no hubo periodos de ese lado o cuando el acumulado del índice es ~0
 */
export function captureRatios(port, bench) {
  const p = numericArray(port, 1)
  const b = numericArray(bench, 1)
  if (p === null || b === null || p.length !== b.length) return null
  let upPort = 1
  let upBench = 1
  let downPort = 1
  let downBench = 1
  let upPeriods = 0
  let downPeriods = 0
  for (let i = 0; i < p.length; i++) {
    if (b[i] > 0) {
      upPort *= 1 + p[i]
      upBench *= 1 + b[i]
      upPeriods++
    } else if (b[i] < 0) {
      downPort *= 1 + p[i]
      downBench *= 1 + b[i]
      downPeriods++
    }
  }
  const ratio = (portGrowth, benchGrowth, periods) => {
    if (periods === 0) return null
    const denominator = benchGrowth - 1
    if (Math.abs(denominator) < EPS) return null
    return (portGrowth - 1) / denominator
  }
  return {
    up: ratio(upPort, upBench, upPeriods),
    down: ratio(downPort, downBench, downPeriods),
    upPeriods,
    downPeriods,
  }
}

/**
 * Rendimiento activo periodo a periodo: portafolio menos índice.
 * @param {number[]} port rendimientos del portafolio por periodo
 * @param {number[]} bench rendimientos del índice por periodo, misma moneda y fechas
 * @returns {number[] | null} null si los largos no coinciden
 */
export function activeReturns(port, bench) {
  const p = numericArray(port, 1)
  const b = numericArray(bench, 1)
  if (p === null || b === null || p.length !== b.length) return null
  return p.map((v, i) => v - b[i])
}

/**
 * Exceso promedio por periodo de una serie contra otra. Ayudante para reportes.
 * @param {number[]} port
 * @param {number[]} bench
 * @returns {number | null}
 */
export function averageActive(port, bench) {
  const active = activeReturns(port, bench)
  return active === null ? null : sumOf(active) / active.length
}
