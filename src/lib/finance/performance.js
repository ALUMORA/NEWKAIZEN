// Desempeño y riesgo de una sola serie: CAGR, volatilidad, Sharpe, Sortino, caídas, VaR y CVaR.
//
// Dos errores del código viejo que aquí quedan corregidos:
// - "rendimiento anual" era el promedio aritmético por 52, no un CAGR. El promedio aritmético de
//   +50 % y −50 % es 0, pero el dinero se quedó en 75 centavos de cada peso: el CAGR es −13.4 %.
// - La anualización traía el 52 escondido. Aquí `k` es siempre un argumento.

import { EPS, isNum, numericArray, perPeriodSeries, sumOf } from './_util.js'
import { cumulative } from './returns.js'
import { mean, normalInvCdf, normalPdf, quantile, stdev } from './stats.js'

/**
 * Tasa de crecimiento anual compuesta entre dos valores.
 * @param {number} startValue valor inicial, positivo
 * @param {number} endValue valor final, positivo
 * @param {number} years años transcurridos, positivo
 * @returns {number | null} null si algún valor no es positivo o los años no son positivos
 */
export function cagr(startValue, endValue, years) {
  if (!isNum(startValue) || !isNum(endValue) || !isNum(years)) return null
  if (startValue <= 0 || endValue <= 0 || years <= 0) return null
  return (endValue / startValue) ** (1 / years) - 1
}

/**
 * CAGR a partir de rendimientos por periodo: (∏(1+r))^(k/n) − 1. Mínimo 1 periodo.
 * Con k = 1 devuelve el promedio geométrico por periodo.
 * @param {number[]} returns rendimientos simples por periodo
 * @param {number} k periodos por año (252, 52, 12)
 * @returns {number | null} null si el capital acumulado llega a cero o menos (pérdida total),
 *   porque ahí la raíz no existe
 */
export function cagrFromReturns(returns, k) {
  const r = numericArray(returns, 1)
  if (r === null || !isNum(k) || k <= 0) return null
  let growth = 1
  for (let i = 0; i < r.length; i++) growth *= 1 + r[i]
  if (growth <= 0) return null
  return growth ** (k / r.length) - 1
}

/**
 * Volatilidad anualizada: desviación estándar de muestra por √k. Mínimo 2 periodos.
 * @param {number[]} returns
 * @param {number} k periodos por año
 * @returns {number | null}
 */
export function annualizedVol(returns, k) {
  const sd = stdev(returns)
  if (sd === null || !isNum(k) || k <= 0) return null
  return sd * Math.sqrt(k)
}

/**
 * Razón de Sharpe anualizada sobre rendimientos en exceso: mean(e)/sd(e)·√k, con e = r − rf.
 * Mínimo 2 periodos.
 * @param {number[]} returns rendimientos simples por periodo
 * @param {number | number[]} rfPerPeriod tasa libre de riesgo POR PERIODO, constante o serie
 *   alineada con `returns` (ver rates.rfSeriesForDates)
 * @param {number} k periodos por año
 * @returns {number | null} null si la desviación de los excesos es ~0
 */
export function sharpe(returns, rfPerPeriod, k) {
  const r = numericArray(returns, 2)
  if (r === null || !isNum(k) || k <= 0) return null
  const rf = perPeriodSeries(rfPerPeriod, r.length)
  if (rf === null) return null
  const excess = r.map((v, i) => v - rf[i])
  const sd = stdev(excess)
  const m = mean(excess)
  if (sd === null || m === null || sd < EPS) return null
  return (m / sd) * Math.sqrt(k)
}

/**
 * Razón de Sortino anualizada. La desviación a la baja se calcula sobre TODAS las n
 * observaciones, no solo sobre las negativas: DD = √(Σ min(0, r − MAR)² / n).
 * Contar solo las negativas infla la razón y es el error más común de esta métrica.
 * Mínimo 2 periodos.
 * @param {number[]} returns
 * @param {number | number[]} rfPerPeriod tasa libre de riesgo por periodo
 * @param {number} k periodos por año
 * @param {number | number[]} [marPerPeriod] rendimiento mínimo aceptable por periodo;
 *   por omisión la misma rf
 * @returns {number | null} null si no hubo ninguna observación bajo el MAR (DD = 0)
 */
export function sortino(returns, rfPerPeriod, k, marPerPeriod) {
  const r = numericArray(returns, 2)
  if (r === null || !isNum(k) || k <= 0) return null
  const rf = perPeriodSeries(rfPerPeriod, r.length)
  if (rf === null) return null
  const mar = perPeriodSeries(marPerPeriod === undefined ? rfPerPeriod : marPerPeriod, r.length)
  if (mar === null) return null
  const excess = r.map((v, i) => v - rf[i])
  let acc = 0
  for (let i = 0; i < r.length; i++) {
    const below = Math.min(0, r[i] - mar[i])
    acc += below * below
  }
  const dd = Math.sqrt(acc / r.length)
  if (dd < EPS) return null
  return (sumOf(excess) / r.length / dd) * Math.sqrt(k)
}

/**
 * @typedef {{
 *   series: number[],
 *   maxDrawdown: number,
 *   peakIndex: number,
 *   troughIndex: number,
 *   recoveryIndex: number | null,
 *   durationPeriods: number,
 * }} Drawdowns
 */

/**
 * Caídas desde el máximo previo. `series[t] = W_t / máximo hasta t − 1`, siempre ≤ 0.
 * `maxDrawdown` es negativo (−.3333 es una caída de 33.33 %). `peakIndex` es el máximo anterior
 * al fondo, `recoveryIndex` el primer momento en que se recupera ese máximo (null si no se
 * recuperó) y `durationPeriods` va del máximo a la recuperación, o al final si no la hubo.
 * Mínimo 2 valores.
 * @param {number[]} values trayectoria de valor del portafolio (no rendimientos)
 * @returns {Drawdowns | null} null si algún valor no es positivo
 */
export function drawdowns(values) {
  const w = numericArray(values, 2)
  if (w === null) return null
  for (let i = 0; i < w.length; i++) if (w[i] <= 0) return null
  /** @type {number[]} */
  const series = new Array(w.length)
  let peak = w[0]
  let peakAt = 0
  let worst = 0
  let worstPeak = 0
  let troughIndex = 0
  for (let i = 0; i < w.length; i++) {
    if (w[i] > peak) {
      peak = w[i]
      peakAt = i
    }
    series[i] = w[i] / peak - 1
    if (series[i] < worst) {
      worst = series[i]
      worstPeak = peakAt
      troughIndex = i
    }
  }
  let recoveryIndex = null
  for (let i = troughIndex + 1; i < w.length; i++) {
    if (w[i] >= w[worstPeak]) {
      recoveryIndex = i
      break
    }
  }
  return {
    series,
    maxDrawdown: worst,
    peakIndex: worstPeak,
    troughIndex,
    recoveryIndex,
    durationPeriods: (recoveryIndex ?? w.length - 1) - worstPeak,
  }
}

/**
 * Razón de Calmar: CAGR entre la caída máxima en valor absoluto.
 * @param {number} cagrValue CAGR ya calculado
 * @param {number} maxDrawdown caída máxima, negativa
 * @returns {number | null} null si la caída máxima es ~0 (no hubo caída que dividir)
 */
export function calmar(cagrValue, maxDrawdown) {
  if (!isNum(cagrValue) || !isNum(maxDrawdown)) return null
  if (Math.abs(maxDrawdown) < EPS) return null
  return cagrValue / Math.abs(maxDrawdown)
}

/**
 * Número de observaciones en la cola: k = ⌈n(1−α)⌉, al menos 1.
 *
 * El redondeo a 12 cifras significativas no es adorno: en punto flotante 20·(1−.95) da
 * 1.0000000000000009, y el techo lo convertiría en 2. El VaR al 95 % de 20 observaciones saldría
 * de la segunda peor en vez de la peor, que es justo la respuesta conocida del spec.
 * @param {number} n
 * @param {number} alpha
 * @returns {number}
 */
function tailCount(n, alpha) {
  return Math.max(1, Math.ceil(Number((n * (1 - alpha)).toPrecision(12))))
}

/**
 * VaR histórico: la k-ésima peor observación, con k = ⌈n(1−α)⌉. Se devuelve como pérdida
 * positiva (.05 quiere decir "se puede perder 5 %"). Mínimo 1 observación.
 * @param {number[]} returns
 * @param {number} alpha nivel de confianza, por ejemplo .95
 * @returns {number | null} null si alpha no está en (0, 1)
 */
export function historicalVaR(returns, alpha) {
  const r = numericArray(returns, 1)
  if (r === null || !isNum(alpha) || alpha <= 0 || alpha >= 1) return null
  const sorted = [...r].sort((a, b) => a - b)
  return -sorted[tailCount(r.length, alpha) - 1]
}

/**
 * CVaR histórico (pérdida esperada en la cola): promedio de las k peores observaciones,
 * con k = ⌈n(1−α)⌉. Se devuelve como pérdida positiva. Mínimo 1 observación.
 * @param {number[]} returns
 * @param {number} alpha nivel de confianza
 * @returns {number | null}
 */
export function historicalCVaR(returns, alpha) {
  const r = numericArray(returns, 1)
  if (r === null || !isNum(alpha) || alpha <= 0 || alpha >= 1) return null
  const sorted = [...r].sort((a, b) => a - b)
  const k = tailCount(r.length, alpha)
  return -(sumOf(sorted.slice(0, k)) / k)
}

/**
 * VaR paramétrico normal: −(μ + σ·z_{1−α}). Se devuelve como pérdida positiva.
 * Supone rendimientos normales, cosa que los mercados no cumplen: subestima las colas.
 * @param {number} mu media por periodo
 * @param {number} sigma desviación estándar por periodo, positiva
 * @param {number} alpha nivel de confianza, en (0,1) abierto
 * @returns {number | null} null si algún argumento no es un número finito, si sigma es negativa
 *   o si alpha se sale de (0,1). Un alpha que llega como texto tampoco pasa
 */
export function parametricVaR(mu, sigma, alpha) {
  if (!isNum(mu) || !isNum(sigma) || sigma < 0) return null
  if (!isNum(alpha) || alpha <= 0 || alpha >= 1) return null
  const z = normalInvCdf(1 - alpha)
  if (z === null) return null
  return -(mu + sigma * z)
}

/**
 * CVaR paramétrico normal: −(μ − σ·φ(z_{1−α})/(1−α)). Se devuelve como pérdida positiva.
 * @param {number} mu media por periodo
 * @param {number} sigma desviación estándar por periodo, positiva
 * @param {number} alpha nivel de confianza, en (0,1) abierto
 * @returns {number | null} null con las mismas reglas que `parametricVaR`
 */
export function parametricCVaR(mu, sigma, alpha) {
  if (!isNum(mu) || !isNum(sigma) || sigma < 0) return null
  if (!isNum(alpha) || alpha <= 0 || alpha >= 1) return null
  const z = normalInvCdf(1 - alpha)
  const pdf = z === null ? null : normalPdf(z)
  if (z === null || pdf === null) return null
  return -(mu - (sigma * pdf) / (1 - alpha))
}

/**
 * @typedef {{
 *   cagr: number | null,
 *   vol: number | null,
 *   sharpe: number | null,
 *   sortino: number | null,
 *   maxDrawdown: number | null,
 *   calmar: number | null,
 *   var95: number | null,
 *   cvar95: number | null,
 *   best: number,
 *   worst: number,
 *   positivePct: number,
 *   n: number,
 *   years: number,
 * }} PerformanceSummary
 */

/**
 * Resumen de desempeño de una serie de rendimientos. Cada campo puede venir en null por separado
 * (por ejemplo `calmar` cuando nunca hubo caída), para que la interfaz muestre "s/d" solo en ese
 * dato y no en todo el bloque. Mínimo 2 periodos.
 * @param {number[]} returns rendimientos simples por periodo, en una sola moneda
 * @param {{ k: number, rf?: number | number[] } | null} [options] `k` periodos por año (252, 52
 *   o 12) y `rf` por periodo. `k` es obligatorio: sin él devuelve null, porque suponerlo sería
 *   justo el 52 escondido que esta librería vino a quitar
 * @returns {PerformanceSummary | null} null con menos de 2 periodos, con datos no finitos o sin
 *   un `k` positivo
 */
export function summary(returns, options) {
  const { k, rf = 0 } = options ?? {}
  const r = numericArray(returns, 2)
  if (r === null || !isNum(k) || k <= 0) return null
  const values = cumulative(r)
  const dd = values === null ? null : drawdowns(values)
  const growth = cagrFromReturns(r, k)
  const maxDrawdown = dd === null ? null : dd.maxDrawdown
  // Un solo recorrido, sin `Math.max(...r)`: el spread revienta el límite de argumentos del
  // motor con series largas (RangeError arriba de unos 100 mil puntos) y esta librería promete
  // null, no excepciones.
  let positives = 0
  let best = r[0]
  let worst = r[0]
  for (let i = 0; i < r.length; i++) {
    if (r[i] > 0) positives++
    if (r[i] > best) best = r[i]
    if (r[i] < worst) worst = r[i]
  }
  return {
    cagr: growth,
    vol: annualizedVol(r, k),
    sharpe: sharpe(r, rf, k),
    sortino: sortino(r, rf, k),
    maxDrawdown,
    calmar: growth === null || maxDrawdown === null ? null : calmar(growth, maxDrawdown),
    var95: historicalVaR(r, 0.95),
    cvar95: historicalCVaR(r, 0.95),
    best,
    worst,
    positivePct: positives / r.length,
    n: r.length,
    years: r.length / k,
  }
}

/**
 * Percentil de una serie por interpolación lineal, ordenando primero. Envoltura de
 * `stats.quantile` para quien no tiene los datos ordenados.
 * @param {number[]} values
 * @param {number} q entre 0 y 1
 * @returns {number | null}
 */
export function percentile(values, q) {
  const v = numericArray(values, 1)
  if (v === null) return null
  return quantile([...v].sort((a, b) => a - b), q)
}
