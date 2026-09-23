// Escala divergente de cinco pasos (azul, neutro, naranja) para el Heatmap. La correlación no es
// buena ni mala, por eso no va en verde y rojo (brief de C1).
import { isNum } from '../../lib/format.js'

export const DIVERGING = ['var(--div-neg-2)', 'var(--div-neg-1)', 'var(--div-0)', 'var(--div-pos-1)', 'var(--div-pos-2)']

/** Cortes relativos al máximo del dominio: ±0.2 es neutro, ±0.6 separa los dos tonos. */
export const CUTS = [-0.6, -0.2, 0.2, 0.6]

/**
 * Índice 0 a 4 del color de un valor en un dominio simétrico [−max, max]; −1 si falta.
 * @param {unknown} value @param {number} max
 */
export function divergingIndex(value, max) {
  if (!isNum(value) || !(max > 0)) return -1
  const t = value / max
  if (t < CUTS[0]) return 0
  if (t < CUTS[1]) return 1
  if (t <= CUTS[2]) return 2
  if (t <= CUTS[3]) return 3
  return 4
}

/** Máximo absoluto de una matriz (para el dominio simétrico); 1 si no hay datos. */
export function maxAbs(matrix) {
  let m = 0
  for (const row of matrix ?? []) for (const v of row ?? []) if (isNum(v)) m = Math.max(m, Math.abs(v))
  return m || 1
}
