// Datos y cálculo del optimizador: panel semanal en pesos (con el IPC para las betas), serie de
// CETES 28 desde antes del inicio del panel, y cada paso del cálculo memorizado por separado para
// que cambiar la prima no vuelva a correr el walk forward.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { panelQuery, riskFreeQuery } from '../../lib/api/queries.js'
import { riskFreePct, validateAssumptions } from './assumptions.js'
import { marketWeights } from './backtester.js'
import { MIN_PERIODS, OPT_BENCHMARK, OPT_PANEL_PARAMS, assetBetas, estimateCovariance, expectedReturns, latestRiskFree, preparePanel, solvePortfolios } from './optimizer.js'
import { runValidation } from './validation.js'

/** Fecha ISO corrida n días. @param {string} iso @param {number} days */
export function shiftDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * @param {string[]} symbols
 * @param {import('./assumptions.js').Assumptions} a
 * @param {{ symbol: string, quantity: number }[]} positions posiciones abiertas del portafolio activo
 */
export function useOptimizer(symbols, a, positions) {
  const enough = symbols.length >= 2
  const panel = useQuery({ ...panelQuery([...symbols, OPT_BENCHMARK], OPT_PANEL_PARAMS), enabled: enough })
  const start = panel.data?.dates?.[0] ? shiftDays(panel.data.dates[0], -60) : null
  const rf = useQuery({ ...riskFreeQuery({ start }), enabled: Boolean(start) })

  const apiRf = useMemo(() => latestRiskFree(rf.data), [rf.data])
  const apiRfPct = apiRf ? Math.round(apiRf.effective * 10000) / 100 : null
  const prep = useMemo(() => preparePanel(panel.data, symbols), [panel.data, symbols])
  const n = prep ? prep.assets.length : symbols.length
  const errors = useMemo(() => validateAssumptions(a, n, apiRfPct), [a, n, apiRfPct])
  const valid = Object.keys(errors).length === 0
  const usable = Boolean(prep && prep.assets.length >= 2 && prep.periods >= MIN_PERIODS)
  const rfPct = riskFreePct(a, apiRfPct)
  const rfAnnual = rfPct === null ? null : rfPct / 100
  const l = (a.minPct ?? 0) / 100
  const u = (a.maxPct ?? 100) / 100

  const cov = useMemo(() => (usable ? estimateCovariance(prep.matrix, a.covMethod) : null), [usable, prep, a.covMethod])
  const betas = useMemo(() => (usable ? assetBetas(prep, rf.data) : null), [usable, prep, rf.data])
  const exp = useMemo(
    () => (cov ? expectedReturns(a.muMethod, { matrix: prep.matrix, covPerPeriod: cov.perPeriod, betas, rfAnnual, erp: a.erpPct === null ? null : a.erpPct / 100 }) : null),
    [cov, prep, betas, rfAnnual, a.muMethod, a.erpPct],
  )
  const current = useMemo(() => {
    if (!usable || positions.length === 0) return null
    const held = new Set(positions.map((p) => p.symbol))
    if (held.size !== prep.assets.length || !prep.assets.every((s) => held.has(s))) return null
    const w = marketWeights(positions, panel.data.prices)
    return w && prep.assets.every((s) => w[s] > 0) ? prep.assets.map((s) => w[s]) : null
  }, [usable, positions, prep, panel.data])
  const solve = useMemo(
    () => (valid && cov && exp?.mu && rfAnnual !== null ? solvePortfolios({ mu: exp.mu, cov: cov.annual, rf: rfAnnual, l, u, current }) : null),
    [valid, cov, exp, rfAnnual, l, u, current],
  )
  const validation = useMemo(
    () => (valid && usable && rfAnnual !== null ? runValidation(prep.matrix, prep.dates, { l, u, covMethod: a.covMethod, rfAnnual }) : null),
    [valid, usable, prep, l, u, a.covMethod, rfAnnual],
  )
  const vols = useMemo(() => (cov ? cov.annual.map((row, i) => Math.sqrt(Math.max(0, row[i]))) : []), [cov])

  return { panel, rf, apiRf, errors, valid, prep, usable, cov, betas, exp, solve, validation, vols, rfAnnual }
}
