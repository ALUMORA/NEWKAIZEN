// Riesgo de un portafolio: concentración, contribución al riesgo y exposiciones.
//
// La volatilidad total no dice de dónde viene el riesgo. Dos portafolios con la misma desviación
// estándar pueden tener uno de sus activos aportando el 80 % del riesgo. `riskContributions`
// reparte la volatilidad entre las posiciones y siempre suma 100 %.

import { EPS, dot, isNum, matVec, numericArray, numericMatrix, sumOf } from './_util.js'

/**
 * Número efectivo de posiciones: 1/Σw². Diez posiciones de 10 % dan 10; diez donde una pesa 90 %
 * dan 1.22. Es el recíproco del índice de Herfindahl.
 * @param {number[]} weights pesos, idealmente suman 1
 * @returns {number | null} null si la suma de cuadrados es ~0 o si la entrada no sirve
 */
export function effectiveN(weights) {
  const h = hhi(weights)
  if (h === null || h < EPS) return null
  return 1 / h
}

/**
 * Índice de Herfindahl-Hirschman: Σw². Va de 1/n (todo parejo) a 1 (todo en una posición).
 * @param {number[]} weights
 * @returns {number | null}
 */
export function hhi(weights) {
  const w = numericArray(weights, 1)
  if (w === null) return null
  return dot(w, w)
}

/**
 * Volatilidad del portafolio anualizada: √(wᵀΣw)·√k.
 * @param {number[]} weights pesos
 * @param {number[][]} cov matriz de covarianzas POR PERIODO, cuadrada y del tamaño de los pesos
 * @param {number} k periodos por año; con 1 devuelve la volatilidad por periodo
 * @returns {number | null} null si la varianza sale negativa (matriz no válida)
 */
export function portfolioVol(weights, cov, k) {
  const w = numericArray(weights, 1)
  const c = numericMatrix(cov, { square: true })
  if (w === null || c === null || c.length !== w.length || !isNum(k) || k <= 0) return null
  const varp = dot(w, matVec(c, w))
  if (varp < 0) return null
  return Math.sqrt(varp) * Math.sqrt(k)
}

/**
 * @typedef {{
 *   marginal: number[],
 *   contribution: number[],
 *   percent: number[],
 *   volatility: number,
 * }} RiskContributions
 */

/**
 * Reparto de la volatilidad entre las posiciones.
 * `marginal_i = (Σw)_i / σ_p` es cuánto sube la volatilidad si crece un poco ese peso;
 * `contribution_i = w_i · marginal_i` es lo que aporta esa posición, y suma exactamente σ_p;
 * `percent_i` es esa aportación como fracción del total, y suma 1.
 * @param {number[]} weights pesos
 * @param {number[][]} cov matriz de covarianzas por periodo, cuadrada
 * @returns {RiskContributions | null} null si la volatilidad es ~0 (no hay riesgo que repartir)
 */
export function riskContributions(weights, cov) {
  const w = numericArray(weights, 1)
  const c = numericMatrix(cov, { square: true })
  if (w === null || c === null || c.length !== w.length) return null
  const cw = matVec(c, w)
  const varp = dot(w, cw)
  if (varp <= 0) return null
  const vol = Math.sqrt(varp)
  if (vol < EPS) return null
  const marginal = cw.map((v) => v / vol)
  const contribution = marginal.map((v, i) => v * w[i])
  return { marginal, contribution, percent: contribution.map((v) => v / vol), volatility: vol }
}

/**
 * @typedef {{ key: string | null, value: number, weight: number | null }} Exposure
 */

/**
 * Agrupa posiciones por un atributo y saca cuánto pesa cada grupo.
 * Sirve para exposición por moneda, por sector o por país. Una posición sin ese atributo cae en
 * el grupo `null`, que la interfaz dibuja como "s/d"; no se inventa una categoría "otros".
 * @param {{ value: number }[]} positions posiciones con su valor de mercado, todas en la misma moneda
 * @param {string} key nombre del atributo a agrupar ('currency', 'sector', 'country'...)
 * @returns {Exposure[] | null} ordenadas de mayor a menor valor; `weight` viene en null si el
 *   total es ~0. null si `positions` no es un arreglo o si algún valor no es finito
 */
export function exposureBy(positions, key) {
  if (!Array.isArray(positions) || typeof key !== 'string') return null
  /** @type {Map<string | null, number>} */
  const byKey = new Map()
  for (const position of positions) {
    if (!position || typeof position !== 'object' || !isNum(position.value)) return null
    const raw = /** @type {Record<string, unknown>} */ (position)[key]
    const group = typeof raw === 'string' && raw !== '' ? raw : null
    byKey.set(group, (byKey.get(group) ?? 0) + position.value)
  }
  const total = sumOf([...byKey.values()])
  const usable = Math.abs(total) >= EPS
  return [...byKey.entries()]
    .map(([group, value]) => ({ key: group, value, weight: usable ? value / total : null }))
    .sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value
      if (a.key === null) return 1
      if (b.key === null) return -1
      return a.key < b.key ? -1 : 1
    })
}

/**
 * Exposición a una moneda distinta a la de reporte, como fracción del portafolio.
 *
 * Si alguna posición no trae `currency`, la respuesta es `null` y la pantalla muestra "s/d". Es
 * a propósito: antes esa posición caía del lado extranjero (porque su grupo es `key: null` y
 * `null !== 'MXN'`) y la pantalla acababa afirmando "33 % en moneda extranjera" cuando la verdad
 * es que no se sabe. Un dato ausente no se convierte en una afirmación.
 *
 * Para ver el detalle cuando esto devuelve null, usen `exposureBy(positions, 'currency')`, que sí
 * separa el grupo desconocido en `key: null` en vez de esconderlo.
 *
 * @param {{ value: number, currency?: string }[]} positions posiciones ya valuadas en la moneda base
 * @param {string} baseCurrency moneda de reporte, por ejemplo 'MXN'
 * @returns {number | null} fracción del valor en monedas distintas a la base; null si las
 *   posiciones no sirven, si el total es ~0 o si a alguna le falta la moneda
 */
export function foreignExposure(positions, baseCurrency) {
  const groups = exposureBy(positions, 'currency')
  if (groups === null || typeof baseCurrency !== 'string') return null
  let foreign = 0
  let total = 0
  for (const group of groups) {
    if (group.key === null) return null
    total += group.value
    if (group.key !== baseCurrency) foreign += group.value
  }
  if (Math.abs(total) < EPS) return null
  return foreign / total
}
