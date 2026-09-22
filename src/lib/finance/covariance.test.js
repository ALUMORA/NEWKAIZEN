import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { annualize, corrFromCov, ledoitWolfConstantCorrelation, sampleCov } from './covariance.js'
import { InvalidInputError, isPositiveSemiDefinite } from './linalg.js'

/** @type {{cases: {name: string, fn: string, input: {returns: number[][]}, expected: any, tol: number}[]}} */
const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/covariance.json', import.meta.url), 'utf8'))

describe('sampleCov', () => {
  it('reproduce una covarianza calculada a mano (divisor n − 1)', () => {
    // x = [1, 2, 3, 4] (var = 5/3), y = [2, 4, 5, 9] (var = 26/3), cov(x, y) = 11/3
    const X = [
      [1, 2],
      [2, 4],
      [3, 5],
      [4, 9],
    ]
    const cov = /** @type {number[][]} */ (sampleCov(X))
    expect(cov[0][0]).toBeCloseTo(5 / 3, 12)
    expect(cov[1][1]).toBeCloseTo(26 / 3, 12)
    expect(cov[0][1]).toBeCloseTo(11 / 3, 12)
    expect(cov[1][0]).toBe(cov[0][1])
  })

  it('con una serie constante deja varianza cero y covarianza cero', () => {
    const cov = /** @type {number[][]} */ (
      sampleCov([
        [0.01, 5],
        [-0.02, 5],
        [0.03, 5],
      ])
    )
    expect(cov[1][1]).toBe(0)
    expect(cov[0][1]).toBe(0)
  })

  it('devuelve null con un solo periodo y con la matriz de un renglón', () => {
    expect(sampleCov([[0.01, 0.02]])).toBeNull()
  })

  it('rechaza la matriz vacía, los renglones desparejos y los NaN', () => {
    expect(() => sampleCov([])).toThrow(InvalidInputError)
    expect(() =>
      sampleCov([
        [0.1, 0.2],
        [0.3],
      ]),
    ).toThrow(InvalidInputError)
    expect(() =>
      sampleCov([
        [0.1, Number.NaN],
        [0.2, 0.3],
      ]),
    ).toThrow(InvalidInputError)
    expect(() =>
      sampleCov([
        [0.1, Number.POSITIVE_INFINITY],
        [0.2, 0.3],
      ]),
    ).toThrow(InvalidInputError)
  })
})

describe('ledoitWolfConstantCorrelation', () => {
  it('entrega delta dentro de [0, 1] y una matriz simétrica y semidefinida positiva', () => {
    const panel = golden.cases.find((c) => c.fn === 'ledoitWolfConstantCorrelation')
    const result = ledoitWolfConstantCorrelation(/** @type {any} */ (panel).input.returns)
    expect(result).not.toBeNull()
    const { cov, shrinkage } = /** @type {any} */ (result)
    expect(shrinkage).toBeGreaterThanOrEqual(0)
    expect(shrinkage).toBeLessThanOrEqual(1)
    for (let i = 0; i < cov.length; i += 1) {
      for (let j = 0; j < cov.length; j += 1) expect(cov[i][j]).toBeCloseTo(cov[j][i], 15)
    }
    expect(isPositiveSemiDefinite(cov)).toBe(true)
  })

  it('conserva las varianzas de la muestra en la diagonal', () => {
    const panel = /** @type {any} */ (golden.cases.find((c) => c.fn === 'ledoitWolfConstantCorrelation')).input.returns
    const S = /** @type {number[][]} */ (sampleCov(panel))
    const { cov } = /** @type {any} */ (ledoitWolfConstantCorrelation(panel))
    for (let i = 0; i < cov.length; i += 1) expect(cov[i][i]).toBeCloseTo(S[i][i], 14)
  })

  it('con un solo activo no contrae nada', () => {
    const result = ledoitWolfConstantCorrelation([[0.01], [-0.02], [0.03], [0.0]])
    expect(result).not.toBeNull()
    const { cov, shrinkage, meanCorrelation } = /** @type {any} */ (result)
    expect(shrinkage).toBe(0)
    expect(meanCorrelation).toBeNull()
    expect(cov[0][0]).toBeCloseTo(/** @type {number[][]} */ (sampleCov([[0.01], [-0.02], [0.03], [0.0]]))[0][0], 15)
  })

  it('devuelve null con menos de dos periodos', () => {
    expect(ledoitWolfConstantCorrelation([[0.01, 0.02]])).toBeNull()
  })

  it('con dos activos el objetivo ES la covarianza muestral, así que no hay nada que contraer', () => {
    // Con N = 2 solo hay una correlación, el promedio r̄ es esa misma, y F coincide con S: la
    // distancia gamma es cero y delta queda 0/0. PyPortfolioOpt devuelve 1 por la división entre
    // cero y aquí se devuelve 0, pero la matriz resultante es la misma en los dos casos, que es
    // lo único que se usa. El golden usa paneles de 3 activos o más justo por esto.
    const panel = [
      [0.01, -0.02],
      [-0.005, 0.03],
      [0.02, 0.01],
      [0.0, -0.01],
    ]
    const S = /** @type {number[][]} */ (sampleCov(panel))
    const { cov, shrinkage } = /** @type {any} */ (ledoitWolfConstantCorrelation(panel))
    expect(shrinkage).toBe(0)
    for (let i = 0; i < 2; i += 1) {
      for (let j = 0; j < 2; j += 1) expect(cov[i][j]).toBeCloseTo(S[i][j], 15)
    }
  })

  it('una serie constante en el panel no contagia NaN al resto', () => {
    const panel = [
      [0.01, 0.02, 0.004],
      [-0.02, 0.01, 0.004],
      [0.03, -0.01, 0.004],
      [0.0, 0.02, 0.004],
      [0.015, -0.005, 0.004],
    ]
    const { cov, shrinkage } = /** @type {any} */ (ledoitWolfConstantCorrelation(panel))
    expect(Number.isFinite(shrinkage)).toBe(true)
    for (const row of cov) for (const v of row) expect(Number.isFinite(v)).toBe(true)
    expect(cov[2][2]).toBe(0)
    expect(cov[0][2]).toBe(0)
  })

  it('con todo en ceros entrega ceros sin NaN', () => {
    const result = ledoitWolfConstantCorrelation([
      [0, 0],
      [0, 0],
      [0, 0],
    ])
    expect(result).not.toBeNull()
    const { cov } = /** @type {any} */ (result)
    for (const row of cov) for (const v of row) expect(Number.isFinite(v)).toBe(true)
  })

  it('rechaza NaN', () => {
    expect(() =>
      ledoitWolfConstantCorrelation([
        [0.1, 0.2],
        [Number.NaN, 0.3],
      ]),
    ).toThrow(InvalidInputError)
  })
})

describe('annualize y corrFromCov', () => {
  it('anualiza multiplicando por k y no toca las correlaciones', () => {
    const cov = [
      [0.04, 0.03],
      [0.03, 0.09],
    ]
    const anual = annualize(cov, 52)
    expect(anual[0][0]).toBeCloseTo(0.04 * 52, 12)
    expect(anual[0][1]).toBeCloseTo(0.03 * 52, 12)
    const c1 = /** @type {number[][]} */ (corrFromCov(cov))
    const c2 = /** @type {number[][]} */ (corrFromCov(anual))
    expect(c1[0][1]).toBeCloseTo(c2[0][1], 12)
  })

  it('corrFromCov reproduce la correlación de la definición', () => {
    const corr = /** @type {number[][]} */ (
      corrFromCov([
        [0.04, 0.03],
        [0.03, 0.09],
      ])
    )
    expect(corr[0][0]).toBe(1)
    expect(corr[1][1]).toBe(1)
    expect(corr[0][1]).toBeCloseTo(0.03 / (0.2 * 0.3), 12)
  })

  it('corrFromCov devuelve null si un activo tiene varianza cero', () => {
    expect(
      corrFromCov([
        [0.04, 0],
        [0, 0],
      ]),
    ).toBeNull()
  })

  it('annualize rechaza una k que no sirve', () => {
    expect(() => annualize([[0.04]], 0)).toThrow(InvalidInputError)
    expect(() => annualize([[0.04]], Number.NaN)).toThrow(InvalidInputError)
  })
})

describe('goldens contra PyPortfolioOpt y pandas', () => {
  for (const testCase of golden.cases) {
    it(`${testCase.fn}: ${testCase.name}`, () => {
      if (testCase.fn === 'sampleCov') {
        const cov = /** @type {number[][]} */ (sampleCov(testCase.input.returns))
        const expected = testCase.expected.cov
        for (let i = 0; i < expected.length; i += 1) {
          for (let j = 0; j < expected.length; j += 1) {
            expect(Math.abs(cov[i][j] - expected[i][j])).toBeLessThanOrEqual(testCase.tol)
          }
        }
        return
      }
      const result = ledoitWolfConstantCorrelation(testCase.input.returns)
      expect(result).not.toBeNull()
      const { cov, shrinkage } = /** @type {any} */ (result)
      expect(Math.abs(shrinkage - testCase.expected.shrinkage)).toBeLessThanOrEqual(testCase.tol)
      const expected = testCase.expected.cov
      for (let i = 0; i < expected.length; i += 1) {
        for (let j = 0; j < expected.length; j += 1) {
          expect(Math.abs(cov[i][j] - expected[i][j])).toBeLessThanOrEqual(testCase.tol)
        }
      }
      expect(isPositiveSemiDefinite(cov)).toBe(true)
    })
  }
})
