// Rebanadas de dona (pura, con pruebas): descarta no positivos, ordena y junta el resto en "Otros"
// para que nunca haya más de 8 colores.
import { isNum } from '../../lib/format.js'
import { MAX_SERIES, resolveColor } from './series.js'

export const OTHERS = 'Otros'

/**
 * @param {{ label: string, value: number, color?: string | number }[]} data
 * @param {{ max?: number, sort?: boolean }} [options]
 * @returns {{ slices: { label: string, value: number, share: number, color: string, others?: boolean, members?: string[] }[], total: number }}
 */
export function toSlices(data, { max = MAX_SERIES, sort = true } = {}) {
  const clean = (data ?? []).filter((d) => isNum(d.value) && d.value > 0)
  const ordered = sort ? [...clean].sort((a, b) => b.value - a.value) : clean
  const limit = Math.min(max, MAX_SERIES)
  const keep = ordered.length > limit ? ordered.slice(0, limit - 1) : ordered
  const rest = ordered.length > limit ? ordered.slice(limit - 1) : []
  const total = clean.reduce((s, d) => s + d.value, 0)
  const slices = keep.map((d, i) => ({ label: d.label, value: d.value, share: total ? d.value / total : 0, color: resolveColor(d.color, i) }))
  if (rest.length) {
    const value = rest.reduce((s, d) => s + d.value, 0)
    slices.push({ label: OTHERS, value, share: total ? value / total : 0, color: 'var(--muted-2)', others: true, members: rest.map((d) => d.label) })
  }
  return { slices, total }
}

/** Trazo de un sector de anillo entre dos ángulos (radianes, 0 arriba, sentido horario). */
export function arcPath(cx, cy, r, inner, a0, a1) {
  const f = (n) => Number(n.toFixed(2))
  const full = a1 - a0 >= Math.PI * 2 - 1e-6
  if (full) {
    // Anillo completo: dos medias vueltas (un arco de 360° no se dibuja).
    return `M${f(cx)},${f(cy - r)}A${r},${r} 0 1,1 ${f(cx)},${f(cy + r)}A${r},${r} 0 1,1 ${f(cx)},${f(cy - r)}Z`
      + `M${f(cx)},${f(cy - inner)}A${inner},${inner} 0 1,0 ${f(cx)},${f(cy + inner)}A${inner},${inner} 0 1,0 ${f(cx)},${f(cy - inner)}Z`
  }
  const p = (rad, a) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)]
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = p(r, a0)
  const [x1, y1] = p(r, a1)
  const [x2, y2] = p(inner, a1)
  const [x3, y3] = p(inner, a0)
  return `M${f(x0)},${f(y0)}A${r},${r} 0 ${large},1 ${f(x1)},${f(y1)}L${f(x2)},${f(y2)}A${inner},${inner} 0 ${large},0 ${f(x3)},${f(y3)}Z`
}

/**
 * Trazos de las rebanadas de una dona de `size` px, con una separación fina entre ellas.
 * @template {{ share: number }} T
 * @param {T[]} slices @param {number} size @param {number} [hole] radio interior / exterior
 * @returns {(T & { d: string })[]}
 */
export function layoutArcs(slices, size, hole = 0.62) {
  const r = size / 2
  const inner = r * hole
  const gap = slices.length > 1 ? 0.012 : 0
  const out = []
  let angle = 0
  for (const s of slices) {
    const a0 = angle
    angle += s.share * Math.PI * 2
    out.push({ ...s, d: arcPath(r, r, r - 1, inner, a0 + gap / 2, Math.max(a0 + gap / 2, angle - gap / 2)) })
  }
  return out
}
