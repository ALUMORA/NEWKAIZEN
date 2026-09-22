// Estadística de muestra y funciones de la normal.
//
// Todo lo que estima dispersión usa n−1 (varianza de muestra), que es lo que corresponde cuando
// los rendimientos observados son una muestra y no la población completa. Es la diferencia entre
// numpy con ddof=1 y numpy por omisión, y con series cortas se nota.

import { EPS, isNum, numericArray, sumOf } from './_util.js'

/**
 * Promedio aritmético. Mínimo 1 observación.
 * @param {number[]} values
 * @returns {number | null}
 */
export function mean(values) {
  const v = numericArray(values, 1)
  if (v === null) return null
  return sumOf(v) / v.length
}

/**
 * Varianza de muestra (n−1). Mínimo 2 observaciones.
 * @param {number[]} values
 * @returns {number | null}
 */
export function variance(values) {
  const v = numericArray(values, 2)
  if (v === null) return null
  const m = sumOf(v) / v.length
  let acc = 0
  for (let i = 0; i < v.length; i++) {
    const d = v[i] - m
    acc += d * d
  }
  return acc / (v.length - 1)
}

/**
 * Desviación estándar de muestra (n−1). Mínimo 2 observaciones.
 * @param {number[]} values
 * @returns {number | null}
 */
export function stdev(values) {
  const varr = variance(values)
  return varr === null ? null : Math.sqrt(varr)
}

/**
 * Covarianza de muestra (n−1) entre dos series del mismo largo. Mínimo 2 observaciones.
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number | null} null si los largos no coinciden
 */
export function covariance(x, y) {
  const a = numericArray(x, 2)
  const b = numericArray(y, 2)
  if (a === null || b === null || a.length !== b.length) return null
  const ma = sumOf(a) / a.length
  const mb = sumOf(b) / b.length
  let acc = 0
  for (let i = 0; i < a.length; i++) acc += (a[i] - ma) * (b[i] - mb)
  return acc / (a.length - 1)
}

/**
 * Correlación de Pearson. Mínimo 2 observaciones.
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number | null} null si alguna serie es constante (la correlación no está definida)
 */
export function correlation(x, y) {
  const cov = covariance(x, y)
  const sx = stdev(x)
  const sy = stdev(y)
  if (cov === null || sx === null || sy === null) return null
  if (sx < EPS || sy < EPS) return null
  return cov / (sx * sy)
}

/**
 * Cuantil por interpolación lineal, tipo 7 (el mismo que numpy y R por omisión):
 * h = (n−1)·q, y se interpola entre los dos vecinos.
 * @param {number[]} sorted valores YA ordenados de menor a mayor
 * @param {number} q entre 0 y 1
 * @returns {number | null} null con arreglo vacío, datos no finitos o q fuera de [0, 1]
 */
export function quantile(sorted, q) {
  const v = numericArray(sorted, 1)
  if (v === null || !isNum(q) || q < 0 || q > 1) return null
  if (v.length === 1) return v[0]
  const h = (v.length - 1) * q
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, v.length - 1)
  return v[lo] + (h - lo) * (v[hi] - v[lo])
}

/**
 * @typedef {{
 *   alpha: number,
 *   beta: number,
 *   r2: number,
 *   residualStd: number,
 *   n: number,
 * }} Regression
 */

/**
 * Mínimos cuadrados de y sobre x: y = alpha + beta·x.
 * Mínimo 3 observaciones, porque con 2 el ajuste es perfecto y `residualStd` no existe
 * (se divide entre n−2).
 * @param {number[]} y variable dependiente
 * @param {number[]} x variable independiente
 * @returns {Regression | null} null si los largos no coinciden, con n < 3 o si x es constante
 */
export function ols(y, x) {
  const a = numericArray(y, 3)
  const b = numericArray(x, 3)
  if (a === null || b === null || a.length !== b.length) return null
  const n = a.length
  const my = sumOf(a) / n
  const mx = sumOf(b) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = b[i] - mx
    const dy = a[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx < EPS) return null
  const beta = sxy / sxx
  const alpha = my - beta * mx
  const sse = Math.max(syy - beta * sxy, 0)
  const r2 = syy < EPS ? 0 : 1 - sse / syy
  return { alpha, beta, r2, residualStd: Math.sqrt(sse / (n - 2)), n }
}

const SQRT_2PI = Math.sqrt(2 * Math.PI)

/**
 * Densidad de la normal estándar φ(z).
 * @param {number} z
 * @returns {number | null}
 */
export function normalPdf(z) {
  if (!isNum(z)) return null
  return Math.exp(-0.5 * z * z) / SQRT_2PI
}

/**
 * Acumulada de la normal estándar Φ(z), por la serie Φ(z) = ½ + φ(z)·Σ z^(2n+1)/(2n+1)!!.
 * Todos los términos son positivos, así que no hay cancelación y el error queda al nivel del
 * doble; más allá de |z| = 9 la cola vale menos que la precisión de un double.
 * @param {number} z
 * @returns {number | null}
 */
export function normalCdf(z) {
  if (!isNum(z)) return null
  if (z < 0) {
    const upper = normalCdf(-z)
    return upper === null ? null : 1 - upper
  }
  if (z > 9) return 1
  let term = z
  let acc = z
  for (let n = 1; n < 400; n++) {
    term *= (z * z) / (2 * n + 1)
    acc += term
    if (term < 1e-18 * acc) break
  }
  return 0.5 + (Math.exp(-0.5 * z * z) / SQRT_2PI) * acc
}

// Coeficientes de la aproximación racional de Peter Acklam para la inversa de la normal.
const A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
const P_LOW = 0.02425

/** |z| a partir del cual el refinamiento de Halley estorba en vez de ayudar (ver normalInvCdf). */
const HALLEY_MAX_Z = 5

/**
 * Inversa de la acumulada normal estándar (cuantil z de una probabilidad p), por Acklam con un
 * paso de refinamiento de Halley usando `normalCdf`. Con la aproximación cruda el VaR al 95 % se
 * movía en el sexto decimal, que es justo lo que este refinamiento vino a arreglar.
 *
 * Exactitud medida contra `scipy.stats.norm.ppf` en 25 valores de p de 1e−13 a 1 − 1e−13, y esto
 * es lo que se promete, ni más:
 * - p entre 1e−6 y 1 − 1e−6: error relativo ≤ 1e−11 (peor caso medido 7.2e−12). Ahí viven todos
 *   los niveles de confianza que usa la app (.90 a .9999), y ahí está amarrado con casos golden.
 * - fuera de ese rango: Acklam crudo, error relativo ≤ 2e−9 (peor caso medido 1.1e−9), que es su
 *   precisión de diseño. También hay casos golden en p = 1e−8 y 1 − 1e−8 para que no se afloje.
 *
 * El refinamiento se salta en las colas a propósito, porque ahí EMPEORA. `normalCdf` calcula la
 * cola superior como 1 − Φ(−z), que no tiene precisión relativa cuando Φ ya vale casi 1, así que
 * el residual `cdf − p` del paso de Halley es puro ruido: en p = 1 − 1e−12 el "refinamiento"
 * llegaba a un error de 6.6e−6, mil veces peor que no haberlo hecho.
 *
 * @param {number} p probabilidad en (0, 1)
 * @returns {number | null} null fuera de (0, 1) o si p no es número
 */
export function normalInvCdf(p) {
  if (!isNum(p) || p <= 0 || p >= 1) return null
  let x
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
  } else if (p <= 1 - P_LOW) {
    const q = p - 0.5
    const r = q * q
    x = ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
  }
  // En las colas el residual de Halley es ruido de cancelación, así que ahí mandamos el Acklam
  // crudo. El corte se midió contra scipy: entre 4.8 y 5.5 el resultado es idéntico (peor caso
  // 7.2e−12 adentro del rango útil y 1.1e−9 afuera), así que 5 queda a media meseta.
  if (Math.abs(x) > HALLEY_MAX_Z) return x
  const cdf = normalCdf(x)
  const pdf = normalPdf(x)
  if (cdf === null || pdf === null || pdf < EPS) return x
  const e = cdf - p
  const u = e / pdf
  return x - u / (1 + (x * u) / 2)
}
