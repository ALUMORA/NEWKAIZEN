import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { capmExpected, historicalMean, jamesStein } from './expected.js'
import { InvalidInputError } from './linalg.js'

/** @type {{cases: {name: string, fn: string, input: any, expected: any, tol: number}[]}} */
const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/expected.json', import.meta.url), 'utf8'))

describe('capmExpected', () => {
  it('aplica rf + β·ERP activo por activo', () => {
    const mu = capmExpected([0.8, 1, 1.25], 0.0925, 0.055)
    expect(mu[0]).toBeCloseTo(0.0925 + 0.8 * 0.055, 14)
    expect(mu[1]).toBeCloseTo(0.0925 + 0.055, 14)
    expect(mu[2]).toBeCloseTo(0.0925 + 1.25 * 0.055, 14)
  })

  it('con beta 0 devuelve la tasa libre de riesgo', () => {
    expect(capmExpected([0], 0.0925, 0.055)[0]).toBeCloseTo(0.0925, 15)
  })

  it('con ERP 0 todos los activos valen lo mismo', () => {
    const mu = capmExpected([0.5, 2], 0.09, 0)
    expect(mu[0]).toBeCloseTo(mu[1], 15)
  })

  it('rechaza lista vacía, NaN en las betas y rf o ERP no finitos', () => {
    expect(() => capmExpected([], 0.09, 0.05)).toThrow(InvalidInputError)
    expect(() => capmExpected([1, Number.NaN], 0.09, 0.05)).toThrow(InvalidInputError)
    expect(() => capmExpected([1], Number.NaN, 0.05)).toThrow(InvalidInputError)
    expect(() => capmExpected([1], 0.09, Number.POSITIVE_INFINITY)).toThrow(InvalidInputError)
  })
})

describe('historicalMean', () => {
  it('anualiza el promedio aritmético multiplicando por k', () => {
    const r = historicalMean(
      [
        [0.01, 0.02],
        [0.03, -0.01],
        [-0.02, 0.05],
        [0.02, 0.02],
      ],
      52,
    )
    expect(r).not.toBeNull()
    const value = /** @type {any} */ (r)
    expect(value.perPeriod[0]).toBeCloseTo(0.01, 14)
    expect(value.mu[0]).toBeCloseTo(0.52, 12)
    expect(value.perPeriod[1]).toBeCloseTo(0.02, 14)
    expect(value.periods).toBe(4)
  })

  it('siempre viene marcado como ruidoso, con advertencia en español y sin guiones largos', () => {
    const r = /** @type {any} */ (
      historicalMean(
        [
          [0.01],
          [0.02],
        ],
        52,
      )
    )
    expect(r.noisy).toBe(true)
    expect(r.warning).toContain('ruido')
    expect(r.warning).not.toMatch(/[—–]/)
  })

  it('devuelve null con un solo periodo', () => {
    expect(historicalMean([[0.01, 0.02]], 52)).toBeNull()
  })

  it('rechaza matriz vacía, renglones desparejos, NaN y k inválida', () => {
    expect(() => historicalMean([], 52)).toThrow(InvalidInputError)
    expect(() => historicalMean([[0.01, 0.02], [0.03]], 52)).toThrow(InvalidInputError)
    expect(() => historicalMean([[0.01], [Number.NaN]], 52)).toThrow(InvalidInputError)
    expect(() => historicalMean([[0.01], [0.02]], 0)).toThrow(InvalidInputError)
  })
})

describe('jamesStein', () => {
  const cov = [
    [0.04, 0.01, 0.005],
    [0.01, 0.09, 0.012],
    [0.005, 0.012, 0.16],
  ]

  it('deja las medias entre el promedio original y el objetivo', () => {
    const means = [0.05, 0.11, 0.2]
    const r = /** @type {any} */ (jamesStein(means, cov, 156))
    for (let i = 0; i < means.length; i += 1) {
      const lo = Math.min(means[i], r.target)
      const hi = Math.max(means[i], r.target)
      expect(r.mu[i]).toBeGreaterThanOrEqual(lo - 1e-12)
      expect(r.mu[i]).toBeLessThanOrEqual(hi + 1e-12)
    }
    expect(r.shrinkage).toBeGreaterThan(0)
    expect(r.shrinkage).toBeLessThan(1)
  })

  it('con más periodos encoge menos', () => {
    const means = [0.05, 0.11, 0.2]
    const pocos = /** @type {any} */ (jamesStein(means, cov, 24))
    const muchos = /** @type {any} */ (jamesStein(means, cov, 520))
    expect(pocos.shrinkage).toBeGreaterThan(muchos.shrinkage)
  })

  it('si todas las medias ya son iguales no cambia nada', () => {
    const r = /** @type {any} */ (jamesStein([0.1, 0.1, 0.1], cov, 100))
    expect(r.shrinkage).toBe(1)
    for (const m of r.mu) expect(m).toBeCloseTo(0.1, 14)
  })

  it('con un solo activo no hay a dónde encoger', () => {
    const r = /** @type {any} */ (jamesStein([0.12], [[0.04]], 100))
    expect(r.shrinkage).toBe(0)
    expect(r.mu[0]).toBe(0.12)
  })

  it('por omisión encoge hacia el promedio simple de las medias, como pide el spec', () => {
    const r = /** @type {any} */ (jamesStein([0.05, 0.11, 0.2], cov, 156))
    const explicito = /** @type {any} */ (jamesStein([0.05, 0.11, 0.2], cov, 156, { target: 'average' }))
    expect(r.target).toBeCloseTo((0.05 + 0.11 + 0.2) / 3, 14)
    expect(r.shrinkage).toBe(explicito.shrinkage)
  })

  it('la contracción no depende de si las medias vienen por periodo o anualizadas (con k)', () => {
    // Panel semanal de 156 x 5 con un factor común. Sin `k` la versión anualizada encogía ~30 veces
    // menos, porque d crece con k y λ = (N + 2)/d se encoge: era como tener k·T observaciones.
    let state = 20260922
    const uniform = () => {
      state = (1664525 * state + 1013904223) >>> 0
      return (state + 0.5) / 4294967296
    }
    const normal = () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform())
    const T = 156
    const returns = []
    for (let t = 0; t < T; t += 1) {
      const f = normal() * 0.02
      returns.push([0, 1, 2, 3, 4].map((i) => 0.001 * (i + 1) + f + normal() * 0.02))
    }
    const hm = /** @type {any} */ (historicalMean(returns, 52))
    const perPeriodCov = [0, 1, 2, 3, 4].map((i) =>
      [0, 1, 2, 3, 4].map((j) => {
        let s = 0
        for (const row of returns) s += (row[i] - hm.perPeriod[i]) * (row[j] - hm.perPeriod[j])
        return s / (T - 1)
      }),
    )
    const annualCov = perPeriodCov.map((row) => row.map((v) => v * 52))
    for (const target of /** @type {const} */ (['average', 'minVariance'])) {
      const semanal = /** @type {any} */ (jamesStein(hm.perPeriod, perPeriodCov, T, { target }))
      const anual = /** @type {any} */ (jamesStein(hm.mu, annualCov, T, { target, k: 52 }))
      expect(semanal.shrinkage).toBeGreaterThan(0.05)
      expect(anual.shrinkage).toBeCloseTo(semanal.shrinkage, 12)
      expect(anual.target).toBeCloseTo(semanal.target * 52, 12)
      for (let i = 0; i < 5; i += 1) expect(anual.mu[i]).toBeCloseTo(semanal.mu[i] * 52, 12)
    }
  })

  it('el objetivo "average" es el promedio simple', () => {
    const r = /** @type {any} */ (jamesStein([0.05, 0.11, 0.2], cov, 156, { target: 'average' }))
    expect(r.target).toBeCloseTo((0.05 + 0.11 + 0.2) / 3, 14)
  })

  it('rechaza NaN, dimensiones que no casan y T inválida', () => {
    expect(() => jamesStein([0.05, Number.NaN, 0.2], cov, 156)).toThrow(InvalidInputError)
    expect(() => jamesStein([0.05, 0.11], cov, 156)).toThrow(InvalidInputError)
    expect(() => jamesStein([0.05, 0.11, 0.2], cov, 0)).toThrow(InvalidInputError)
    expect(() => jamesStein([], cov, 156)).toThrow(InvalidInputError)
    expect(() => jamesStein([0.05, 0.11, 0.2], cov, 156, { k: 0 })).toThrow(InvalidInputError)
    expect(() => jamesStein([0.05, 0.11, 0.2], cov, 156, { k: Number.NaN })).toThrow(InvalidInputError)
  })
})

describe('goldens contra numpy', () => {
  for (const testCase of golden.cases) {
    it(`${testCase.fn}: ${testCase.name}`, () => {
      const { input, expected, tol } = testCase
      if (testCase.fn === 'capmExpected') {
        const mu = capmExpected(input.betas, input.rfAnnual, input.erp)
        for (let i = 0; i < mu.length; i += 1) {
          expect(Math.abs(mu[i] - expected.mu[i])).toBeLessThanOrEqual(tol)
        }
        return
      }
      if (testCase.fn === 'historicalMean') {
        const r = /** @type {any} */ (historicalMean(input.returns, input.k))
        for (let i = 0; i < r.mu.length; i += 1) {
          expect(Math.abs(r.mu[i] - expected.mu[i])).toBeLessThanOrEqual(tol)
          expect(Math.abs(r.perPeriod[i] - expected.perPeriod[i])).toBeLessThanOrEqual(tol)
        }
        return
      }
      const r = /** @type {any} */ (jamesStein(input.means, input.cov, input.T, { target: input.target, k: input.k ?? 1 }))
      expect(Math.abs(r.shrinkage - expected.shrinkage)).toBeLessThanOrEqual(tol)
      expect(Math.abs(r.target - expected.target)).toBeLessThanOrEqual(tol)
      for (let i = 0; i < r.mu.length; i += 1) {
        expect(Math.abs(r.mu[i] - expected.mu[i])).toBeLessThanOrEqual(tol)
      }
    })
  }
})
