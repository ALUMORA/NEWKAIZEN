// Caída desde el máximo previo (drawdown), pura y con pruebas.
import { isNum } from '../../lib/format.js'

/**
 * De precios o valores de portafolio a caída desde el máximo: 0 en máximos, negativa abajo.
 * @param {{ date?: any, x?: number, value: number | null }[]} points
 * @returns {{ date?: any, x?: number, value: number | null }[]}
 */
export function drawdownFrom(points) {
  let peak = -Infinity
  return points.map((p) => {
    if (!isNum(p.value) || p.value <= 0) return { ...p, value: null }
    peak = Math.max(peak, p.value)
    return { ...p, value: p.value / peak - 1 }
  })
}

/** Punto de caída máxima (el más negativo); null si no hay datos. */
export function maxDrawdown(points) {
  let worst = null
  for (const p of points) if (isNum(p.value) && (worst === null || p.value < worst.value)) worst = p
  return worst
}
