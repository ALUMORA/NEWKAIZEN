// Rendimientos y alineación de series. Es la base de todo lo demás: si aquí se alinea mal, el
// resto de la librería calcula bien sobre datos que no corresponden.
//
// Dos decisiones importantes:
// - La alineación es por fecha ISO, con inner join, y SIN rellenar hacia adelante. Si un símbolo
//   no cotizó ese día, ese día no entra para nadie. El bug del backend viejo era alinear por
//   posición del arreglo, que compara el martes de uno contra el jueves del otro.
// - Los rendimientos se calculan DESPUÉS de alinear, nunca antes.

import { EPS, daysBetween, isNum, numericArray, parseIsoDate } from './_util.js'

/** @typedef {'1d' | '1wk' | '1mo'} Interval */
/** @typedef {{ dates: string[], values: number[] }} Series */
/** @typedef {{ dates: string[], values: Record<string, number[]>, dropped: string[] }} Panel */

/** Periodos por año de cada intervalo. 252 días hábiles, 52 semanas, 12 meses. */
const PERIODS = { '1d': 252, '1wk': 52, '1mo': 12, '3mo': 4, '1y': 1 }

/**
 * Periodos por año de un intervalo. Se usa como `k` en todo lo que anualiza.
 * @param {string} interval `'1d'` (252), `'1wk'` (52), `'1mo'` (12); además `'3mo'` (4) y `'1y'` (1)
 * @returns {number | null} null si el intervalo no se reconoce
 */
export function periodsPerYear(interval) {
  const k = PERIODS[interval]
  return k === undefined ? null : k
}

/**
 * Deduce el intervalo de una serie de fechas por la mediana de los huecos:
 * hasta 3 días es diario, hasta 10 es semanal, más es mensual.
 * @param {string[]} dates fechas ISO `YYYY-MM-DD` en orden ascendente
 * @returns {Interval | null} null con menos de 2 fechas o si alguna no es ISO válida
 */
export function inferInterval(dates) {
  if (!Array.isArray(dates) || dates.length < 2) return null
  /** @type {number[]} */
  const gaps = []
  for (let i = 1; i < dates.length; i++) {
    const gap = daysBetween(dates[i - 1], dates[i])
    if (gap === null) return null
    gaps.push(gap)
  }
  gaps.sort((a, b) => a - b)
  const mid = gaps.length >> 1
  const median = gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2
  if (median <= 3) return '1d'
  if (median <= 10) return '1wk'
  return '1mo'
}

/**
 * Rendimientos simples: r_t = P_t / P_{t−1} − 1. Mínimo 2 precios.
 * @param {number[]} prices precios ya en una sola moneda
 * @returns {number[] | null} largo n−1; null con menos de 2 precios, con datos no finitos
 *   o si algún precio anterior es 0 (la división no existe)
 */
export function simpleReturns(prices) {
  const p = numericArray(prices, 2)
  if (p === null) return null
  /** @type {number[]} */
  const out = new Array(p.length - 1)
  for (let i = 1; i < p.length; i++) {
    if (Math.abs(p[i - 1]) < EPS) return null
    out[i - 1] = p[i] / p[i - 1] - 1
  }
  return out
}

/**
 * Rendimientos logarítmicos: r_t = ln(P_t / P_{t−1}). Mínimo 2 precios.
 * Se suman a lo largo del tiempo, por eso sirven para acumular, no para promediar entre activos.
 * @param {number[]} prices precios ya en una sola moneda, todos positivos
 * @returns {number[] | null} largo n−1; null con menos de 2 precios o si alguno no es positivo
 */
export function logReturns(prices) {
  const p = numericArray(prices, 2)
  if (p === null) return null
  /** @type {number[]} */
  const out = new Array(p.length - 1)
  for (let i = 1; i < p.length; i++) {
    if (p[i] <= 0 || p[i - 1] <= 0) return null
    out[i - 1] = Math.log(p[i] / p[i - 1])
  }
  return out
}

/**
 * Trayectoria de crecimiento de 1 peso: [1, 1+r1, (1+r1)(1+r2), ...].
 * @param {number[]} returns rendimientos simples por periodo
 * @returns {number[] | null} largo n+1, empieza en 1; null si la entrada no es válida.
 *   Con un arreglo vacío devuelve [1], que es el punto de partida sin ningún periodo.
 */
export function cumulative(returns) {
  const r = numericArray(returns)
  if (r === null) return null
  /** @type {number[]} */
  const out = new Array(r.length + 1)
  out[0] = 1
  for (let i = 0; i < r.length; i++) out[i + 1] = out[i] * (1 + r[i])
  return out
}

/**
 * ¿La serie de un símbolo sirve? Debe traer fechas ISO ascendentes sin repetir y valores finitos.
 * @param {unknown} series
 * @returns {Series | null}
 */
function cleanSeries(series) {
  if (!series || typeof series !== 'object') return null
  const raw = /** @type {{ dates?: unknown, values?: unknown }} */ (series)
  if (!Array.isArray(raw.dates)) return null
  const values = numericArray(raw.values)
  if (values === null || values.length !== raw.dates.length || values.length === 0) return null
  /** @type {string[]} */
  const dates = new Array(raw.dates.length)
  let previous = -Infinity
  for (let i = 0; i < raw.dates.length; i++) {
    const date = raw.dates[i]
    const ms = parseIsoDate(date)
    if (ms === null || ms <= previous) return null
    previous = ms
    dates[i] = /** @type {string} */ (date)
  }
  return { dates, values }
}

/**
 * Alinea varias series por fecha con inner join, sin rellenar hacia adelante.
 *
 * Un símbolo se descarta (y aparece en `dropped`) cuando su serie viene mal armada: fechas que
 * no son ISO, fechas desordenadas o repetidas, valores no finitos, o largos distintos entre
 * `dates` y `values`. Con `minDates` además se descarta, de uno en uno, el símbolo con menos
 * historia propia mientras la intersección no alcance ese mínimo y quede más de un símbolo;
 * los empates se rompen por nombre, quitando el último alfabéticamente.
 *
 * @param {Record<string, Series>} seriesBySymbol
 * @param {{ minDates?: number }} [options] `minDates` por omisión 0, o sea que no descarta nada
 * @returns {Panel} `dates` en orden ascendente y `values[símbolo]` del mismo largo que `dates`
 */
export function alignPanel(seriesBySymbol, { minDates = 0 } = {}) {
  /** @type {string[]} */
  const dropped = []
  /** @type {Map<string, Series>} */
  const kept = new Map()
  const symbols = seriesBySymbol && typeof seriesBySymbol === 'object' ? Object.keys(seriesBySymbol).sort() : []
  for (const symbol of symbols) {
    const clean = cleanSeries(seriesBySymbol[symbol])
    if (clean === null) dropped.push(symbol)
    else kept.set(symbol, clean)
  }

  /** Intersección de fechas de los símbolos que quedan, en orden ascendente. */
  const intersect = () => {
    const live = [...kept.values()]
    if (live.length === 0) return /** @type {string[]} */ ([])
    let dates = live[0].dates
    for (let i = 1; i < live.length; i++) {
      const other = new Set(live[i].dates)
      dates = dates.filter((d) => other.has(d))
    }
    return dates
  }

  let dates = intersect()
  while (dates.length < minDates && kept.size > 1) {
    let worst = ''
    let worstCount = Infinity
    for (const [symbol, series] of kept) {
      if (series.dates.length < worstCount || (series.dates.length === worstCount && symbol > worst)) {
        worst = symbol
        worstCount = series.dates.length
      }
    }
    kept.delete(worst)
    dropped.push(worst)
    dates = intersect()
  }

  /** @type {Record<string, number[]>} */
  const values = {}
  for (const [symbol, series] of kept) {
    /** @type {Map<string, number>} */
    const byDate = new Map()
    for (let i = 0; i < series.dates.length; i++) byDate.set(series.dates[i], series.values[i])
    values[symbol] = dates.map((d) => /** @type {number} */ (byDate.get(d)))
  }
  return { dates, values, dropped: dropped.sort() }
}

/**
 * Rendimientos de un panel ya alineado. Se calculan después de la alineación, nunca antes.
 * @param {Panel | { dates: string[], values: Record<string, number[]> }} panel
 * @param {{ log?: boolean }} [options] `log` usa rendimientos logarítmicos
 * @returns {{ dates: string[], values: Record<string, number[]> } | null} `dates` son las fechas
 *   de llegada de cada periodo (las del panel sin la primera); null con menos de 2 fechas o si
 *   algún símbolo no se puede convertir
 */
export function panelReturns(panel, { log = false } = {}) {
  if (!panel || !Array.isArray(panel.dates) || panel.dates.length < 2) return null
  if (!panel.values || typeof panel.values !== 'object') return null
  /** @type {Record<string, number[]>} */
  const values = {}
  for (const symbol of Object.keys(panel.values).sort()) {
    const series = panel.values[symbol]
    if (!Array.isArray(series) || series.length !== panel.dates.length) return null
    const r = log ? logReturns(series) : simpleReturns(series)
    if (r === null) return null
    values[symbol] = r
  }
  return { dates: panel.dates.slice(1), values }
}

/**
 * Rendimiento total acumulado de una serie de rendimientos por periodo: ∏(1+r) − 1.
 * @param {number[]} returns
 * @returns {number | null} null si la entrada no es válida; con 0 periodos devuelve 0
 */
export function totalReturn(returns) {
  const r = numericArray(returns)
  if (r === null) return null
  let growth = 1
  for (let i = 0; i < r.length; i++) growth *= 1 + r[i]
  return growth - 1
}

/**
 * ¿El valor es un intervalo de los que entiende `periodsPerYear`?
 * @param {unknown} interval
 * @returns {boolean}
 */
export function isInterval(interval) {
  return typeof interval === 'string' && isNum(PERIODS[interval])
}
