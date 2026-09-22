import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { alignPanel, cumulative, inferInterval, isInterval, logReturns, panelReturns, periodsPerYear, simpleReturns, totalReturn } from './returns.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/returns.json', import.meta.url), 'utf8'))

/** Compara números, arreglos y objetos contra el golden, con tolerancia absoluta y relativa. */
function expectClose(actual, expected, tol) {
  if (expected === null) return expect(actual).toBeNull()
  if (typeof expected === 'number') {
    expect(typeof actual).toBe('number')
    return expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol + Math.abs(expected) * tol)
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true)
    expect(actual).toHaveLength(expected.length)
    expected.forEach((value, i) => expectClose(actual[i], value, tol))
    return undefined
  }
  if (typeof expected === 'object') {
    for (const key of Object.keys(expected)) expectClose(actual[key], expected[key], tol)
    return undefined
  }
  return expect(actual).toBe(expected)
}

const call = {
  simpleReturns: (i) => simpleReturns(i.prices),
  logReturns: (i) => logReturns(i.prices),
  cumulative: (i) => cumulative(i.returns),
  totalReturn: (i) => totalReturn(i.returns),
  inferInterval: (i) => inferInterval(i.dates),
  alignPanel: (i) => alignPanel(i.seriesBySymbol),
  panelReturns: (i) => panelReturns(i.panel),
}

describe('simpleReturns y logReturns', () => {
  const prices = [100, 110, 99, 108.9]

  it('la respuesta conocida del spec: [.10, −.10, .10]', () => {
    const r = simpleReturns(prices)
    expect(r).toHaveLength(3)
    expect(r[0]).toBeCloseTo(0.1, 12)
    expect(r[1]).toBeCloseTo(-0.1, 12)
    expect(r[2]).toBeCloseTo(0.1, 12)
  })

  it('la suma de los rendimientos logarítmicos es ln 1.089', () => {
    const r = logReturns(prices)
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(Math.log(1.089), 12)
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(0.0852598, 7)
  })

  it('el acumulado de los simples coincide con exp de la suma de los logarítmicos', () => {
    expect(totalReturn(simpleReturns(prices))).toBeCloseTo(Math.exp(logReturns(prices).reduce((a, b) => a + b, 0)) - 1, 12)
  })

  it('pide al menos dos precios y rechaza datos sucios', () => {
    expect(simpleReturns([])).toBeNull()
    expect(simpleReturns([100])).toBeNull()
    expect(simpleReturns([100, NaN, 120])).toBeNull()
    expect(simpleReturns([100, null, 120])).toBeNull()
    expect(simpleReturns([100, '110', 120])).toBeNull()
    expect(simpleReturns([100, Infinity])).toBeNull()
    expect(simpleReturns('no es arreglo')).toBeNull()
    expect(logReturns([100])).toBeNull()
    expect(logReturns([100, NaN])).toBeNull()
  })

  it('un precio en cero no deja dividir, y uno negativo no deja sacar logaritmo', () => {
    expect(simpleReturns([0, 100])).toBeNull()
    expect(logReturns([100, -5])).toBeNull()
    expect(logReturns([0, 100])).toBeNull()
  })

  it('precios planos dan rendimientos en cero, no nulos', () => {
    expect(simpleReturns([50, 50, 50])).toEqual([0, 0])
    expect(logReturns([50, 50, 50])).toEqual([0, 0])
  })
})

describe('cumulative y totalReturn', () => {
  it('la trayectoria empieza en 1 y trae un elemento más que los rendimientos', () => {
    const path = cumulative([0.1, -0.1, 0.1])
    expect(path).toHaveLength(4)
    expect(path[0]).toBe(1)
    expect(path[3]).toBeCloseTo(1.089, 12)
  })

  it('sin periodos devuelve solo el punto de partida', () => {
    expect(cumulative([])).toEqual([1])
    expect(totalReturn([])).toBe(0)
  })

  it('rechaza NaN', () => {
    expect(cumulative([0.1, NaN])).toBeNull()
    expect(totalReturn([0.1, NaN])).toBeNull()
  })

  it('una pérdida total deja la trayectoria en cero', () => {
    expect(cumulative([-1, 0.5])).toEqual([1, 0, 0])
    expect(totalReturn([-1])).toBe(-1)
  })
})

describe('periodsPerYear e inferInterval', () => {
  it('252, 52 y 12', () => {
    expect(periodsPerYear('1d')).toBe(252)
    expect(periodsPerYear('1wk')).toBe(52)
    expect(periodsPerYear('1mo')).toBe(12)
    expect(periodsPerYear('3mo')).toBe(4)
    expect(periodsPerYear('1y')).toBe(1)
  })

  it('un intervalo desconocido no se adivina', () => {
    expect(periodsPerYear('1min')).toBeNull()
    expect(periodsPerYear('')).toBeNull()
    expect(periodsPerYear(undefined)).toBeNull()
    expect(isInterval('1d')).toBe(true)
    expect(isInterval('1min')).toBe(false)
  })

  it('deduce el intervalo por la mediana de los huecos', () => {
    expect(inferInterval(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'])).toBe('1d')
    expect(inferInterval(['2026-01-05', '2026-01-12', '2026-01-19'])).toBe('1wk')
    expect(inferInterval(['2026-01-05', '2026-02-05', '2026-03-05'])).toBe('1mo')
  })

  it('un fin de semana de por medio no convierte una serie diaria en semanal', () => {
    expect(inferInterval(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12'])).toBe('1d')
  })

  it('pide al menos dos fechas ISO válidas', () => {
    expect(inferInterval(['2026-01-05'])).toBeNull()
    expect(inferInterval([])).toBeNull()
    expect(inferInterval(['2026-01-05', '05/01/2026'])).toBeNull()
    expect(inferInterval(['2026-02-30', '2026-03-01'])).toBeNull()
  })
})

describe('alignPanel', () => {
  const A = { dates: ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'], values: [100, 110, 121, 133.1] }
  const B = { dates: ['2026-01-05', '2026-01-07', '2026-01-08'], values: [50, 55, 60.5] }

  it('la respuesta conocida del spec: se quedan d1, d3 y d4', () => {
    const panel = alignPanel({ A, B })
    expect(panel.dates).toEqual(['2026-01-05', '2026-01-07', '2026-01-08'])
    expect(panel.values.A).toEqual([100, 121, 133.1])
    expect(panel.values.B).toEqual([50, 55, 60.5])
    expect(panel.dropped).toEqual([])
  })

  it('los rendimientos se calculan después de alinear: A [.21, .10] y B [.10, .10]', () => {
    const r = panelReturns(alignPanel({ A, B }))
    expect(r.dates).toEqual(['2026-01-07', '2026-01-08'])
    expect(r.values.A[0]).toBeCloseTo(0.21, 12)
    expect(r.values.A[1]).toBeCloseTo(0.1, 12)
    expect(r.values.B[0]).toBeCloseTo(0.1, 12)
    expect(r.values.B[1]).toBeCloseTo(0.1, 12)
  })

  it('no rellena hacia adelante: el día que falta desaparece para todos', () => {
    const panel = alignPanel({ A, B })
    expect(panel.dates).not.toContain('2026-01-06')
    expect(panel.values.A).toHaveLength(panel.dates.length)
    expect(panel.values.B).toHaveLength(panel.dates.length)
  })

  it('descarta la serie mal armada y sigue con las demás', () => {
    const rota = { dates: ['2026-01-05', '2026-01-07'], values: [10] }
    const conNaN = { dates: ['2026-01-05', '2026-01-07'], values: [10, NaN] }
    const desordenada = { dates: ['2026-01-07', '2026-01-05'], values: [10, 11] }
    const repetida = { dates: ['2026-01-05', '2026-01-05'], values: [10, 11] }
    const panel = alignPanel({ A, B, ROTA: rota, NAN: conNaN, DESORDEN: desordenada, REPETIDA: repetida })
    expect(panel.dropped).toEqual(['DESORDEN', 'NAN', 'REPETIDA', 'ROTA'])
    expect(Object.keys(panel.values).sort()).toEqual(['A', 'B'])
  })

  it('sin traslape devuelve un panel vacío, no una mezcla', () => {
    const C = { dates: ['2025-06-01', '2025-06-02'], values: [1, 2] }
    const panel = alignPanel({ A, C })
    expect(panel.dates).toEqual([])
    expect(panel.values.A).toEqual([])
    expect(panel.values.C).toEqual([])
  })

  it('con minDates se saca al símbolo de historia más corta hasta que alcance el traslape', () => {
    const corta = { dates: ['2026-01-08'], values: [7] }
    const panel = alignPanel({ A, B, CORTA: corta }, { minDates: 2 })
    expect(panel.dropped).toEqual(['CORTA'])
    expect(panel.dates).toEqual(['2026-01-05', '2026-01-07', '2026-01-08'])
  })

  it('con un panel vacío no truena', () => {
    expect(alignPanel({})).toEqual({ dates: [], values: {}, dropped: [] })
    expect(alignPanel(null)).toEqual({ dates: [], values: {}, dropped: [] })
  })

  it('panelReturns pide al menos dos fechas', () => {
    expect(panelReturns({ dates: ['2026-01-05'], values: { A: [100] } })).toBeNull()
    expect(panelReturns({ dates: ['2026-01-05', '2026-01-06'], values: { A: [100] } })).toBeNull()
    expect(panelReturns(null)).toBeNull()
  })
})

describe('golden de numpy', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    expectClose(call[testCase.fn](testCase.input), testCase.expected, testCase.tol)
  })
})

// El barril no tiene archivo de prueba propio en scripts/ownership.json, así que su superficie
// pública se revisa desde aquí: es la puerta por la que entran todas las features de la fase 3.
describe('el barril index.js', () => {
  it('exporta por nombre todo lo público de A1 y el derivePositions de A4', async () => {
    const api = await import('./index.js')
    const esperados = [
      // returns
      'simpleReturns', 'logReturns', 'cumulative', 'totalReturn', 'periodsPerYear', 'inferInterval', 'isInterval', 'alignPanel', 'panelReturns',
      // stats
      'mean', 'variance', 'stdev', 'covariance', 'correlation', 'quantile', 'ols', 'normalPdf', 'normalCdf', 'normalInvCdf',
      // performance
      'cagr', 'cagrFromReturns', 'annualizedVol', 'sharpe', 'sortino', 'drawdowns', 'calmar',
      'historicalVaR', 'historicalCVaR', 'parametricVaR', 'parametricCVaR', 'percentile', 'summary',
      // benchmark
      'regress', 'blumeBeta', 'trackingError', 'informationRatio', 'treynor', 'jensenAlpha', 'captureRatios', 'activeReturns', 'averageActive',
      // rates
      'cetesPerPeriod', 'cetesEffectiveAnnual', 'annualToPerPeriod', 'changeInBp', 'rfSeriesForDates', 'MAX_STALE_DAYS',
      // risk
      'effectiveN', 'hhi', 'portfolioVol', 'riskContributions', 'exposureBy', 'foreignExposure',
      // backtest
      'buyAndHold', 'constantMix', 'withBenchmark', 'annualTurnover', 'weightsSum',
      // fx
      'toCurrency', 'pnlDecomposition', 'fxAt', 'convertSeries', 'returnInBaseCurrency', 'CURRENCIES', 'MAX_FX_STALE_DAYS',
      // ledger (A4)
      'derivePositions',
    ]
    for (const nombre of esperados) expect(api[nombre], nombre).toBeDefined()
    expect(Object.keys(api).sort()).toEqual([...esperados].sort())
  })

  it('no filtra los ayudantes internos de _util.js', async () => {
    const api = await import('./index.js')
    for (const interno of ['numericArray', 'numericMatrix', 'perPeriodSeries', 'parseIsoDate', 'daysBetween', 'dot', 'matVec', 'sumOf', 'isNum', 'normalizedWeights', 'EPS']) {
      expect(api[interno], interno).toBeUndefined()
    }
  })

  it('la función que se importa del barril es la misma del módulo', async () => {
    const api = await import('./index.js')
    expect(api.simpleReturns).toBe(simpleReturns)
    expect(api.simpleReturns([100, 110])[0]).toBeCloseTo(0.1, 12)
  })
})
