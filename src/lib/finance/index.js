// Puerta de entrada de la librería financiera. Las features importan de aquí:
//
//   import { simpleReturns, summary, sharpe } from '@/lib/finance'
//
// Todo lo de aquí es puro: módulos ES sin React, sin fetch y sin Date.now() adentro de un
// cálculo. Las convenciones completas están al principio de `_util.js`, y en resumen son:
// tasas, rendimientos y pesos como fracción; `k` (periodos por año) siempre explícito;
// estadística de muestra con n−1; `null` cuando no alcanzan los datos, nunca 0 ni NaN.
//
// `_util.js` es interno y a propósito no se reexporta.

// ─── A1: series, estadística, desempeño, comparación contra índice, tasas, riesgo, backtest, FX ──
export {
  simpleReturns,
  logReturns,
  cumulative,
  totalReturn,
  periodsPerYear,
  inferInterval,
  isInterval,
  alignPanel,
  panelReturns,
} from './returns.js'

export { mean, variance, stdev, covariance, correlation, quantile, ols, normalPdf, normalCdf, normalInvCdf } from './stats.js'

export {
  cagr,
  cagrFromReturns,
  annualizedVol,
  sharpe,
  sortino,
  drawdowns,
  calmar,
  historicalVaR,
  historicalCVaR,
  parametricVaR,
  parametricCVaR,
  percentile,
  summary,
} from './performance.js'

export {
  regress,
  blumeBeta,
  trackingError,
  informationRatio,
  treynor,
  jensenAlpha,
  captureRatios,
  activeReturns,
  averageActive,
} from './benchmark.js'

export { cetesPerPeriod, cetesEffectiveAnnual, annualToPerPeriod, changeInBp, rfSeriesForDates, MAX_STALE_DAYS } from './rates.js'

export { effectiveN, hhi, portfolioVol, riskContributions, exposureBy, foreignExposure } from './risk.js'

export { buyAndHold, constantMix, withBenchmark, annualTurnover, weightsSum } from './backtest.js'

export { toCurrency, pnlDecomposition, fxAt, convertSeries, returnInBaseCurrency, CURRENCIES, MAX_FX_STALE_DAYS } from './fx.js'

// ─── A4: movimientos del portafolio ──────────────────────────────────────────────────────────
export {
  derivePositions,
  derivePositionsDetailed,
  cashBalances,
  validateTransaction,
  ledgerSnapshots,
  orderTransactions,
  externalFlows,
  realizedSales,
  positionPnl,
} from './ledger.js'
export { valueSeries, twr, twrReturns, annualizeReturn, yearsBetween } from './performance-ledger.js'
export { xirr, signChanges } from './xirr.js'
export { isrOnGains, interestWithholding, INTEREST_WITHHOLDING_RATE, DIVIDEND_WITHHOLDING_RATE } from './tax-mx.js'
export { wholeShareRebalance } from './rebalance.js'

// ─── A2: álgebra lineal, covarianza y optimización ───────────────────────────────────────────
export { matmul, transpose, cholesky, solveSPD, largestEigenvalue } from './linalg.js'
export { sampleCov, ledoitWolfConstantCorrelation, annualize, corrFromCov } from './covariance.js'
export { capmExpected, historicalMean, jamesStein } from './expected.js'
export { projectBoxSimplex, minVariance, meanVariance, efficientFrontier, maxSharpe, riskParity, InfeasibleError } from './optimize.js'
export { walkForward } from './walkforward.js'

// ─── A3: aleatoriedad con semilla, Monte Carlo y metas (rng.js vive en src/lib/, no en finance/) ─
export { createRng } from '../rng.js'
export { lognormalParams, simulate, fromMessage } from './montecarlo.js'
export { probabilityOfGoal, requiredContribution, retirementIncome } from './goals.js'
