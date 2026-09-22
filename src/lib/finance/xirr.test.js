import { readFileSync } from 'node:fs'
import { dayCount, moneyWeightedReturn, xirr, xnpv } from './xirr.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/xirr.json', import.meta.url), 'utf8'))

describe('xirr: respuestas conocidas', () => {
  it('menos 1,000 y más 1,100 a los 365 días da 10 %', () => {
    const rate = xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1100 },
    ])
    expect(dayCount('2025-01-01', '2026-01-01')).toBe(365)
    expect(rate).toBeCloseTo(0.1, 12)
  })

  it('el ejemplo de la documentación de Microsoft da .373362535', () => {
    const rate = xirr([
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ])
    // Excel publica .373362535 y corta al llegar a 1e-6; la raíz exacta es .3733625335, que es la
    // que dan scipy (el golden) y este módulo. La diferencia aparece hasta el noveno decimal.
    expect(rate).toBeCloseTo(0.373362535, 6)
    expect(rate).toBeCloseTo(0.3733625335, 9)
  })

  it('el orden de los flujos no importa', () => {
    const flows = [
      { date: '2009-04-01', amount: 2750 },
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2009-02-15', amount: 3250 },
    ]
    expect(xirr(flows)).toBeCloseTo(0.3733625335, 9)
  })

  it('acepta objetos Date además de AAAA-MM-DD', () => {
    const rate = xirr([
      { date: new Date(Date.UTC(2025, 0, 1)), amount: -1000 },
      { date: new Date(Date.UTC(2026, 0, 1)), amount: 1100 },
    ])
    expect(rate).toBeCloseTo(0.1, 12)
  })

  it('una pérdida da tasa negativa', () => {
    const rate = xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 600 },
    ])
    expect(rate).toBeCloseTo(-0.4, 12)
  })

  it('el punto de partida no cambia la raíz', () => {
    const flows = [
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ]
    for (const guess of [-0.9, 0, 0.5, 5, 50]) {
      expect(xirr(flows, { guess })).toBeCloseTo(0.3733625335, 9)
    }
  })
})

describe('xnpv y dayCount', () => {
  it('el VPN en la tasa solución vale cero', () => {
    const flows = [
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1100 },
    ]
    expect(Math.abs(xnpv(xirr(flows), flows))).toBeLessThan(1e-8)
  })

  it('cuenta los días reales, bisiesto incluido', () => {
    expect(dayCount('2024-01-01', '2025-01-01')).toBe(366)
    expect(dayCount('2026-02-10', '2026-02-24')).toBe(14)
    expect(dayCount('2026-02-10', '2026-02-10')).toBe(0)
    expect(dayCount('ayer', '2026-01-01')).toBeNull()
  })

  it('el VPN devuelve null con una tasa imposible o con flujos malos', () => {
    const flows = [
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1100 },
    ]
    expect(xnpv(-1, flows)).toBeNull()
    expect(xnpv(Number.NaN, flows)).toBeNull()
    expect(xnpv(0.1, [])).toBeNull()
  })
})

describe('casos de borde', () => {
  it('devuelve null, no 0 ni NaN, cuando no hay con qué', () => {
    expect(xirr([])).toBeNull()
    expect(xirr(undefined)).toBeNull()
    expect(xirr([{ date: '2025-01-01', amount: -1000 }])).toBeNull()
    expect(xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: -500 },
    ])).toBeNull()
    expect(xirr([
      { date: '2025-01-01', amount: 1000 },
      { date: '2026-01-01', amount: 500 },
    ])).toBeNull()
  })

  it('rechaza NaN, montos que no son números y fechas inválidas', () => {
    expect(xirr([
      { date: '2025-01-01', amount: Number.NaN },
      { date: '2026-01-01', amount: 1100 },
    ])).toBeNull()
    expect(xirr([
      { date: '2025-01-01', amount: '-1000' },
      { date: '2026-01-01', amount: 1100 },
    ])).toBeNull()
    expect(xirr([
      { date: '2025-13-45', amount: -1000 },
      { date: '2026-01-01', amount: 1100 },
    ])).toBeNull()
    expect(xirr([null, { date: '2026-01-01', amount: 1100 }])).toBeNull()
  })

  it('todo el mismo día sin suma cero no tiene solución', () => {
    expect(xirr([
      { date: '2026-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1100 },
    ])).toBeNull()
  })

  it('una pérdida casi total sigue dando una tasa cercana a menos 100 %', () => {
    const rate = xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 0.01 },
    ])
    expect(rate).toBeLessThan(-0.99)
    expect(rate).toBeGreaterThan(-1)
  })
})

describe('moneyWeightedReturn', () => {
  it('arma los flujos del portafolio con el valor final', () => {
    const rate = moneyWeightedReturn([{ date: '2025-01-01', amount: 1000 }], 1100, '2026-01-01')
    expect(rate).toBeCloseTo(0.1, 12)
  })

  it('devuelve null sin flujos o con un valor final que no es número', () => {
    expect(moneyWeightedReturn([], 100, '2026-01-01')).toBeNull()
    expect(moneyWeightedReturn([{ date: '2025-01-01', amount: 1000 }], Number.NaN, '2026-01-01')).toBeNull()
  })
})

describe('golden contra scipy.optimize.brentq', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    const rate = xirr(testCase.input.cashflows)
    expect(rate).not.toBeNull()
    expect(Math.abs(rate - testCase.expected.rate)).toBeLessThan(testCase.tol)
  })

  it('el golden trae el caso de Microsoft', () => {
    expect(golden.cases.map((c) => c.name)).toContain('ejemplo-de-la-documentacion-de-microsoft')
    expect(golden.cases.length).toBeGreaterThanOrEqual(11)
  })
})
