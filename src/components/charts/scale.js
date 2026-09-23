// Escalas y marcas de eje para las gráficas SVG de Kaizen (C2). Sin dependencias.
//
// - linearScale, logScale y timeScale devuelven una función valor → píxel con .invert, .ticks y
//   .domain/.range, al estilo de d3 pero mínimas.
// - niceTicks da marcas "bonitas" (1, 2, 2.5, 5 × 10^n) que cubren el dominio.
// - timeTicks da marcas de día, mes o año según el tramo, con meses es-MX de tres letras
//   (ene, feb, ..., sep, ..., dic) que salen de fmtDate, así que no dependen del ICU del navegador.
// - Todo texto numérico pasa por src/lib/format.js: signo menos U+2212 y "s/d" para faltantes.
import { MISSING, fmtBp, fmtDate, fmtMoney, fmtNumber, fmtPct, fmtPp, isNum } from '../../lib/format.js'

const DAY = 86400000

/** Paso "bonito" más cercano a un paso crudo: 1, 2, 2.5, 5 o 10 por potencia de 10. */
export function niceStep(rawStep) {
  if (!isNum(rawStep) || rawStep <= 0) return 1
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const f = rawStep / power
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * power
}

/** Redondea un flotante al número de decimales del paso para que 0.1 + 0.2 no salga 0.30000000000000004. */
function clean(value, step) {
  const d = decimalsOf(step)
  return Number(value.toFixed(Math.min(12, d + 2)))
}

/** Decimales que necesita un paso para que sus marcas se distingan: 0.25 → 2, 5 → 0. */
export function decimalsOf(step) {
  if (!isNum(step) || step <= 0) return 0
  let d = 0
  while (d < 12 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-9 * 10 ** d) d += 1
  return d
}

/**
 * Marcas bonitas que cubren [min, max].
 * @param {number} min @param {number} max @param {number} [count] marcas deseadas (5)
 * @returns {{ ticks: number[], step: number, min: number, max: number }}
 */
export function niceTicks(min, max, count = 5) {
  if (!isNum(min) || !isNum(max)) return { ticks: [], step: 1, min: 0, max: 1 }
  let lo = Math.min(min, max)
  let hi = Math.max(min, max)
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1
    lo -= pad
    hi += pad
  }
  const step = niceStep((hi - lo) / Math.max(1, count))
  const start = Math.floor(lo / step + 1e-9) * step
  const end = Math.ceil(hi / step - 1e-9) * step
  const ticks = []
  for (let v = start, i = 0; v <= end + step * 1e-6 && i < 100; v += step, i += 1) {
    const t = clean(v, step)
    ticks.push(Object.is(t, -0) ? 0 : t)
  }
  return { ticks, step, min: clean(start, step), max: clean(end, step) }
}

/**
 * Escala lineal. Dominio degenerado (d0 === d1) cae al centro del rango.
 * @param {[number, number]} domain @param {[number, number]} range
 */
export function linearScale(domain, range) {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  const scale = (v) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0))
  scale.invert = (px) => (r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * span)
  scale.ticks = (count = 5) => niceTicks(d0, d1, count).ticks.filter((t) => t >= Math.min(d0, d1) - 1e-9 && t <= Math.max(d0, d1) + 1e-9)
  scale.domain = () => [d0, d1]
  scale.range = () => [r0, r1]
  scale.type = 'linear'
  return scale
}

/**
 * Escala logarítmica en base 10. Solo dominio positivo; un valor ≤ 0 regresa NaN (el llamador
 * lo trata como faltante).
 * @param {[number, number]} domain @param {[number, number]} range
 */
export function logScale(domain, range) {
  const [d0, d1] = domain.map((d) => Math.max(d, Number.MIN_VALUE))
  const [r0, r1] = range
  const l0 = Math.log10(d0)
  const l1 = Math.log10(d1)
  const span = l1 - l0
  const scale = (v) => {
    if (!(v > 0)) return NaN
    return span === 0 ? (r0 + r1) / 2 : r0 + ((Math.log10(v) - l0) / span) * (r1 - r0)
  }
  scale.invert = (px) => (r1 === r0 ? d0 : 10 ** (l0 + ((px - r0) / (r1 - r0)) * span))
  scale.ticks = (count = 5) => logTicks(d0, d1, count)
  scale.domain = () => [d0, d1]
  scale.range = () => [r0, r1]
  scale.type = 'log'
  return scale
}

/** Marcas de escala log: potencias de 10 y, si caben pocas, sus múltiplos 2 y 5. */
export function logTicks(min, max, count = 5) {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  if (!(lo > 0) || !isNum(hi)) return []
  const e0 = Math.floor(Math.log10(lo))
  const e1 = Math.ceil(Math.log10(hi))
  for (const mults of [[1], [1, 2, 5], [1, 1.5, 2, 3, 5, 7]]) {
    const out = []
    for (let e = e0; e <= e1; e += 1) {
      for (const m of mults) {
        const v = Number((m * 10 ** e).toPrecision(12))
        if (v >= lo - 1e-12 && v <= hi + 1e-12) out.push(v)
      }
    }
    if (out.length >= Math.min(3, count) || mults.length === 6) {
      if (out.length > 0) return out
      break
    }
  }
  // Tramo dentro de una sola década sin múltiplos exactos: marcas lineales.
  return niceTicks(lo, hi, count).ticks.filter((t) => t >= lo && t <= hi)
}

/**
 * Convierte una fecha a milisegundos. "YYYY-MM-DD" es medianoche UTC de ese día de calendario
 * (así el eje no la mueve de día); también acepta Date, epoch en ms e ISO con hora.
 * @param {unknown} value @returns {number | null}
 */
export function toMs(value) {
  if (value instanceof Date) return isNum(value.getTime()) ? value.getTime() : null
  if (isNum(value)) return value
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (m) {
      const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      const d = new Date(ms)
      return d.getUTCDate() === Number(m[3]) ? ms : null
    }
    const ms = Date.parse(value)
    return isNum(ms) ? ms : null
  }
  return null
}

/** "YYYY-MM-DD" del día UTC de un instante, para que fmtDate lo tome como calendario. */
export function isoDay(ms) {
  if (!isNum(ms)) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

/** "19 sep 2026" para un instante del eje (día UTC). */
export function fmtAxisDate(ms) {
  return isNum(ms) ? fmtDate(isoDay(ms)) : MISSING
}

/**
 * Marcas de tiempo según el tramo: días (≤ ~2 meses), meses (1, 2, 3, 6) o años.
 * Cada marca trae su etiqueta: "19 sep", "sep", "ene 2026" (el primer mes o enero lleva año), "2026".
 * @param {number} t0 @param {number} t1 @param {number} [count] marcas deseadas (6)
 * @returns {{ value: number, label: string }[]}
 */
export function timeTicks(t0, t1, count = 6) {
  if (!isNum(t0) || !isNum(t1)) return []
  const lo = Math.min(t0, t1)
  const hi = Math.max(t0, t1)
  if (lo === hi) return [{ value: lo, label: dayLabel(lo) }]
  const days = (hi - lo) / DAY
  const target = Math.max(2, count)
  if (days <= 62) {
    const step = [1, 2, 3, 7, 14].find((s) => days / s <= target) ?? 14
    const out = []
    const start = Math.ceil(lo / DAY) * DAY
    for (let t = start; t <= hi; t += step * DAY) out.push({ value: t, label: dayLabel(t) })
    return out
  }
  const months = days / 30.44
  if (months <= target * 12) {
    const step = [1, 2, 3, 6, 12].find((s) => months / s <= target) ?? 12
    const out = []
    const d = new Date(lo)
    let y = d.getUTCFullYear()
    let m = d.getUTCMonth()
    if (Date.UTC(y, m, 1) < lo) m += 1
    // Alinea al múltiplo del paso (trimestres en ene/abr/jul/oct, semestres en ene/jul).
    while (m % step !== 0) m += 1
    for (let i = 0; i < 200; i += 1) {
      const t = Date.UTC(y, m, 1)
      if (t > hi) break
      out.push({ value: t, label: '' })
      m += step
    }
    return out.map((tick, i) => ({ ...tick, label: monthLabel(tick.value, i === 0 || new Date(tick.value).getUTCMonth() === 0) }))
  }
  const years = months / 12
  const step = niceStep(years / target)
  const out = []
  const y0 = Math.ceil(new Date(lo).getUTCFullYear() / step) * step
  for (let y = y0; Date.UTC(y, 0, 1) <= hi; y += Math.max(1, Math.round(step))) {
    const t = Date.UTC(y, 0, 1)
    if (t >= lo) out.push({ value: t, label: String(y) })
  }
  return out
}

function dayLabel(ms) {
  const [day, month] = fmtAxisDate(ms).split(' ')
  return `${day} ${month}`
}

function monthLabel(ms, withYear) {
  const [, month, year] = fmtAxisDate(ms).split(' ')
  return withYear ? `${month} ${year}` : month
}

/**
 * Escala de tiempo: lineal sobre milisegundos, con .ticks() de timeTicks.
 * @param {[number, number]} domain ms @param {[number, number]} range
 */
export function timeScale(domain, range) {
  const base = linearScale(domain, range)
  const scale = (v) => base(v)
  scale.invert = base.invert
  scale.ticks = (count = 6) => timeTicks(domain[0], domain[1], count)
  scale.domain = base.domain
  scale.range = base.range
  scale.type = 'time'
  return scale
}

/**
 * Formateador de valores de eje o de tooltip.
 * @param {'number' | 'money' | 'pct' | 'pp' | 'bp'} [kind]
 * @param {{ currency?: string, step?: number, decimals?: number, compact?: boolean, sign?: boolean }} [options]
 *   step: paso entre marcas; decide los decimales si no se dan
 * @returns {(value: unknown) => string}
 */
export function valueFormatter(kind = 'number', { currency = 'MXN', step, decimals, compact, sign = false } = {}) {
  const stepDecimals = (mult) => (isNum(step) ? Math.min(4, decimalsOf(Number((step * mult).toPrecision(10)))) : undefined)
  switch (kind) {
    case 'pct': {
      const d = decimals ?? stepDecimals(100) ?? 1
      return (v) => fmtPct(v, { decimals: d, sign })
    }
    case 'pp': {
      const d = decimals ?? stepDecimals(100) ?? 1
      return (v) => fmtPp(v, { decimals: d })
    }
    case 'bp':
      return (v) => fmtBp(v, { decimals: decimals ?? 0 })
    case 'money': {
      const big = isNum(step) && step >= 10000
      const c = compact ?? big
      const d = decimals ?? (c ? 1 : stepDecimals(1) ?? 2)
      return (v) => fmtMoney(v, currency, { decimals: d, compact: c, sign })
    }
    default: {
      const big = isNum(step) && step >= 10000
      const c = compact ?? big
      const d = decimals ?? (c ? 1 : stepDecimals(1) ?? 2)
      return (v) => fmtNumber(v, { decimals: d, compact: c, sign })
    }
  }
}

/** Dominio [min, max] de valores numéricos, ignorando faltantes; null si no hay ninguno. */
export function extent(values) {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (!isNum(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return lo === Infinity ? null : [lo, hi]
}

/** Índice del elemento de `sorted` (ascendente) más cercano a `x`. */
export function nearestIndex(sorted, x) {
  if (!sorted.length) return -1
  let lo = 0
  let hi = sorted.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < x) lo = mid
    else hi = mid
  }
  return Math.abs(sorted[lo] - x) <= Math.abs(sorted[hi] - x) ? lo : hi
}
