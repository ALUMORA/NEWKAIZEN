// Rendimientos esperados para el optimizador.
//
// El promedio histórico es el peor insumo posible de una optimización media-varianza: la media
// de una serie de rendimientos tiene un error estándar de σ/√T, o sea que con 3 años de datos
// semanales el intervalo de confianza de la media anual de una acción mide varias decenas de
// puntos porcentuales. Por eso el valor por omisión de la app es CAPM (rf + β·ERP), que solo
// necesita estimar β, y el promedio histórico se ofrece detrás de una advertencia explícita.
// `jamesStein` es el punto medio: encoge las medias hacia un objetivo común.
//
// Unidades: todo lo que aquí se llama "anual" es fracción anual (0.085 = 8.5 %). El resultado sale
// en la misma unidad que `rfAnnual` y `erp`, así que no se mezclan periodicidades por accidente.

import { assertSquare, assertVector, InvalidInputError, solveSPD } from './linalg.js'

/**
 * Rendimientos esperados por CAPM: μ_i = rf + β_i · ERP.
 *
 * No es una predicción: es el costo de capital que el mercado le pide a ese riesgo sistemático.
 * La ERP la manda el API en sus supuestos y el usuario la puede editar en la pantalla del
 * optimizador, porque es justo el número que más mueve el resultado.
 *
 * @param {number[]} betas betas de cada activo contra el mercado local, en la misma moneda
 * @param {number} rfAnnual tasa libre de riesgo anual, como fracción (CETES 28 efectiva anual)
 * @param {number} erp prima de riesgo de mercado anual, como fracción
 * @returns {number[]} μ anual por activo, como fracción
 * @throws {InvalidInputError} si `betas` está vacío o algo no es un número finito
 */
export function capmExpected(betas, rfAnnual, erp) {
  const b = assertVector(betas, 'las betas')
  if (!Number.isFinite(rfAnnual)) {
    throw new InvalidInputError('La tasa libre de riesgo tiene que ser un número finito.')
  }
  if (!Number.isFinite(erp)) {
    throw new InvalidInputError('La prima de riesgo de mercado tiene que ser un número finito.')
  }
  return b.map((beta) => rfAnnual + beta * erp)
}

/**
 * Promedio histórico anualizado por activo, con la advertencia pegada al resultado.
 *
 * El promedio es aritmético (media por periodo × k), que es lo que pide la optimización
 * media-varianza de un periodo. No es el CAGR: para un rendimiento compuesto está `cagr` en
 * `performance.js`.
 *
 * @param {number[][]} returnMatrix T x N: renglones = periodos, columnas = activos. Mínimo T = 2.
 * @param {number} k periodos por año (252 diaria, 52 semanal, 12 mensual)
 * @returns {{ mu: number[], perPeriod: number[], k: number, periods: number, noisy: boolean, warning: string } | null}
 *   `null` si hay menos de 2 periodos
 * @throws {InvalidInputError} si la matriz no es rectangular, trae NaN o k no es válido
 */
export function historicalMean(returnMatrix, k) {
  if (!Array.isArray(returnMatrix) || returnMatrix.length === 0) {
    throw new InvalidInputError('La matriz de rendimientos tiene que traer al menos un renglón.')
  }
  if (!Number.isFinite(k) || k <= 0) {
    throw new InvalidInputError('Los periodos por año (k) tienen que ser un número mayor que cero.')
  }
  const cols = Array.isArray(returnMatrix[0]) ? returnMatrix[0].length : 0
  if (cols === 0) throw new InvalidInputError('La matriz de rendimientos tiene que traer al menos una columna.')
  const T = returnMatrix.length
  const perPeriod = new Array(cols).fill(0)
  for (let t = 0; t < T; t += 1) {
    const row = returnMatrix[t]
    if (!Array.isArray(row) || row.length !== cols) {
      throw new InvalidInputError(`La matriz de rendimientos no es rectangular: el renglón ${t} no tiene ${cols} columnas.`)
    }
    for (let i = 0; i < cols; i += 1) {
      if (!Number.isFinite(row[i])) {
        throw new InvalidInputError(`La matriz de rendimientos tiene un valor que no es un número finito en (${t}, ${i}).`)
      }
      perPeriod[i] += row[i]
    }
  }
  if (T < 2) return null
  for (let i = 0; i < cols; i += 1) perPeriod[i] /= T

  const years = T / k
  return {
    mu: perPeriod.map((m) => m * k),
    perPeriod,
    k,
    periods: T,
    noisy: true,
    warning:
      `El promedio histórico se estimó con ${T} periodos (${years.toFixed(1)} años). ` +
      'Una media histórica trae mucho ruido y el optimizador lo amplifica: úsala para comparar, no como pronóstico.',
  }
}

/**
 * Contracción de James-Stein (fórmula Bayes-Stein de Jorion, 1986) de las medias hacia un
 * objetivo común.
 *
 * μ_JS = (1 − w)·μ̂ + w·μ₀·1, con w = (N + 2)/(N + 2 + T·d) y
 * d = (μ̂ − μ₀·1)ᵀ Σ⁻¹ (μ̂ − μ₀·1), con μ̂ y Σ POR PERIODO. Entre más dispersas estén las medias
 * respecto al objetivo (d grande), menos se encoge; entre más periodos (T grande), menos se encoge.
 *
 * UNIDADES, que aquí sí importan: d NO es invariante a la periodicidad. Si anualizas μ̂ y Σ con k,
 * d se multiplica por k y, sin corregirlo, la contracción sale como si hubiera k·T observaciones
 * (con datos semanales, unas 30 veces menos contracción de la que toca). Por eso:
 * - lo normal es pasar `means` y `cov` POR PERIODO, en la misma periodicidad en la que se contaron
 *   los T (`historicalMean(...).perPeriod` y la covarianza sin anualizar), con `k` = 1;
 * - si ya las tienes anualizadas, pasa `k` (52 semanal, 12 mensual, 252 diaria) y la cuenta se
 *   hace internamente por periodo. El resultado sale en la unidad en la que entró.
 *
 * El objetivo por omisión es el promedio simple de las medias (la "grand mean" del spec). Con
 * `target: 'minVariance'` se usa el rendimiento del portafolio de mínima varianza,
 * μ₀ = (1ᵀΣ⁻¹μ̂)/(1ᵀΣ⁻¹1), que es el que propone Jorion. El peso w es el mismo con los dos.
 *
 * @param {number[]} means medias por activo (μ̂): por periodo, o anualizadas si pasas `k`
 * @param {number[][]} cov covarianza N x N en la misma unidad que `means`
 * @param {number} T número de periodos con los que se estimaron las medias
 * @param {{ target?: 'average' | 'minVariance', k?: number }} [options]
 *   `k` cuántos periodos caben en la unidad de `means` y `cov`: 1 (por omisión) si vienen por
 *   periodo, o los periodos por año si vienen anualizadas
 * @returns {{ mu: number[], shrinkage: number, target: number } | null}
 *   `null` si Σ no se pudo factorizar (no es definida positiva ni con jitter).
 *   Con un solo activo devuelve la media tal cual y `shrinkage` 0.
 * @throws {InvalidInputError} si las dimensiones no casan, hay NaN, T < 1 o k no es mayor que cero
 */
export function jamesStein(means, cov, T, { target = 'average', k = 1 } = {}) {
  const mu = assertVector(means, 'las medias')
  const S = assertSquare(cov, 'la covarianza')
  if (mu.length !== S.length) {
    throw new InvalidInputError(`Hay ${mu.length} medias y la covarianza es de ${S.length}.`)
  }
  if (!Number.isFinite(T) || T < 1) {
    throw new InvalidInputError('El número de periodos T tiene que ser un número mayor o igual a 1.')
  }
  if (!Number.isFinite(k) || k <= 0) {
    throw new InvalidInputError('Los periodos por unidad (k) tienen que ser un número mayor que cero.')
  }
  const n = mu.length
  if (n === 1) return { mu: [mu[0]], shrinkage: 0, target: mu[0] }

  let mu0
  if (target === 'average') {
    mu0 = mu.reduce((a, b) => a + b, 0) / n
  } else {
    const ones = new Array(n).fill(1)
    const sInvOnes = solveSPD(S, ones)
    const sInvMu = solveSPD(S, mu)
    if (!sInvOnes || !sInvMu) return null
    let num = 0
    let den = 0
    for (let i = 0; i < n; i += 1) {
      num += sInvMu[i]
      den += sInvOnes[i]
    }
    if (den === 0) return null
    mu0 = num / den
  }

  const diff = mu.map((m) => m - mu0)
  const sInvDiff = solveSPD(S, diff)
  if (!sInvDiff) return null
  let d = 0
  for (let i = 0; i < n; i += 1) d += diff[i] * sInvDiff[i]
  // Con μ̂ y Σ en unidades de k periodos, d = k·d_periodo: se regresa a la unidad de los T.
  const dPerPeriod = d / k

  // d ≈ 0 quiere decir que las medias ya son el objetivo: se encoge del todo, que da lo mismo.
  const w = dPerPeriod > 0 ? (n + 2) / (n + 2 + T * dPerPeriod) : 1
  const shrinkage = Math.max(0, Math.min(1, w))
  return {
    mu: mu.map((m) => (1 - shrinkage) * m + shrinkage * mu0),
    shrinkage,
    target: mu0,
  }
}
