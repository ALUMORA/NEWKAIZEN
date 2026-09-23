import { createRng } from '../../lib/rng.js'
import { OPT_BENCHMARK, assetBetas, estimateCovariance, expectedReturns, latestRiskFree, preparePanel, solvePortfolios } from './optimizer.js'
import { ESTIMATION_WINDOW, runValidation } from './validation.js'

const COV = [
  [0.04, 0],
  [0, 0.09],
]

describe('optimizador: panel e insumos', () => {
  it('arma la matriz con los símbolos que trae el panel y reporta los que faltan', () => {
    const panel = { dates: ['2026-01-02', '2026-01-09', '2026-01-16'], prices: { A: [100, 110, 99], B: [50, 50, 55], [OPT_BENCHMARK]: [10, 11, 12] } }
    const prep = preparePanel(panel, ['A', 'B', 'C'])
    expect(prep.assets).toEqual(['A', 'B'])
    expect(prep.missing).toEqual(['C'])
    expect(prep.dates).toEqual(['2026-01-09', '2026-01-16'])
    expect(prep.matrix[0][0]).toBeCloseTo(0.1, 10)
    expect(prep.matrix[1][0]).toBeCloseTo(-0.1, 10)
    expect(prep.matrix[1][1]).toBeCloseTo(0.1, 10)
    expect(prep.bench[1]).toBeCloseTo(1 / 11, 10)
  })

  it('sin panel o con una sola fecha no hay nada que optimizar', () => {
    expect(preparePanel(null, ['A'])).toBeNull()
    expect(preparePanel({ dates: ['2026-01-02'], prices: { A: [1] } }, ['A'])).toBeNull()
  })

  it('CETES 28 al 11 % simple es 11.7455 % efectivo anual', () => {
    const rf = latestRiskFree({ dates: ['2026-09-17', '2026-09-24'], values: [0.1, 0.11] })
    expect(rf.yield).toBe(0.11)
    expect(rf.effective).toBeCloseTo(0.117455, 6)
    expect(rf.date).toBe('2026-09-24')
    expect(latestRiskFree({ dates: [], values: [] })).toBeNull()
  })

  it('beta cruda 2 da beta ajustada de Blume 1.67, y el CAPM usa la ajustada', () => {
    const bench = [0.01, -0.02, 0.03, 0.005, -0.01, 0.02]
    const prep = { assets: ['A'], bench, matrix: bench.map((b) => [2 * b]), priceDates: [], dates: [] }
    const betas = assetBetas(/** @type {any} */ (prep), null)
    expect(betas[0].raw).toBeCloseTo(2, 10)
    expect(betas[0].adjusted).toBeCloseTo(1.67, 10)
    const out = expectedReturns('capm', { matrix: prep.matrix, covPerPeriod: [[1]], betas, rfAnnual: 0.08, erp: 0.05 })
    expect(out.mu[0]).toBeCloseTo(0.08 + 1.67 * 0.05, 10)
  })

  it('sin referente no hay CAPM y se dice por qué', () => {
    const out = expectedReturns('capm', { matrix: [[0.01]], covPerPeriod: [[1]], betas: null, rfAnnual: 0.08, erp: 0.05 })
    expect(out.mu).toBeNull()
    expect(out.reason).toMatch(/IPC/)
  })

  it('el promedio histórico se anualiza por 52 y James y Stein lo contrae hacia el promedio', () => {
    const rng = createRng('js')
    const matrix = Array.from({ length: 120 }, () => [0.004 + 0.02 * rng.normal(), 0.001 + 0.02 * rng.normal()])
    const cov = estimateCovariance(matrix, 'sample')
    const hist = expectedReturns('historical', { matrix, covPerPeriod: cov.perPeriod, betas: null, rfAnnual: null, erp: null })
    const js = expectedReturns('jamesStein', { matrix, covPerPeriod: cov.perPeriod, betas: null, rfAnnual: null, erp: null })
    const grand = (hist.mu[0] + hist.mu[1]) / 2
    expect(js.shrinkage).toBeGreaterThan(0)
    expect(Math.abs(js.mu[0] - grand)).toBeLessThan(Math.abs(hist.mu[0] - grand))
  })
})

describe('optimizador: las tres carteras', () => {
  it('respuestas conocidas: mínima varianza, tangente y paridad de riesgo', () => {
    const out = solvePortfolios({ mu: [0.1, 0.15], cov: COV, rf: 0.05, l: 0, u: 1 })
    expect(out.error).toBeNull()
    expect(out.minVariance.weights[0]).toBeCloseTo(0.692308, 5)
    expect(out.minVariance.vol).toBeCloseTo(0.16641, 5)
    expect(out.maxSharpe.weights[0]).toBeCloseTo(0.529412, 5)
    expect(out.maxSharpe.sharpe).toBeCloseTo(0.416667, 5)
    expect(out.riskParity.weights[0]).toBeCloseTo(0.6, 6)
    expect(out.frontier.length).toBeGreaterThan(2)
  })

  it('si nada le gana a la tasa libre de riesgo no hay máximo Sharpe', () => {
    const out = solvePortfolios({ mu: [0.1, 0.15], cov: COV, rf: 0.2, l: 0, u: 1 })
    expect(out.maxSharpe).toBeNull()
    expect(out.minVariance).not.toBeNull()
  })

  it('una caja imposible es un error con mensaje, no una cartera', () => {
    const out = solvePortfolios({ mu: [0.1, 0.15], cov: COV, rf: 0.05, l: 0, u: 0.35 })
    expect(out.error).toMatch(/\S/)
    expect(out.minVariance).toBeUndefined()
  })

  it('la cartera actual se describe con los mismos insumos', () => {
    const out = solvePortfolios({ mu: [0.1, 0.15], cov: COV, rf: 0.05, l: 0, u: 1, current: [0.5, 0.5] })
    expect(out.current.ret).toBeCloseTo(0.125, 10)
    expect(out.current.vol).toBeCloseTo(Math.sqrt(0.25 * 0.04 + 0.25 * 0.09), 10)
  })
})

describe('optimizador: walk forward', () => {
  const rng = createRng('wf')
  const rows = (n) => Array.from({ length: n }, () => [0.002 + 0.02 * rng.normal(), 0.001 + 0.03 * rng.normal(), 0.0015 + 0.025 * rng.normal()])
  const datesFor = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2021, 0, 4 + 7 * i)).toISOString().slice(0, 10))

  it('sin historia para un periodo fuera de muestra no hay validación', () => {
    const m = rows(ESTIMATION_WINDOW)
    expect(runValidation(m, datesFor(m.length), { l: 0, u: 1, covMethod: 'ledoitWolf', rfYield: 0.07 })).toBeNull()
  })

  it('cuatro métodos con su contraparte en la muestra completa, en las mismas fechas', () => {
    const m = rows(220)
    const out = runValidation(m, datesFor(m.length), { l: 0, u: 1, covMethod: 'ledoitWolf', rfYield: 0.07 })
    expect(out.rows.map((r) => r.id)).toEqual(['minVariance', 'riskParity', 'maxSharpe', 'equalWeight'])
    expect(out.periods).toBe(220 - ESTIMATION_WINDOW)
    expect(out.folds).toBe(5)
    const eq = out.rows[3]
    // Pesos iguales no usan datos: dentro y fuera de muestra son la misma corrida.
    expect(eq.inSample.ret).toBeCloseTo(eq.oos.ret, 12)
    for (const r of out.rows) {
      expect(Number.isFinite(r.oos.ret)).toBe(true)
      expect(r.oos.maxDrawdown).toBeLessThanOrEqual(0)
    }
  })
})
