import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { activeReturns, averageActive, blumeBeta, captureRatios, informationRatio, jensenAlpha, regress, trackingError, treynor } from './benchmark.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/benchmark.json', import.meta.url), 'utf8'))

function expectClose(actual, expected, tol) {
  if (expected === null) return expect(actual).toBeNull()
  if (typeof expected === 'number') {
    expect(typeof actual).toBe('number')
    return expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol + Math.abs(expected) * tol)
  }
  if (Array.isArray(expected)) {
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
  regress: (i) => regress(i.portExcess, i.benchExcess, i.k),
  jensenAlpha: (i) => jensenAlpha(i.portReturns, i.benchReturns, i.rfPerPeriod, i.k),
  blumeBeta: (i) => blumeBeta(i.beta),
  treynor: (i) => treynor(i.portReturns, i.rfPerPeriod, i.beta, i.k),
  trackingError: (i) => trackingError(i.active, i.k),
  informationRatio: (i) => informationRatio(i.active, i.k),
  captureRatios: (i) => captureRatios(i.port, i.bench),
}

const X = [0.01, 0.02, -0.01, 0.03, 0]
const Y = [0.02, 0.025, -0.02, 0.05, 0]

describe('regress', () => {
  it('la respuesta conocida del spec: beta 1.65, alfa −.0015, R² .972321', () => {
    const fit = regress(Y, X)
    expect(fit.beta).toBeCloseTo(1.65, 12)
    expect(fit.alpha).toBeCloseTo(-0.0015, 12)
    expect(fit.r2).toBeCloseTo(0.972321, 6)
    expect(fit.n).toBe(5)
  })

  it('la alfa anual va compuesta y también aritmética', () => {
    const fit = regress(Y, X, 52)
    expect(fit.alphaAnnual).toBeCloseTo((1 - 0.0015) ** 52 - 1, 12)
    expect(fit.alphaAnnualArithmetic).toBeCloseTo(-0.0015 * 52, 12)
    expect(fit.alphaAnnual).not.toBeCloseTo(fit.alphaAnnualArithmetic, 6)
  })

  it('con k = 1 las cifras anuales son las del periodo', () => {
    const fit = regress(Y, X, 1)
    expect(fit.alphaAnnual).toBeCloseTo(fit.alpha, 15)
    expect(fit.alphaAnnualArithmetic).toBeCloseTo(fit.alpha, 15)
  })

  it('pide 3 periodos, largos iguales, un índice que varíe y k positivo', () => {
    expect(regress([0.1, 0.2], [0.1, 0.2], 52)).toBeNull()
    expect(regress(Y, X.slice(1), 52)).toBeNull()
    expect(regress(Y, [0, 0, 0, 0, 0], 52)).toBeNull()
    expect(regress(Y, X, 0)).toBeNull()
    expect(regress([0.1, 0.2, NaN], [0.1, 0.2, 0.3], 52)).toBeNull()
  })
})

describe('blumeBeta', () => {
  it('acerca la beta a 1', () => {
    expect(blumeBeta(1)).toBeCloseTo(1, 12)
    expect(blumeBeta(1.65)).toBeCloseTo(1.4355, 12)
    expect(blumeBeta(0.4)).toBeCloseTo(0.598, 12)
  })

  it('una beta ajustada siempre queda entre la cruda y 1', () => {
    for (const beta of [0.2, 0.8, 1.4, 2.5]) {
      const ajustada = blumeBeta(beta)
      expect(Math.abs(ajustada - 1)).toBeLessThan(Math.abs(beta - 1))
    }
  })

  it('rechaza NaN', () => {
    expect(blumeBeta(NaN)).toBeNull()
    expect(blumeBeta('1.2')).toBeNull()
  })
})

describe('trackingError e informationRatio', () => {
  const A = [0.01, -0.005, 0.002, 0.003]

  it('la respuesta conocida del spec: TE .0442568 e IR 2.93740 en semanal', () => {
    expect(trackingError(A, 52)).toBeCloseTo(0.0442568, 7)
    expect(informationRatio(A, 52)).toBeCloseTo(2.9374, 4)
  })

  it('un activo constante no tiene tracking error, y sin él no hay IR', () => {
    expect(trackingError([0.002, 0.002, 0.002], 52)).toBe(0)
    expect(informationRatio([0.002, 0.002, 0.002], 52)).toBeNull()
  })

  it('piden dos periodos y k positivo', () => {
    expect(trackingError([0.01], 52)).toBeNull()
    expect(trackingError(A, 0)).toBeNull()
    expect(informationRatio([0.01, NaN], 52)).toBeNull()
  })
})

describe('treynor y jensenAlpha', () => {
  it('treynor divide el exceso anualizado entre la beta', () => {
    expect(treynor([0.02, 0.01, 0.03], 0.001, 1.5, 52)).toBeCloseTo(((0.02 + 0.01 + 0.03) / 3 - 0.001) * 52 / 1.5, 12)
  })

  it('con beta cero Treynor no existe', () => {
    expect(treynor([0.02, 0.01], 0.001, 0, 52)).toBeNull()
  })

  it('jensenAlpha devuelve la alfa anual compuesta de la regresión de los excesos', () => {
    const fit = regress(Y, X, 52)
    expect(jensenAlpha(Y, X, 0, 52)).toBeCloseTo(fit.alphaAnnual, 12)
  })

  it('con rf constante la alfa no cambia, porque se resta de los dos lados', () => {
    expect(jensenAlpha(Y, X, 0.001, 1)).toBeCloseTo(-0.0015 + 0.001 * (1.65 - 1), 12)
  })

  it('piden datos suficientes', () => {
    expect(jensenAlpha([0.1, 0.2], [0.1, 0.2], 0, 52)).toBeNull()
    expect(jensenAlpha(Y, X.slice(1), 0, 52)).toBeNull()
    expect(jensenAlpha(Y, X, [0.001], 52)).toBeNull()
    expect(treynor([], 0, 1.2, 52)).toBeNull()
  })
})

describe('captureRatios', () => {
  it('captura 1 arriba y abajo cuando el portafolio replica al índice', () => {
    const bench = [0.02, -0.01, 0.03, -0.02]
    const ratios = captureRatios(bench, bench)
    expect(ratios.up).toBeCloseTo(1, 12)
    expect(ratios.down).toBeCloseTo(1, 12)
    expect(ratios.upPeriods).toBe(2)
    expect(ratios.downPeriods).toBe(2)
  })

  it('la mitad de cada movimiento da capturas cercanas a .5', () => {
    const bench = [0.02, -0.02]
    const ratios = captureRatios(bench.map((v) => v / 2), bench)
    expect(ratios.up).toBeCloseTo(0.5, 12)
    expect(ratios.down).toBeCloseTo(0.5, 12)
  })

  it('sin periodos de un lado, ese lado sale en null', () => {
    const ratios = captureRatios([0.01, 0.02], [0.03, 0.04])
    expect(ratios.up).not.toBeNull()
    expect(ratios.down).toBeNull()
    expect(ratios.downPeriods).toBe(0)
  })

  it('los periodos en cero del índice no cuentan de ningún lado', () => {
    const ratios = captureRatios([0.01, 0.02, 0.03], [0.01, 0, -0.01])
    expect(ratios.upPeriods).toBe(1)
    expect(ratios.downPeriods).toBe(1)
  })

  it('largos distintos o vacíos devuelven null', () => {
    expect(captureRatios([0.01], [0.01, 0.02])).toBeNull()
    expect(captureRatios([], [])).toBeNull()
    expect(captureRatios([NaN], [0.01])).toBeNull()
  })
})

describe('activeReturns y averageActive', () => {
  it('resta periodo a periodo', () => {
    const active = activeReturns([0.03, 0.01], [0.01, 0.02])
    expect(active).toHaveLength(2)
    expect(active[0]).toBeCloseTo(0.02, 12)
    expect(active[1]).toBeCloseTo(-0.01, 12)
    expect(averageActive([0.03, 0.01], [0.01, 0.02])).toBeCloseTo(0.005, 12)
  })

  it('largos distintos devuelven null', () => {
    expect(activeReturns([0.03], [0.01, 0.02])).toBeNull()
    expect(averageActive([0.03, NaN], [0.01, 0.02])).toBeNull()
  })
})

describe('golden de scipy', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    expectClose(call[testCase.fn](testCase.input), testCase.expected, testCase.tol)
  })
})
