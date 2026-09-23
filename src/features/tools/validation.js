// Validación walk forward del optimizador: cada método se estima con las 156 semanas previas y se
// aplica las 13 siguientes, y al lado se corre lo mismo con los pesos calculados con TODA la
// historia (o sea, sabiendo el futuro). La brecha entre las dos columnas es lo que el método le
// debía al ajuste al pasado. Sin React; todo el cálculo es de src/lib/finance.
import { annualToPerPeriod, maxSharpe, minVariance, riskParity, walkForward } from '../../lib/finance/index.js'
import { PERIODS_PER_YEAR, estimateCovariance } from './optimizer.js'

export const ESTIMATION_WINDOW = 156
export const HOLD_PERIODS = 13

export const WF_METHODS = /** @type {const} */ ([
  { id: 'minVariance', label: 'Mínima varianza' },
  { id: 'riskParity', label: 'Paridad de riesgo' },
  { id: 'maxSharpe', label: 'Máximo Sharpe' },
  { id: 'equalWeight', label: 'Pesos iguales' },
])

/**
 * Pesos con toda la historia, con el mismo estimador que usa cada corte del walk forward (para el
 * máximo Sharpe, el promedio histórico de la ventana, no el CAPM de la pantalla).
 * @param {string} method
 * @param {number[][]} matrix
 * @param {{ perPeriod: number[][] }} cov
 * @param {{ l: number, u: number, rfPerPeriod: number }} opts
 * @returns {{ weights: number[], note: string | null }}
 */
function fullSampleWeights(method, matrix, cov, { l, u, rfPerPeriod }) {
  const n = matrix[0].length
  if (method === 'equalWeight') return { weights: new Array(n).fill(1 / n), note: null }
  if (method === 'riskParity') {
    const rp = riskParity(cov.perPeriod)
    return rp ? { weights: rp.weights, note: null } : { weights: new Array(n).fill(1 / n), note: 'Algún activo tuvo varianza cero, se repartió parejo.' }
  }
  if (method === 'maxSharpe') {
    const mu = new Array(n).fill(0)
    for (const row of matrix) row.forEach((v, i) => (mu[i] += v / matrix.length))
    const ms = maxSharpe(mu, cov.perPeriod, rfPerPeriod, { l, u })
    if (ms) return { weights: ms.weights, note: null }
    return { weights: minVariance(cov.perPeriod, { l, u }).weights, note: 'Con toda la historia no hubo cartera tangente, se usó mínima varianza.' }
  }
  return { weights: minVariance(cov.perPeriod, { l, u }).weights, note: null }
}

/** @param {NonNullable<ReturnType<typeof walkForward>>} wf */
function pick(wf) {
  const s = wf.summary
  return { ret: s.annualizedReturn, vol: s.annualizedVol, maxDrawdown: s.maxDrawdown, cumulative: s.cumulative, periods: s.periods }
}

/**
 * Corre el walk forward de los cuatro métodos y su contraparte con toda la historia.
 * @param {number[][]} matrix T x N de rendimientos semanales
 * @param {string[]} dates una fecha por renglón
 * @param {{ l: number, u: number, covMethod: 'ledoitWolf' | 'sample', rfAnnual: number | null }} opts
 *   `rfAnnual` es la tasa libre de riesgo efectiva anual de la pantalla; aquí se pasa a semanal
 * @returns {null | { start: string, end: string, folds: number, periods: number, rows: any[], notes: { method: string, date: string, note: string }[] }}
 *   null si la historia no alcanza para un solo periodo fuera de muestra
 */
export function runValidation(matrix, dates, { l, u, covMethod, rfAnnual }) {
  if (matrix.length < ESTIMATION_WINDOW + 1) return null
  const rfPerPeriod = rfAnnual === null ? 0 : (annualToPerPeriod(rfAnnual, PERIODS_PER_YEAR) ?? 0)
  const common = { estimationWindow: ESTIMATION_WINDOW, holdPeriods: HOLD_PERIODS, covariance: covMethod, l, u, rf: rfPerPeriod, k: PERIODS_PER_YEAR }
  const cov = estimateCovariance(matrix, covMethod)
  if (!cov) return null
  /** @type {{ method: string, date: string, note: string }[]} */
  const notes = []
  const rows = []
  let first = null
  for (const m of WF_METHODS) {
    const oos = walkForward(matrix, dates, { ...common, method: m.id })
    if (!oos) return null
    first ??= oos
    for (const r of oos.rebalances) if (r.note) notes.push({ method: m.label, date: r.date, note: r.note })
    const full = fullSampleWeights(m.id, matrix, cov, { l, u, rfPerPeriod })
    // Los pesos con toda la historia se aplican con la misma mecánica y en las mismas fechas.
    const ins = walkForward(matrix, dates, { ...common, l: 0, u: 1, method: () => full.weights })
    if (full.note) notes.push({ method: m.label, date: 'Toda la historia', note: full.note })
    rows.push({ id: m.id, label: m.label, oos: pick(oos), inSample: ins ? pick(ins) : null })
  }
  return { start: first.dates[0], end: first.dates[first.dates.length - 1], folds: first.folds, periods: first.summary.periods, rows, notes }
}
