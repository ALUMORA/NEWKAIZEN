// Percentil del VIX contra sus propios cierres diarios de los últimos 5 años. Reemplaza al viejo
// "Miedo y codicia", que era una transformación casera del VIX con nombre de emoción: aquí solo se
// dice dónde queda el nivel de hoy dentro de su historia, sin etiqueta de ánimo.
import { percentile } from '../../../lib/finance/performance.js'

/** Ventana de comparación: la misma que cita el glosario ("los últimos cinco años"). */
export const VIX_WINDOW = /** @type {const} */ ({ range: '5y', interval: '1d', years: 5 })

/**
 * Fracción de los valores que quedaron en `x` o por debajo (función de distribución empírica).
 * @param {(number | null | undefined)[]} values @param {number} x @returns {number | null}
 */
export function percentRank(values, x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null
  const v = (values ?? []).filter((n) => typeof n === 'number' && Number.isFinite(n))
  if (!v.length) return null
  let atOrBelow = 0
  for (const n of v) if (n <= x) atOrBelow += 1
  return atOrBelow / v.length
}

/**
 * Contexto del VIX de hoy dentro de su historia.
 * @param {{ dates?: string[], close?: (number | null)[] } | null | undefined} history
 * @param {number | null | undefined} current
 * @returns {{ rank: number, n: number, from: string | null, to: string | null, min: number, max: number, p25: number, p50: number, p75: number } | null}
 */
export function vixContext(history, current) {
  const dates = history?.dates ?? []
  const pairs = (history?.close ?? []).map((c, i) => [dates[i] ?? null, c]).filter(([, c]) => typeof c === 'number' && Number.isFinite(c))
  if (pairs.length < 2 || typeof current !== 'number' || !Number.isFinite(current)) return null
  const values = pairs.map(([, c]) => /** @type {number} */ (c))
  const rank = /** @type {number} */ (percentRank(values, current))
  return {
    rank,
    n: values.length,
    from: pairs[0][0],
    to: pairs.at(-1)[0],
    min: Math.min(...values),
    max: Math.max(...values),
    p25: /** @type {number} */ (percentile(values, 0.25)),
    p50: /** @type {number} */ (percentile(values, 0.5)),
    p75: /** @type {number} */ (percentile(values, 0.75)),
  }
}

/** Número de percentil para mostrar (0 a 100, entero). */
export const percentileNumber = (rank) => Math.round(rank * 100)

/** En qué cuarta parte de su historia queda, dicho sin adjetivos de ánimo. */
export function quartileText(rank) {
  if (rank < 0.25) return 'en la cuarta parte más baja de su historia reciente'
  if (rank < 0.5) return 'debajo de su mediana, en la segunda cuarta parte'
  if (rank < 0.75) return 'arriba de su mediana, en la tercera cuarta parte'
  return 'en la cuarta parte más alta de su historia reciente'
}
