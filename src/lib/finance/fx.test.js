import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { convertSeries, fxAt, pnlDecomposition, returnInBaseCurrency, toCurrency } from './fx.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/fx.json', import.meta.url), 'utf8'))

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
  pnlDecomposition: (i) => pnlDecomposition(i),
  toCurrency: (i) => toCurrency(i.amount, i.from, i.to, i.usdmxn),
  returnInBaseCurrency: (i) => returnInBaseCurrency(i.localReturn, i.fx0, i.fx1),
}

describe('pnlDecomposition', () => {
  it('la respuesta conocida del spec: 8,700 = 5,100 de precio + 3,600 de tipo de cambio', () => {
    const split = pnlDecomposition({ quantity: 10, price0: 150, price1: 180, fx0: 17, fx1: 19 })
    expect(split.total).toBeCloseTo(8700, 9)
    expect(split.priceEffect).toBeCloseTo(5100, 9)
    expect(split.fxEffect).toBeCloseTo(3600, 9)
    expect(split.cross).toBe(0)
  })

  it('los dos efectos suman el resultado calculado por el camino largo', () => {
    const p = { quantity: 25, price0: 200, price1: 170, fx0: 20.5, fx1: 18.25 }
    const split = pnlDecomposition(p)
    const directo = p.quantity * p.price1 * p.fx1 - p.quantity * p.price0 * p.fx0
    expect(split.priceEffect + split.fxEffect).toBeCloseTo(directo, 9)
    expect(split.total).toBeCloseTo(directo, 9)
  })

  it('si el precio no se mueve, todo el resultado es tipo de cambio', () => {
    const split = pnlDecomposition({ quantity: 3, price0: 1250, price1: 1250, fx0: 16.75, fx1: 18.9 })
    expect(split.priceEffect).toBe(0)
    expect(split.fxEffect).toBeCloseTo(split.total, 9)
  })

  it('si el tipo de cambio no se mueve, todo el resultado es precio', () => {
    const split = pnlDecomposition({ quantity: 120, price0: 42.5, price1: 47.8, fx0: 18, fx1: 18 })
    expect(split.fxEffect).toBe(0)
    expect(split.priceEffect).toBeCloseTo(split.total, 9)
  })

  it('una posición que ya está en pesos se pasa con fx 1 y no inventa efecto cambiario', () => {
    const split = pnlDecomposition({ quantity: 10, price0: 60, price1: 66, fx0: 1, fx1: 1 })
    expect(split.total).toBeCloseTo(60, 12)
    expect(split.fxEffect).toBe(0)
  })

  it('sin cantidad, sin precio o sin tipo de cambio no hay desglose', () => {
    expect(pnlDecomposition({ quantity: 10, price0: 150, price1: 180, fx0: 17, fx1: null })).toBeNull()
    expect(pnlDecomposition({ quantity: NaN, price0: 150, price1: 180, fx0: 17, fx1: 19 })).toBeNull()
    expect(pnlDecomposition({ quantity: 10, price0: 150, price1: 180, fx0: 17 })).toBeNull()
  })
})

describe('toCurrency', () => {
  it('convierte en los dos sentidos con pesos por dólar', () => {
    expect(toCurrency(100, 'USD', 'MXN', 18)).toBeCloseTo(1800, 9)
    expect(toCurrency(1800, 'MXN', 'USD', 18)).toBeCloseTo(100, 9)
  })

  it('ida y vuelta regresan al mismo monto', () => {
    expect(toCurrency(toCurrency(1234.56, 'MXN', 'USD', 18.4321), 'USD', 'MXN', 18.4321)).toBeCloseTo(1234.56, 9)
  })

  it('de una moneda a sí misma no pide tipo de cambio', () => {
    expect(toCurrency(100, 'MXN', 'MXN', null)).toBe(100)
    expect(toCurrency(100, 'USD', 'USD', undefined)).toBe(100)
  })

  it('sin tipo de cambio devuelve null, no un 17.5 inventado', () => {
    expect(toCurrency(100, 'USD', 'MXN', null)).toBeNull()
    expect(toCurrency(100, 'USD', 'MXN', undefined)).toBeNull()
    expect(toCurrency(100, 'USD', 'MXN', NaN)).toBeNull()
    expect(toCurrency(100, 'USD', 'MXN', 0)).toBeNull()
    expect(toCurrency(100, 'USD', 'MXN', -18)).toBeNull()
  })

  it('una moneda que no manejamos devuelve null en vez de pasar el monto tal cual', () => {
    expect(toCurrency(100, 'EUR', 'MXN', 18)).toBeNull()
    expect(toCurrency(100, 'MXN', 'JPY', 18)).toBeNull()
    expect(toCurrency(NaN, 'USD', 'MXN', 18)).toBeNull()
  })
})

describe('fxAt', () => {
  const serie = { dates: ['2026-01-05', '2026-01-06', '2026-01-09'], values: [18.1, 18.2, 18.4] }

  it('toma la publicación del mismo día cuando existe', () => {
    expect(fxAt(serie, '2026-01-06')).toEqual({ value: 18.2, asOf: '2026-01-06', staleDays: 0 })
  })

  it('arrastra la última publicación en fin de semana', () => {
    expect(fxAt(serie, '2026-01-11')).toEqual({ value: 18.4, asOf: '2026-01-09', staleDays: 2 })
  })

  it('más allá del límite de días no arrastra', () => {
    expect(fxAt(serie, '2026-02-01')).toBeNull()
    expect(fxAt(serie, '2026-02-01', { maxStaleDays: 60 })).toEqual({ value: 18.4, asOf: '2026-01-09', staleDays: 23 })
  })

  it('antes de la primera publicación no hay dato', () => {
    expect(fxAt(serie, '2026-01-01')).toBeNull()
  })

  it('serie mal armada o fecha inválida devuelven null', () => {
    expect(fxAt({ dates: ['2026-01-05'], values: [] }, '2026-01-05')).toBeNull()
    expect(fxAt(serie, '05/01/2026')).toBeNull()
    expect(fxAt(null, '2026-01-05')).toBeNull()
    expect(fxAt({ dates: ['2026-01-05'], values: [NaN] }, '2026-01-05')).toBeNull()
  })
})

describe('convertSeries y returnInBaseCurrency', () => {
  it('convierte cada punto con su propio tipo de cambio, no con uno solo', () => {
    expect(convertSeries([100, 100], [17, 19], 'USD', 'MXN')).toEqual([1700, 1900])
  })

  it('de una moneda a sí misma devuelve la serie igual', () => {
    expect(convertSeries([100, 200], [17, 19], 'MXN', 'MXN')).toEqual([100, 200])
  })

  it('largos distintos o tipos de cambio faltantes devuelven null', () => {
    expect(convertSeries([100, 100], [17], 'USD', 'MXN')).toBeNull()
    expect(convertSeries([100, 100], [17, 0], 'USD', 'MXN')).toBeNull()
    expect(convertSeries([], [], 'USD', 'MXN')).toBeNull()
  })

  it('el rendimiento en pesos combina el local con el movimiento del peso', () => {
    expect(returnInBaseCurrency(0.05, 17, 18)).toBeCloseTo(1.05 * (18 / 17) - 1, 12)
    expect(returnInBaseCurrency(0, 18, 18)).toBe(0)
  })

  it('un tipo de cambio en cero o negativo devuelve null', () => {
    expect(returnInBaseCurrency(0.05, 0, 18)).toBeNull()
    expect(returnInBaseCurrency(0.05, 17, -1)).toBeNull()
    expect(returnInBaseCurrency(NaN, 17, 18)).toBeNull()
  })
})

describe('golden del desglose', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    expectClose(call[testCase.fn](testCase.input), testCase.expected, testCase.tol)
  })
})
