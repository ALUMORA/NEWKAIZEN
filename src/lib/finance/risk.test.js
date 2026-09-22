import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { effectiveN, exposureBy, foreignExposure, hhi, portfolioVol, riskContributions } from './risk.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/risk.json', import.meta.url), 'utf8'))

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
  hhi: (i) => hhi(i.weights),
  effectiveN: (i) => effectiveN(i.weights),
  portfolioVol: (i) => portfolioVol(i.weights, i.cov, i.k),
  riskContributions: (i) => riskContributions(i.weights, i.cov),
}

/** σ = (.2, .3) con correlación .5, por periodo. */
const COV = [
  [0.04, 0.03],
  [0.03, 0.09],
]

describe('effectiveN y hhi', () => {
  it('la respuesta conocida del spec: [.5, .3, .2] da 2.631579', () => {
    expect(effectiveN([0.5, 0.3, 0.2])).toBeCloseTo(2.631579, 6)
    expect(hhi([0.5, 0.3, 0.2])).toBeCloseTo(0.38, 12)
  })

  it('n posiciones iguales dan exactamente n', () => {
    expect(effectiveN([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(4, 12)
    expect(effectiveN([1])).toBeCloseTo(1, 12)
  })

  it('concentrar baja el número efectivo aunque haya muchas posiciones', () => {
    expect(effectiveN([0.9, 0.04, 0.03, 0.02, 0.01])).toBeLessThan(1.3)
  })

  it('pesos vacíos, en cero o sucios devuelven null', () => {
    expect(effectiveN([])).toBeNull()
    expect(effectiveN([0, 0])).toBeNull()
    expect(hhi([])).toBeNull()
    expect(hhi([0.5, NaN])).toBeNull()
  })
})

describe('portfolioVol', () => {
  it('anualiza con √k y con k = 1 da la del periodo', () => {
    const w = [0.5, 0.5]
    const porPeriodo = Math.sqrt(0.25 * 0.04 + 0.25 * 0.09 + 2 * 0.25 * 0.03)
    expect(portfolioVol(w, COV, 1)).toBeCloseTo(porPeriodo, 12)
    expect(portfolioVol(w, COV, 52)).toBeCloseTo(porPeriodo * Math.sqrt(52), 12)
  })

  it('con todo el peso en un activo devuelve la volatilidad de ese activo', () => {
    expect(portfolioVol([1, 0], COV, 1)).toBeCloseTo(0.2, 12)
    expect(portfolioVol([0, 1], COV, 1)).toBeCloseTo(0.3, 12)
  })

  it('diversificar baja la volatilidad respecto al promedio de las partes', () => {
    const cero = [
      [0.04, 0],
      [0, 0.09],
    ]
    expect(portfolioVol([0.5, 0.5], cero, 1)).toBeLessThan(0.5 * 0.2 + 0.5 * 0.3)
  })

  it('matriz mal formada, k no positivo o tamaños que no cuadran devuelven null', () => {
    expect(portfolioVol([0.5, 0.5], [[0.04]], 52)).toBeNull()
    expect(portfolioVol([0.5, 0.5, 0], COV, 52)).toBeNull()
    expect(portfolioVol([0.5, 0.5], COV, 0)).toBeNull()
    expect(portfolioVol([0.5, NaN], COV, 52)).toBeNull()
    expect(portfolioVol([0.5, 0.5], null, 52)).toBeNull()
  })
})

describe('riskContributions', () => {
  it('las aportaciones suman la volatilidad y los porcentajes suman 1', () => {
    const rc = riskContributions([0.6, 0.4], COV)
    expect(rc.contribution.reduce((a, b) => a + b, 0)).toBeCloseTo(rc.volatility, 12)
    expect(rc.percent.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })

  it('con un solo activo, ese activo aporta el 100 %', () => {
    const rc = riskContributions([1, 0], COV)
    expect(rc.percent[0]).toBeCloseTo(1, 12)
    expect(rc.percent[1]).toBeCloseTo(0, 12)
  })

  it('el activo más volátil puede aportar más riesgo que peso', () => {
    const rc = riskContributions([0.5, 0.5], COV)
    expect(rc.percent[1]).toBeGreaterThan(0.5)
    expect(rc.percent[0]).toBeLessThan(0.5)
  })

  it('sin riesgo no hay nada que repartir', () => {
    expect(
      riskContributions(
        [0.5, 0.5],
        [
          [0, 0],
          [0, 0],
        ],
      ),
    ).toBeNull()
    expect(riskContributions([], COV)).toBeNull()
    expect(riskContributions([0.5, 0.5], [[0.04]])).toBeNull()
  })
})

describe('exposureBy y foreignExposure', () => {
  const posiciones = [
    { symbol: 'WALMEX.MX', value: 50000, currency: 'MXN', sector: 'Consumo' },
    { symbol: 'AAPL', value: 30000, currency: 'USD', sector: 'Tecnología' },
    { symbol: 'FUNO11.MX', value: 20000, currency: 'MXN', sector: 'FIBRAs' },
  ]

  it('agrupa y saca el peso de cada grupo, de mayor a menor', () => {
    const porMoneda = exposureBy(posiciones, 'currency')
    expect(porMoneda).toEqual([
      { key: 'MXN', value: 70000, weight: 0.7 },
      { key: 'USD', value: 30000, weight: 0.3 },
    ])
  })

  it('agrupa por cualquier atributo', () => {
    const porSector = exposureBy(posiciones, 'sector')
    expect(porSector.map((e) => e.key)).toEqual(['Consumo', 'Tecnología', 'FIBRAs'])
    expect(porSector.reduce((acc, e) => acc + e.weight, 0)).toBeCloseTo(1, 12)
  })

  it('una posición sin el atributo cae en el grupo null, que la interfaz dibuja como s/d', () => {
    const conFaltante = [...posiciones, { symbol: 'X', value: 10000 }]
    const porSector = exposureBy(conFaltante, 'sector')
    const sinDato = porSector.find((e) => e.key === null)
    expect(sinDato.value).toBe(10000)
    expect(sinDato.weight).toBeCloseTo(0.0909090909, 9)
  })

  it('con total cero los pesos salen en null y los valores se conservan', () => {
    const netos = exposureBy([{ value: 100, currency: 'MXN' }, { value: -100, currency: 'USD' }], 'currency')
    expect(netos.every((e) => e.weight === null)).toBe(true)
    expect(netos.map((e) => e.value).sort((a, b) => a - b)).toEqual([-100, 100])
  })

  it('la exposición a moneda extranjera mide lo que no está en la moneda base', () => {
    expect(foreignExposure(posiciones, 'MXN')).toBeCloseTo(0.3, 12)
    expect(foreignExposure(posiciones, 'USD')).toBeCloseTo(0.7, 12)
  })

  it('entradas malas devuelven null', () => {
    expect(exposureBy(null, 'currency')).toBeNull()
    expect(exposureBy(posiciones, 42)).toBeNull()
    expect(exposureBy([{ value: NaN, currency: 'MXN' }], 'currency')).toBeNull()
    expect(exposureBy([], 'currency')).toEqual([])
    expect(foreignExposure([], 'MXN')).toBeNull()
  })
})

describe('golden de numpy', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    expectClose(call[testCase.fn](testCase.input), testCase.expected, testCase.tol)
  })
})
