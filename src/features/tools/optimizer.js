// Cálculo del optimizador (/herramientas/optimizador), sin React: del panel semanal en pesos a
// los insumos (betas, rendimientos esperados, covarianza) y a las tres carteras con su frontera.
// Todo sale de src/lib/finance; aquí solo se arma y se explica. Lo que dice
// docs/metodologia/optimizador.md es lo que se calcula aquí.
import {
  annualize,
  blumeBeta,
  capmExpected,
  cetesEffectiveAnnual,
  efficientFrontier,
  historicalMean,
  InfeasibleError,
  jamesStein,
  ledoitWolfConstantCorrelation,
  maxSharpe,
  minVariance,
  regress,
  rfSeriesForDates,
  riskParity,
  sampleCov,
  simpleReturns,
} from '../../lib/finance/index.js'
import { rfIsFallback, rfTenorDays } from './riskfree.js'

/** Referente para las betas del CAPM: el IPC como rendimiento total, en pesos. */
export const OPT_BENCHMARK = 'NAFTRAC.MX'
/** Cinco años semanales: 156 semanas de estimación más dos años fuera de muestra. */
export const OPT_PANEL_PARAMS = Object.freeze({ range: '5y', interval: '1wk', ccy: 'MXN' })
export const PERIODS_PER_YEAR = 52
export const MAX_ASSETS = 20
/** Semanas mínimas para estimar una covarianza que signifique algo. */
export const MIN_PERIODS = 52

/**
 * Prima de riesgo de mercado de RESPALDO. La que se usa sale de `GET /v2/assumptions` (`erp`, la
 * misma de la valuación, con su fuente y fecha); esta copia de "matureMarketErp" de
 * kaizen_api/data/damodaran_2026.json solo entra si el servidor no anuncia `assumptions` o la ruta
 * falla, y la pantalla lo dice. No se le suma prima país porque la tasa libre de riesgo es CETES,
 * que ya trae el riesgo soberano de México.
 */
export const DEFAULT_ERP = 0.0423
export const ERP_SOURCE = 'Damodaran, prima de mercado maduro, enero de 2026'

/**
 * Prima de mercado vigente para el optimizador: la de `/v2/assumptions` si llegó, la de respaldo
 * si el servidor no la ofrece o falló, y null mientras se espera.
 * @param {import('../../lib/api/types.js').AssumptionsResponse | undefined} data
 * @param {{ available: boolean, failed: boolean }} state `available`: el servidor anuncia `assumptions`
 * @returns {{ erp: number, source: string, asOf: string | null, fallback: boolean, stale: boolean } | null}
 */
export function marketPremium(data, { available, failed }) {
  if (data && Number.isFinite(data.erp) && data.erp >= 0) {
    return { erp: data.erp, source: data.source, asOf: data.asOf ?? null, fallback: false, stale: Boolean(data.meta?.stale) }
  }
  if (!available || failed || data) return { erp: DEFAULT_ERP, source: ERP_SOURCE, asOf: null, fallback: true, stale: false }
  return null
}

export const MU_METHODS = /** @type {const} */ (['capm', 'jamesStein', 'historical'])
export const COV_METHODS = /** @type {const} */ (['ledoitWolf', 'sample'])

/**
 * Del panel a una matriz de rendimientos T x N. Los símbolos que el panel no trae se reportan
 * aparte; el referente solo entra a la matriz si la persona lo eligió como activo.
 * @param {{ dates: string[], prices: Record<string, number[]> } | null | undefined} panel
 * @param {string[]} symbols los que eligió la persona, en su orden
 */
export function preparePanel(panel, symbols) {
  if (!panel || !Array.isArray(panel.dates) || panel.dates.length < 2) return null
  const assets = symbols.filter((s) => Array.isArray(panel.prices?.[s]) && panel.prices[s].length === panel.dates.length)
  const missing = symbols.filter((s) => !assets.includes(s))
  const series = assets.map((s) => simpleReturns(panel.prices[s]))
  if (series.some((r) => r === null)) return null
  const T = panel.dates.length - 1
  const matrix = Array.from({ length: T }, (_, t) => series.map((r) => r[t]))
  const benchPrices = panel.prices?.[OPT_BENCHMARK]
  const bench = Array.isArray(benchPrices) && benchPrices.length === panel.dates.length ? simpleReturns(benchPrices) : null
  return { assets, missing, priceDates: panel.dates, dates: panel.dates.slice(1), matrix, bench, periods: T }
}

/**
 * Tasa más reciente de la serie del API, como efectiva anual con el plazo que trae la respuesta
 * (28 días con CETES; 91 con el respaldo de FRED, que además llega con `fallback`).
 * @param {{ dates: string[], values: number[], tenorDays?: number, fallback?: boolean, meta?: any } | null | undefined} rf
 * @returns {{ yield: number, effective: number, date: string, tenorDays: number, fallback: boolean } | null}
 */
export function latestRiskFree(rf) {
  if (!rf || !Array.isArray(rf.values) || rf.values.length === 0) return null
  const i = rf.values.length - 1
  const y = rf.values[i]
  const tenorDays = rfTenorDays(rf)
  const effective = cetesEffectiveAnnual(y, tenorDays)
  if (!Number.isFinite(y) || effective === null) return null
  return { yield: y, effective, date: rf.dates?.[i] ?? null, tenorDays, fallback: rfIsFallback(rf) }
}

/**
 * Betas contra el IPC con rendimientos en exceso sobre la tasa libre de riesgo (solo los periodos con tasa vigente)
 * y su ajuste de Blume, que es la que usa el CAPM.
 * @param {NonNullable<ReturnType<typeof preparePanel>>} prep
 * @param {{ dates: string[], values: number[] } | null | undefined} rfSeries
 */
export function assetBetas(prep, rfSeries) {
  if (!prep.bench) return null
  const rfPer = rfSeries ? rfSeriesForDates(rfSeries, prep.priceDates, '1wk', { tenorDays: rfTenorDays(rfSeries) }) : null
  const keep = prep.bench.map((_, t) => (rfPer ? rfPer[t] !== null : true))
  const rfAt = (/** @type {number} */ t) => (rfPer ? /** @type {number} */ (rfPer[t]) : 0)
  const idx = keep.flatMap((ok, t) => (ok ? [t] : []))
  const benchEx = idx.map((t) => prep.bench[t] - rfAt(t))
  return prep.assets.map((_, i) => {
    const fit = regress(idx.map((t) => prep.matrix[t][i] - rfAt(t)), benchEx, PERIODS_PER_YEAR)
    const raw = fit ? fit.beta : null
    return { raw, adjusted: raw === null ? null : blumeBeta(raw), r2: fit ? fit.r2 : null, n: fit ? fit.n : 0 }
  })
}

/**
 * Covarianza por periodo y anual. Ledoit y Wolf por omisión; la muestral solo si se pide.
 * @param {number[][]} matrix
 * @param {'ledoitWolf' | 'sample'} method
 */
export function estimateCovariance(matrix, method) {
  if (method === 'sample') {
    const perPeriod = sampleCov(matrix)
    return perPeriod ? { perPeriod, annual: annualize(perPeriod, PERIODS_PER_YEAR), shrinkage: null } : null
  }
  const lw = ledoitWolfConstantCorrelation(matrix)
  return lw ? { perPeriod: lw.cov, annual: annualize(lw.cov, PERIODS_PER_YEAR), shrinkage: lw.shrinkage } : null
}

/**
 * Rendimientos esperados anuales por el método elegido. CAPM por omisión; James y Stein contrae el
 * promedio histórico hacia el promedio de los activos; el promedio crudo va con advertencia.
 * @param {'capm' | 'jamesStein' | 'historical'} method
 * @param {{ matrix: number[][], covPerPeriod: number[][], betas: ReturnType<typeof assetBetas>, rfAnnual: number | null, erp: number | null }} input
 * @returns {{ mu: number[] | null, reason: string | null, shrinkage: number | null }}
 */
export function expectedReturns(method, { matrix, covPerPeriod, betas, rfAnnual, erp }) {
  if (method === 'capm') {
    if (!betas || betas.some((b) => b.adjusted === null)) {
      return { mu: null, reason: `Sin historia del IPC (${OPT_BENCHMARK}) no hay betas para el CAPM.`, shrinkage: null }
    }
    if (rfAnnual === null || erp === null) return { mu: null, reason: 'Faltan la tasa libre de riesgo o la prima de mercado.', shrinkage: null }
    return { mu: capmExpected(betas.map((b) => /** @type {number} */ (b.adjusted)), rfAnnual, erp), reason: null, shrinkage: null }
  }
  const hist = historicalMean(matrix, PERIODS_PER_YEAR)
  if (!hist) return { mu: null, reason: 'No alcanzan los periodos para un promedio.', shrinkage: null }
  if (method === 'historical') return { mu: hist.mu, reason: null, shrinkage: null }
  const js = jamesStein(hist.perPeriod, covPerPeriod, hist.periods)
  if (!js) return { mu: null, reason: 'La covarianza no permitió la contracción de James y Stein.', shrinkage: null }
  return { mu: js.mu.map((m) => m * PERIODS_PER_YEAR), reason: null, shrinkage: js.shrinkage }
}

/** @param {number[]} w @param {number[]} v */
const dot = (w, v) => w.reduce((acc, wi, i) => acc + wi * v[i], 0)

/** @param {number[]} w @param {number[][]} cov */
const volOf = (w, cov) => Math.sqrt(Math.max(0, dot(w, cov.map((row) => dot(row, w)))))

/**
 * Describe una cartera con los insumos de la pantalla: rendimiento esperado, volatilidad y Sharpe.
 * @param {number[]} weights
 * @param {number[]} mu
 * @param {number[][]} cov anual
 * @param {number} rf anual
 */
export function describePortfolio(weights, mu, cov, rf) {
  const ret = dot(weights, mu)
  const vol = volOf(weights, cov)
  return { weights, ret, vol, sharpe: vol > 0 ? (ret - rf) / vol : null }
}

/**
 * Las tres carteras, la frontera y la cartera actual (si la hay), con la caja l ≤ w ≤ u.
 * La paridad de riesgo no acepta caja: su solución ya es interior.
 * @param {{ mu: number[], cov: number[][], rf: number, l: number, u: number, current?: number[] | null }} input
 */
export function solvePortfolios({ mu, cov, rf, l, u, current = null }) {
  try {
    const box = { l, u }
    const mv = minVariance(cov, box)
    const rp = riskParity(cov)
    const ms = maxSharpe(mu, cov, rf, box)
    const frontier = efficientFrontier(mu, cov, { points: 30, ...box })
    return {
      error: null,
      minVariance: { ...describePortfolio(mv.weights, mu, cov, rf), converged: mv.converged },
      riskParity: rp ? { ...describePortfolio(rp.weights, mu, cov, rf), converged: rp.converged } : null,
      maxSharpe: ms ? { ...describePortfolio(ms.weights, mu, cov, rf), converged: ms.converged } : null,
      frontier: frontier.map((p) => ({ risk: p.volatility, ret: /** @type {number} */ (p.expectedReturn) })),
      current: current ? describePortfolio(current, mu, cov, rf) : null,
    }
  } catch (err) {
    if (err instanceof InfeasibleError) return { error: err.message }
    throw err
  }
}

/**
 * Emisoras de la persona que no entraron: las que el API tiró y las que el panel no trajo. El IPC
 * se pide aparte para las betas; si falla, lo dice el CAPM, no esta lista.
 * @param {{ dropped?: { symbol: string }[] } | null | undefined} panel
 * @param {{ missing?: string[] } | null | undefined} prep
 * @param {string[]} chosen
 */
export function droppedSymbols(panel, prep, chosen) {
  const wanted = new Set(chosen)
  const fromApi = (panel?.dropped ?? []).map((d) => d.symbol).filter((s) => wanted.has(s))
  return [...new Set([...fromApi, ...(prep?.missing ?? [])])]
}
