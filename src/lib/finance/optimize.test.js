import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { InvalidInputError } from './linalg.js'
import {
  efficientFrontier,
  InfeasibleError,
  maxSharpe,
  meanVariance,
  minVariance,
  projectBoxSimplex,
  riskParity,
} from './optimize.js'

/** @type {{cases: {name: string, fn: string, input: any, expected: any, tol: number}[]}} */
const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/optimize.json', import.meta.url), 'utf8'))

/**
 * Covarianza de dos activos a partir de volatilidades y correlación.
 * @param {number} s1
 * @param {number} s2
 * @param {number} rho
 * @returns {number[][]}
 */
const cov2 = (s1, s2, rho) => [
  [s1 * s1, rho * s1 * s2],
  [rho * s1 * s2, s2 * s2],
]

describe('projectBoxSimplex', () => {
  it('reproduce el caso del spec: v=[.5,.3,.2] con tope .4 da [.4,.35,.25]', () => {
    const w = projectBoxSimplex([0.5, 0.3, 0.2], 0, 0.4)
    expect(w[0]).toBeCloseTo(0.4, 12)
    expect(w[1]).toBeCloseTo(0.35, 12)
    expect(w[2]).toBeCloseTo(0.25, 12)
  })

  it('un punto que ya está en el conjunto no se mueve', () => {
    const w = projectBoxSimplex([0.5, 0.3, 0.2], 0, 1)
    expect(w[0]).toBeCloseTo(0.5, 14)
    expect(w[1]).toBeCloseTo(0.3, 14)
    expect(w[2]).toBeCloseTo(0.2, 14)
  })

  it('siempre entrega pesos que suman 1 y respetan la caja', () => {
    const cases = [
      { v: [-1, 2, 0.5], l: 0, u: 1 },
      { v: [10, 10, 10, 10], l: 0.1, u: 0.4 },
      { v: [0, 0, 0], l: 0, u: 1 },
      { v: [0.9, -0.2, 0.15, 0.4, 0.05], l: [0.05, 0.05, 0, 0, 0.1], u: [0.4, 0.4, 0.3, 0.5, 0.3] },
    ]
    for (const { v, l, u } of cases) {
      const w = projectBoxSimplex(v, l, u)
      const sum = w.reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 12)
      const lo = typeof l === 'number' ? w.map(() => l) : l
      const hi = typeof u === 'number' ? w.map(() => u) : u
      for (let i = 0; i < w.length; i += 1) {
        expect(w[i]).toBeGreaterThanOrEqual(lo[i] - 1e-12)
        expect(w[i]).toBeLessThanOrEqual(hi[i] + 1e-12)
      }
    }
  })

  it('con un solo activo la única solución es 1', () => {
    expect(projectBoxSimplex([0.3])[0]).toBeCloseTo(1, 14)
  })

  it('lanza InfeasibleError cuando la caja no deja sumar 1', () => {
    expect(() => projectBoxSimplex([0.5, 0.5], 0, 0.35)).toThrow(InfeasibleError)
    expect(() => projectBoxSimplex([0.5, 0.5, 0.5], 0.4, 1)).toThrow(InfeasibleError)
    expect(() => projectBoxSimplex([0.5, 0.5], [0.6, 0], [0.2, 1])).toThrow(InfeasibleError)
  })

  it('el mensaje de infactibilidad está en español y sin guiones largos', () => {
    try {
      projectBoxSimplex([0.5, 0.5], 0, 0.35)
      throw new Error('debió lanzar')
    } catch (err) {
      const message = /** @type {Error} */ (err).message
      expect(message).toContain('No hay solución')
      expect(message).not.toMatch(/[—–]/)
    }
  })

  it('rechaza vector vacío y NaN', () => {
    expect(() => projectBoxSimplex([])).toThrow(InvalidInputError)
    expect(() => projectBoxSimplex([0.5, Number.NaN])).toThrow(InvalidInputError)
    expect(() => projectBoxSimplex([0.5, 0.5], Number.NaN, 1)).toThrow(InvalidInputError)
  })
})

describe('minVariance', () => {
  it('σ=(.2,.3) con ρ=0 da w₁ = .692308 y σ_p = .166410', () => {
    const r = minVariance(cov2(0.2, 0.3, 0))
    expect(r.weights[0]).toBeCloseTo(0.6923076923, 8)
    expect(r.weights[1]).toBeCloseTo(0.3076923077, 8)
    expect(r.volatility).toBeCloseTo(0.1664100589, 8)
    expect(r.converged).toBe(true)
  })

  it('σ=(.2,.3) con ρ=.5 da w₁ = .857143 y σ_p = .196396', () => {
    const r = minVariance(cov2(0.2, 0.3, 0.5))
    expect(r.weights[0]).toBeCloseTo(0.8571428571, 8)
    expect(r.volatility).toBeCloseTo(0.1963961012, 8)
  })

  it('con un tope que muerde, se pega al tope', () => {
    const r = minVariance(cov2(0.2, 0.3, 0), { u: 0.6 })
    expect(r.weights[0]).toBeCloseTo(0.6, 9)
    expect(r.weights[1]).toBeCloseTo(0.4, 9)
  })

  it('con dos activos idénticos e independientes reparte parejo', () => {
    const r = minVariance(cov2(0.25, 0.25, 0))
    expect(r.weights[0]).toBeCloseTo(0.5, 9)
  })

  it('un solo activo pesa 1 y su volatilidad es la suya', () => {
    const r = minVariance([[0.04]])
    expect(r.weights[0]).toBeCloseTo(1, 14)
    expect(r.volatility).toBeCloseTo(0.2, 12)
  })

  it('lanza InfeasibleError con n=2 y tope .35, como dice el spec', () => {
    expect(() => minVariance(cov2(0.2, 0.3, 0), { u: 0.35 })).toThrow(InfeasibleError)
  })

  it('rechaza covarianza con NaN o no cuadrada', () => {
    expect(() => minVariance([[0.04, Number.NaN], [0.01, 0.09]])).toThrow(InvalidInputError)
    expect(() => minVariance([[0.04, 0.01]])).toThrow(InvalidInputError)
    expect(() => minVariance([])).toThrow(InvalidInputError)
  })
})

describe('meanVariance', () => {
  it('con tau = 0 es exactamente mínima varianza', () => {
    const S = cov2(0.2, 0.3, 0.2)
    const a = meanVariance([0.1, 0.15], S, 0)
    const b = minVariance(S)
    expect(a.weights[0]).toBeCloseTo(b.weights[0], 10)
  })

  it('subir tau nunca baja el rendimiento esperado', () => {
    const S = cov2(0.2, 0.3, 0.2)
    let previous = -Infinity
    for (const tau of [0, 0.1, 0.5, 1, 5, 50]) {
      const r = meanVariance([0.1, 0.15], S, tau)
      expect(r.expectedReturn).toBeGreaterThanOrEqual(previous - 1e-12)
      previous = /** @type {number} */ (r.expectedReturn)
    }
  })

  it('con tau enorme se va al activo de mayor rendimiento esperado', () => {
    const r = meanVariance([0.1, 0.15], cov2(0.2, 0.3, 0.2), 1000)
    expect(r.weights[1]).toBeCloseTo(1, 6)
  })

  it('rechaza tau negativo y dimensiones que no casan', () => {
    expect(() => meanVariance([0.1, 0.15], cov2(0.2, 0.3, 0), -1)).toThrow(InvalidInputError)
    expect(() => meanVariance([0.1], cov2(0.2, 0.3, 0), 1)).toThrow(InvalidInputError)
  })
})

describe('maxSharpe', () => {
  it('reproduce el portafolio tangente del spec', () => {
    const r = maxSharpe([0.1, 0.15], cov2(0.2, 0.3, 0), 0.05)
    expect(r).not.toBeNull()
    const t = /** @type {any} */ (r)
    expect(t.weights[0]).toBeCloseTo(0.5294117647, 7)
    expect(t.weights[1]).toBeCloseTo(0.4705882353, 7)
    expect(t.sharpe).toBeCloseTo(0.4166666667, 8)
  })

  it('le gana en Sharpe a cualquier punto de la frontera', () => {
    const mu = [0.08, 0.12, 0.15]
    const S = [
      [0.04, 0.006, 0.008],
      [0.006, 0.09, 0.012],
      [0.008, 0.012, 0.16],
    ]
    const t = /** @type {any} */ (maxSharpe(mu, S, 0.04))
    for (const point of efficientFrontier(mu, S, { points: 25 })) {
      const sharpe = (/** @type {number} */ (point.expectedReturn) - 0.04) / point.volatility
      expect(t.sharpe).toBeGreaterThanOrEqual(sharpe - 1e-9)
    }
  })

  it('con todos los rendimientos esperados iguales entrega el de mínima varianza', () => {
    const S = cov2(0.2, 0.3, 0)
    const t = /** @type {any} */ (maxSharpe([0.1, 0.1], S, 0.02))
    expect(t.weights[0]).toBeCloseTo(minVariance(S).weights[0], 8)
  })

  it('rechaza rf no finito', () => {
    expect(() => maxSharpe([0.1, 0.15], cov2(0.2, 0.3, 0), Number.NaN)).toThrow(InvalidInputError)
  })

  it('devuelve null si ningún portafolio factible rinde más que rf', () => {
    // Con exceso máximo negativo el máximo de (μ − rf)/σ vive en la rama ineficiente (conviene MÁS
    // volatilidad), que el barrido sobre la frontera no visita: antes salía [1, 0] con Sharpe −0.30
    // etiquetado como tangente, cuando [0, 1] da −0.08. Ahí no hay portafolio tangente que enseñar.
    expect(maxSharpe([0.02, 0.01], cov2(0.1, 0.5, 0), 0.05)).toBeNull()
    // Exceso máximo exactamente cero: tampoco hay tangente con Sharpe positivo.
    expect(maxSharpe([0.05, 0.03], cov2(0.2, 0.3, 0), 0.05)).toBeNull()
    // Todos los μ iguales y por debajo de rf.
    expect(maxSharpe([0.03, 0.03], cov2(0.2, 0.3, 0), 0.05)).toBeNull()
  })

  it('el exceso máximo se mide con la caja: si el tope deja fuera al único activo que le gana a rf, null', () => {
    // Sin tope, el activo 1 rinde .10 > rf. Con u=.5 el máximo factible es .5·.10 + .5·.02 = .06 < .07.
    const S = cov2(0.2, 0.3, 0)
    expect(maxSharpe([0.1, 0.02], S, 0.07)).not.toBeNull()
    expect(maxSharpe([0.1, 0.02], S, 0.07, { u: 0.5 })).toBeNull()
  })

  it('con exceso positivo pero mínima varianza por debajo de rf, sigue encontrando el tangente', () => {
    const mu = [0.03, 0.09]
    const S = cov2(0.1, 0.3, 0.2)
    const rf = 0.05
    const t = /** @type {any} */ (maxSharpe(mu, S, rf))
    expect(t).not.toBeNull()
    let best = -Infinity
    for (let i = 0; i <= 20000; i += 1) {
      const w = i / 20000
      const m = w * mu[0] + (1 - w) * mu[1]
      const v = w * w * S[0][0] + 2 * w * (1 - w) * S[0][1] + (1 - w) * (1 - w) * S[1][1]
      best = Math.max(best, (m - rf) / Math.sqrt(v))
    }
    expect(t.sharpe).toBeGreaterThan(0)
    expect(t.sharpe).toBeGreaterThanOrEqual(best - 1e-9)
  })
})

describe('efficientFrontier', () => {
  const mu = [0.07, 0.11, 0.16]
  const S = [
    [0.03, 0.004, 0.006],
    [0.004, 0.07, 0.01],
    [0.006, 0.01, 0.14],
  ]

  it('sale ordenada, con rendimiento y volatilidad no decrecientes', () => {
    const points = efficientFrontier(mu, S, { points: 20 })
    expect(points.length).toBeGreaterThan(10)
    for (let i = 1; i < points.length; i += 1) {
      expect(/** @type {number} */ (points[i].expectedReturn)).toBeGreaterThan(
        /** @type {number} */ (points[i - 1].expectedReturn),
      )
      expect(points[i].volatility).toBeGreaterThanOrEqual(points[i - 1].volatility - 1e-9)
    }
  })

  it('arranca en el portafolio de mínima varianza y termina en el de máximo rendimiento', () => {
    const points = efficientFrontier(mu, S, { points: 20 })
    const mv = minVariance(S)
    expect(points[0].volatility).toBeCloseTo(mv.volatility, 6)
    expect(/** @type {number} */ (points[points.length - 1].expectedReturn)).toBeCloseTo(Math.max(...mu), 6)
  })

  it('todos los puntos suman 1 y respetan la caja', () => {
    for (const point of efficientFrontier(mu, S, { points: 12, u: 0.5 })) {
      expect(point.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
      for (const w of point.weights) {
        expect(w).toBeGreaterThanOrEqual(-1e-12)
        expect(w).toBeLessThanOrEqual(0.5 + 1e-9)
      }
    }
  })

  it('con todos los μ iguales se colapsa a un punto', () => {
    const points = efficientFrontier([0.1, 0.1, 0.1], S, { points: 20 })
    expect(points).toHaveLength(1)
  })
})

describe('riskParity', () => {
  it('σ=(.2,.3) con ρ=0 da [.6, .4]', () => {
    const r = /** @type {any} */ (riskParity(cov2(0.2, 0.3, 0)))
    expect(r.weights[0]).toBeCloseTo(0.6, 10)
    expect(r.weights[1]).toBeCloseTo(0.4, 10)
    expect(r.converged).toBe(true)
  })

  it('reparte el riesgo parejo dentro de 1e-8', () => {
    const S = [
      [0.04, 0.012, 0.005],
      [0.012, 0.09, 0.02],
      [0.005, 0.02, 0.16],
    ]
    const r = /** @type {any} */ (riskParity(S))
    const rc = r.riskContributions
    expect(Math.max(...rc) - Math.min(...rc)).toBeLessThan(1e-8)
    for (const c of rc) expect(c).toBeCloseTo(1 / 3, 8)
  })

  it('respeta un presupuesto de riesgo desigual', () => {
    const S = cov2(0.2, 0.3, 0.3)
    const r = /** @type {any} */ (riskParity(S, { budget: [0.7, 0.3] }))
    expect(r.riskContributions[0]).toBeCloseTo(0.7, 8)
    expect(r.riskContributions[1]).toBeCloseTo(0.3, 8)
  })

  it('devuelve null si un activo tiene varianza cero', () => {
    expect(
      riskParity([
        [0.04, 0],
        [0, 0],
      ]),
    ).toBeNull()
  })

  it('rechaza un presupuesto con ceros o del largo equivocado', () => {
    expect(() => riskParity(cov2(0.2, 0.3, 0), { budget: [1, 0] })).toThrow(InvalidInputError)
    expect(() => riskParity(cov2(0.2, 0.3, 0), { budget: [1] })).toThrow(InvalidInputError)
  })
})

describe('goldens contra scipy (SLSQP y root)', () => {
  for (const testCase of golden.cases) {
    it(`${testCase.fn}: ${testCase.name}`, () => {
      const { input, expected, tol } = testCase
      /** @type {number[]} */
      let weights
      if (testCase.fn === 'projectBoxSimplex') {
        weights = projectBoxSimplex(input.v, input.l, input.u)
      } else if (testCase.fn === 'minVariance') {
        weights = minVariance(input.cov, { l: input.l, u: input.u }).weights
      } else if (testCase.fn === 'meanVariance') {
        weights = meanVariance(input.mu, input.cov, input.tau, { l: input.l, u: input.u }).weights
      } else if (testCase.fn === 'maxSharpe') {
        const r = maxSharpe(input.mu, input.cov, input.rf, { l: input.l, u: input.u })
        expect(r).not.toBeNull()
        weights = /** @type {any} */ (r).weights
        expect(Math.abs(/** @type {any} */ (r).sharpe - expected.sharpe)).toBeLessThanOrEqual(tol)
      } else if (testCase.fn === 'riskParity') {
        const r = riskParity(input.cov)
        expect(r).not.toBeNull()
        weights = /** @type {any} */ (r).weights
      } else {
        throw new Error(`Caso desconocido en el golden: ${testCase.fn}`)
      }
      expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
      for (let i = 0; i < expected.weights.length; i += 1) {
        expect(Math.abs(weights[i] - expected.weights[i])).toBeLessThanOrEqual(tol)
      }
    })
  }
})
