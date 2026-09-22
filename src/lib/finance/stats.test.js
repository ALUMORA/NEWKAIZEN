import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { correlation, covariance, mean, normalCdf, normalInvCdf, normalPdf, ols, quantile, stdev, variance } from './stats.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/stats.json', import.meta.url), 'utf8'))

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
  mean: (i) => mean(i.values),
  variance: (i) => variance(i.values),
  stdev: (i) => stdev(i.values),
  covariance: (i) => covariance(i.x, i.y),
  correlation: (i) => correlation(i.x, i.y),
  quantile: (i) => quantile(i.sorted, i.q),
  ols: (i) => ols(i.y, i.x),
  normalPdf: (i) => normalPdf(i.z),
  normalCdf: (i) => normalCdf(i.z),
  normalInvCdf: (i) => normalInvCdf(i.p),
}

const R = [0.01, 0.02, -0.01, 0.03, 0]

describe('mean, variance y stdev', () => {
  it('la respuesta conocida del spec: media .01, varianza 2.5e−4, desviación .0158114', () => {
    expect(mean(R)).toBeCloseTo(0.01, 12)
    expect(variance(R)).toBeCloseTo(2.5e-4, 12)
    expect(stdev(R)).toBeCloseTo(0.0158114, 7)
  })

  it('la volatilidad semanal anualizada de esa serie es .114018', () => {
    expect(stdev(R) * Math.sqrt(52)).toBeCloseTo(0.114018, 6)
  })

  it('usa n−1, no n: con n la desviación saldría más chica', () => {
    const conN = Math.sqrt(R.reduce((acc, v) => acc + (v - 0.01) ** 2, 0) / R.length)
    expect(stdev(R)).toBeGreaterThan(conN)
    expect(stdev(R)).toBeCloseTo(conN * Math.sqrt(R.length / (R.length - 1)), 14)
  })

  it('la varianza pide dos observaciones y la media una', () => {
    expect(mean([])).toBeNull()
    expect(mean([0.5])).toBe(0.5)
    expect(variance([0.5])).toBeNull()
    expect(stdev([0.5])).toBeNull()
    expect(variance([0.5, 0.5])).toBe(0)
  })

  it('rechaza NaN y valores que no son número', () => {
    expect(mean([1, NaN])).toBeNull()
    expect(variance([1, 2, undefined])).toBeNull()
    expect(stdev([1, '2'])).toBeNull()
    expect(mean('no es arreglo')).toBeNull()
  })

  it('una serie de puros ceros tiene varianza cero, no null', () => {
    expect(variance([0, 0, 0])).toBe(0)
    expect(stdev([0, 0, 0])).toBe(0)
  })
})

describe('covariance y correlation', () => {
  const x = [0.01, 0.02, -0.01, 0.03, 0]
  const y = [0.02, 0.025, -0.02, 0.05, 0]

  it('covarianza de muestra con n−1', () => {
    expect(covariance(x, y)).toBeCloseTo(4.125e-4, 12)
  })

  it('la correlación de una serie consigo misma es 1', () => {
    expect(correlation(x, x)).toBeCloseTo(1, 12)
    expect(correlation(x, x.map((v) => -v))).toBeCloseTo(-1, 12)
  })

  it('con una serie constante la correlación no existe', () => {
    expect(correlation(x, [1, 1, 1, 1, 1])).toBeNull()
    expect(covariance(x, [1, 1, 1, 1, 1])).toBe(0)
  })

  it('largos distintos o datos sucios devuelven null', () => {
    expect(covariance(x, y.slice(1))).toBeNull()
    expect(correlation(x, [0.1, NaN, 0.2, 0.3, 0.4])).toBeNull()
    expect(covariance([1], [2])).toBeNull()
  })
})

describe('quantile tipo 7', () => {
  const sorted = [1, 2, 3, 4, 5]

  it('interpola igual que numpy', () => {
    expect(quantile(sorted, 0)).toBe(1)
    expect(quantile(sorted, 1)).toBe(5)
    expect(quantile(sorted, 0.5)).toBe(3)
    expect(quantile(sorted, 0.25)).toBe(2)
    expect(quantile(sorted, 0.1)).toBeCloseTo(1.4, 12)
  })

  it('con un solo valor devuelve ese valor', () => {
    expect(quantile([7], 0.9)).toBe(7)
  })

  it('q fuera de [0,1], arreglo vacío o NaN devuelven null', () => {
    expect(quantile(sorted, 1.2)).toBeNull()
    expect(quantile(sorted, -0.1)).toBeNull()
    expect(quantile([], 0.5)).toBeNull()
    expect(quantile([1, NaN], 0.5)).toBeNull()
    expect(quantile(sorted, NaN)).toBeNull()
  })
})

describe('ols', () => {
  const x = [0.01, 0.02, -0.01, 0.03, 0]
  const y = [0.02, 0.025, -0.02, 0.05, 0]

  it('la respuesta conocida del spec: beta 1.65, alfa −.0015, R² .972321', () => {
    const fit = ols(y, x)
    expect(fit.beta).toBeCloseTo(1.65, 12)
    expect(fit.alpha).toBeCloseTo(-0.0015, 12)
    expect(fit.r2).toBeCloseTo(0.972321, 6)
    expect(fit.n).toBe(5)
  })

  it('con un ajuste perfecto la R² es 1 y los residuales son cero', () => {
    const fit = ols([2, 4, 6, 8], [1, 2, 3, 4])
    expect(fit.beta).toBeCloseTo(2, 12)
    expect(fit.alpha).toBeCloseTo(0, 12)
    expect(fit.r2).toBeCloseTo(1, 12)
    expect(fit.residualStd).toBeCloseTo(0, 12)
  })

  it('pide 3 observaciones y una x que varíe', () => {
    expect(ols([1, 2], [1, 2])).toBeNull()
    expect(ols([1, 2, 3], [5, 5, 5])).toBeNull()
    expect(ols([1, 2, 3], [1, 2])).toBeNull()
    expect(ols([1, 2, NaN], [1, 2, 3])).toBeNull()
  })

  it('con una y constante la R² es 0 y la beta también', () => {
    const fit = ols([4, 4, 4], [1, 2, 3])
    expect(fit.beta).toBeCloseTo(0, 12)
    expect(fit.r2).toBe(0)
  })
})

describe('funciones de la normal', () => {
  it('φ(0) = 1/√(2π) y Φ(0) = ½', () => {
    expect(normalPdf(0)).toBeCloseTo(0.3989422804014327, 15)
    expect(normalCdf(0)).toBeCloseTo(0.5, 15)
  })

  it('el cuantil de 5 % es −1.6448536269514722', () => {
    expect(normalInvCdf(0.05)).toBeCloseTo(-1.6448536269514722, 10)
    expect(normalInvCdf(0.975)).toBeCloseTo(1.959963984540054, 10)
  })

  it('la inversa deshace la acumulada', () => {
    for (const p of [0.001, 0.05, 0.3, 0.5, 0.8, 0.999]) {
      expect(normalCdf(normalInvCdf(p))).toBeCloseTo(p, 12)
    }
  })

  it('es simétrica', () => {
    expect(normalCdf(-1.3) + normalCdf(1.3)).toBeCloseTo(1, 14)
    expect(normalPdf(-2.1)).toBeCloseTo(normalPdf(2.1), 15)
    expect(normalInvCdf(0.2)).toBeCloseTo(-normalInvCdf(0.8), 10)
  })

  it('las colas extremas se saturan sin devolver NaN', () => {
    expect(normalCdf(40)).toBe(1)
    expect(normalCdf(-40)).toBe(0)
  })

  it('p fuera de (0,1) y entradas no numéricas devuelven null', () => {
    expect(normalInvCdf(0)).toBeNull()
    expect(normalInvCdf(1)).toBeNull()
    expect(normalInvCdf(NaN)).toBeNull()
    expect(normalPdf(NaN)).toBeNull()
    expect(normalCdf(Infinity)).toBeNull()
  })
})

describe('golden de numpy y scipy', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    expectClose(call[testCase.fn](testCase.input), testCase.expected, testCase.tol)
  })
})
