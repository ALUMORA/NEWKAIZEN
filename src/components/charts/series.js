// Colores y formas de serie. Solo tokens de C1: --chart-1 a --chart-8 en orden fijo, nunca en
// ciclo. En oscuro, tres series de dispersión no se distinguen solo por color (pedido 3 de C1),
// así que cada serie trae además una forma de marcador distinta.

export const MAX_SERIES = 8
export const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'triangle-down', 'cross', 'circle', 'square']

/** Color de la serie i (base 0): var(--chart-(i+1)). Pasado el 8 se queda en el 8, nunca vuelve al 1. */
export function seriesColor(i) {
  const n = Math.min(Math.max(0, Math.floor(i)), MAX_SERIES - 1) + 1
  return `var(--chart-${n})`
}

/** Color explícito de una serie ("--chart-3", "var(--up)" o número 1 a 8) o el de su posición. */
export function resolveColor(color, i) {
  if (typeof color === 'number') return seriesColor(color - 1)
  if (typeof color === 'string' && color.startsWith('--')) return `var(${color})`
  if (typeof color === 'string' && color.startsWith('var(')) return color
  return seriesColor(i)
}

/**
 * Trazo SVG de un marcador centrado en (x, y), con "radio" r.
 * @param {string} shape @param {number} x @param {number} y @param {number} r
 */
export function markerPath(shape, x, y, r) {
  const f = (n) => Number(n.toFixed(2))
  switch (shape) {
    case 'square':
      return `M${f(x - r * 0.85)},${f(y - r * 0.85)}h${f(r * 1.7)}v${f(r * 1.7)}h${f(-r * 1.7)}Z`
    case 'triangle':
      return `M${f(x)},${f(y - r * 1.1)}L${f(x + r)},${f(y + r * 0.75)}L${f(x - r)},${f(y + r * 0.75)}Z`
    case 'triangle-down':
      return `M${f(x)},${f(y + r * 1.1)}L${f(x + r)},${f(y - r * 0.75)}L${f(x - r)},${f(y - r * 0.75)}Z`
    case 'diamond':
      return `M${f(x)},${f(y - r * 1.2)}L${f(x + r * 1.2)},${f(y)}L${f(x)},${f(y + r * 1.2)}L${f(x - r * 1.2)},${f(y)}Z`
    case 'cross': {
      const a = r * 0.4
      return `M${f(x - a)},${f(y - r)}h${f(2 * a)}v${f(r - a)}h${f(r - a)}v${f(2 * a)}h${f(a - r)}v${f(r - a)}h${f(-2 * a)}v${f(a - r)}h${f(a - r)}v${f(-2 * a)}h${f(r - a)}Z`
    }
    default:
      return `M${f(x - r)},${f(y)}a${f(r)},${f(r)} 0 1,0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1,0 ${f(-2 * r)},0Z`
  }
}
