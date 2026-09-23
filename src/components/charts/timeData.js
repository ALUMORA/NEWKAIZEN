// Preparación de datos de TimeSeries (pura, con pruebas): une las x de todas las series y bandas,
// calcula el dominio de y y arma los trazos SVG con cortes en los faltantes.
import { isNum } from '../../lib/format.js'
import { logTicks, niceTicks, toMs } from './scale.js'
import { resolveColor } from './series.js'

/** x de un punto: fecha (ms) en modo tiempo o número en modo numérico. */
function xOf(p, xType) {
  if (!p) return null
  if (xType === 'number') return isNum(p.x) ? p.x : null
  return toMs(p.date ?? p.x)
}

/**
 * @param {any[]} series [{ id, label, points: [{ date|x, value }], color?, area?, dash? }]
 * @param {any[]} bands [{ id, label, points: [{ date|x, lower, upper }], color? }]
 * @param {'time' | 'number'} xType
 */
export function prepareTime(series = [], bands = [], xType = 'time') {
  const xsSet = new Set()
  const s = series.map((item, i) => {
    const map = new Map()
    for (const p of item.points ?? []) {
      const x = xOf(p, xType)
      if (x === null) continue
      xsSet.add(x)
      map.set(x, isNum(p.value) ? p.value : null)
    }
    return { ...item, id: item.id ?? String(i), color: resolveColor(item.color, i), map }
  })
  const b = bands.map((item, i) => {
    const map = new Map()
    for (const p of item.points ?? []) {
      const x = xOf(p, xType)
      if (x === null || !isNum(p.lower) || !isNum(p.upper)) continue
      xsSet.add(x)
      map.set(x, [p.lower, p.upper])
    }
    return { ...item, id: item.id ?? `b${i}`, color: resolveColor(item.color, i), map }
  })
  const xs = [...xsSet].sort((a, c) => a - c)
  return { xs, series: s, bands: b }
}

/**
 * Dominio y marcas de y.
 * @param {{ series: any[], bands: any[] }} data
 * @param {{ log?: boolean, zeroBaseline?: boolean, yDomain?: [number?, number?], count?: number }} options
 * @returns {{ domain: [number, number], ticks: number[], step?: number } | null}
 */
export function yDomainOf(data, { log = false, zeroBaseline = false, yDomain, count = 5 } = {}) {
  let lo = Infinity
  let hi = -Infinity
  const take = (v) => {
    if (!isNum(v) || (log && v <= 0)) return
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  for (const s of data.series) for (const v of s.map.values()) take(v)
  for (const b of data.bands) for (const [l, u] of b.map.values()) { take(l); take(u) }
  if (lo === Infinity) return null
  if (zeroBaseline && !log) { lo = Math.min(lo, 0); hi = Math.max(hi, 0) }
  if (yDomain && isNum(yDomain[0])) lo = yDomain[0]
  if (yDomain && isNum(yDomain[1])) hi = yDomain[1]
  if (log) {
    const a = lo === hi ? lo / 1.5 : lo / 1.04
    const c = lo === hi ? hi * 1.5 : hi * 1.04
    return { domain: [a, c], ticks: logTicks(a, c, count) }
  }
  const nice = niceTicks(lo, hi, count)
  const d0 = yDomain && isNum(yDomain[0]) ? yDomain[0] : nice.min
  const d1 = yDomain && isNum(yDomain[1]) ? yDomain[1] : nice.max
  return { domain: [d0, d1], ticks: nice.ticks.filter((t) => t >= d0 - 1e-9 && t <= d1 + 1e-9), step: nice.step }
}

/**
 * Trazos de línea (y de área opcional) de una serie, cortados donde falta el dato.
 * @param {number[]} xs @param {Map<number, number | null>} map
 * @param {(x: number) => number} sx @param {(y: number) => number} sy @param {number | null} baseY
 */
export function linePaths(xs, map, sx, sy, baseY = null) {
  const segs = []
  let cur = []
  for (const x of xs) {
    if (!map.has(x)) continue
    const v = map.get(x)
    const py = isNum(v) ? sy(v) : NaN
    if (!isNum(py)) {
      if (cur.length) segs.push(cur)
      cur = []
      continue
    }
    cur.push([sx(x), py])
  }
  if (cur.length) segs.push(cur)
  const f = (n) => Number(n.toFixed(2))
  const line = segs.map((seg) => seg.map(([px, py], i) => `${i ? 'L' : 'M'}${f(px)},${f(py)}`).join('')).join('')
  const area = baseY === null ? '' : segs.map((seg) => {
    const top = seg.map(([px, py], i) => `${i ? 'L' : 'M'}${f(px)},${f(py)}`).join('')
    return `${top}L${f(seg.at(-1)[0])},${f(baseY)}L${f(seg[0][0])},${f(baseY)}Z`
  }).join('')
  const singles = segs.filter((seg) => seg.length === 1).map((seg) => seg[0])
  return { line, area, singles }
}

/** Trazo cerrado de una banda (superior de ida, inferior de vuelta). */
export function bandPath(xs, map, sx, sy) {
  const pts = xs.filter((x) => map.has(x)).map((x) => [sx(x), sy(map.get(x)[1]), sy(map.get(x)[0])])
  if (pts.length < 2) return ''
  const f = (n) => Number(n.toFixed(2))
  const top = pts.map(([px, u], i) => `${i ? 'L' : 'M'}${f(px)},${f(u)}`).join('')
  const bottom = [...pts].reverse().map(([px, , l]) => `L${f(px)},${f(l)}`).join('')
  return `${top}${bottom}Z`
}
