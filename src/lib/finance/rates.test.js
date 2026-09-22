import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { annualToPerPeriod, cetesEffectiveAnnual, cetesPerPeriod, changeInBp, MAX_STALE_DAYS, rfSeriesForDates } from './rates.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/rates.json', import.meta.url), 'utf8'))

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
  cetesPerPeriod: (i) => cetesPerPeriod(i.annualYield, i.days, i.tenorDays),
  cetesEffectiveAnnual: (i) => cetesEffectiveAnnual(i.annualYield, i.tenorDays),
  annualToPerPeriod: (i) => annualToPerPeriod(i.annualRate, i.k),
  changeInBp: (i) => changeInBp(i.from, i.to),
  rfSeriesForDates: (i) => rfSeriesForDates(i.rfSeries, i.targetDates, i.interval),
}

describe('cetesPerPeriod', () => {
  it('la respuesta conocida del spec: 11 % a 28 días, 7 días de tramo, da .0021321', () => {
    expect(cetesPerPeriod(0.11, 7)).toBeCloseTo(0.0021321, 7)
  })

  it('la respuesta conocida del spec: la efectiva anual de ese 11 % es .117455', () => {
    expect(cetesEffectiveAnnual(0.11)).toBeCloseTo(0.117455, 6)
    expect(cetesPerPeriod(0.11, 365)).toBeCloseTo(0.117455, 6)
  })

  it('la tasa nominal y la efectiva no son lo mismo: 11 % rinde 11.7455 %', () => {
    expect(cetesEffectiveAnnual(0.11)).toBeGreaterThan(0.11)
  })

  it('en el plazo exacto rinde justo la tasa del plazo, con base 360', () => {
    expect(cetesPerPeriod(0.11, 28)).toBeCloseTo((0.11 * 28) / 360, 14)
  })

  it('con tasa cero no rinde nada, en cualquier plazo', () => {
    expect(cetesPerPeriod(0, 7)).toBe(0)
    expect(cetesPerPeriod(0, 365)).toBe(0)
  })

  it('días o plazo no positivos, y entradas sucias, devuelven null', () => {
    expect(cetesPerPeriod(0.11, 0)).toBeNull()
    expect(cetesPerPeriod(0.11, -7)).toBeNull()
    expect(cetesPerPeriod(0.11, 7, 0)).toBeNull()
    expect(cetesPerPeriod(NaN, 7)).toBeNull()
    expect(cetesPerPeriod(0.11, NaN)).toBeNull()
    expect(cetesEffectiveAnnual(-20)).toBeNull()
  })
})

describe('annualToPerPeriod y changeInBp', () => {
  it('reparte una tasa anual efectiva entre k periodos y se vuelve a componer', () => {
    const semanal = annualToPerPeriod(0.1174545668, 52)
    expect((1 + semanal) ** 52 - 1).toBeCloseTo(0.1174545668, 12)
  })

  it('un punto base es una centésima de punto porcentual', () => {
    expect(changeInBp(0.08, 0.0825)).toBeCloseTo(25, 9)
    expect(changeInBp(0.1125, 0.105)).toBeCloseTo(-75, 9)
    expect(changeInBp(0.08, 0.08)).toBe(0)
  })

  it('entradas sucias devuelven null', () => {
    expect(annualToPerPeriod(0.1, 0)).toBeNull()
    expect(annualToPerPeriod(-2, 52)).toBeNull()
    expect(annualToPerPeriod(NaN, 52)).toBeNull()
    expect(changeInBp(NaN, 0.08)).toBeNull()
  })
})

describe('rfSeriesForDates', () => {
  const rfSeries = {
    dates: ['2025-12-25', '2026-01-01', '2026-01-08', '2026-01-15'],
    values: [0.112, 0.111, 0.11, 0.109],
  }
  const targetDates = ['2026-01-05', '2026-01-12', '2026-01-19']

  it('usa la tasa vigente al INICIO de cada periodo, no la del cierre', () => {
    const rf = rfSeriesForDates(rfSeries, targetDates, '1wk')
    expect(rf).toHaveLength(2)
    // El 5 de enero la última publicación es la del 1: .111, no la del 8.
    expect(rf[0]).toBeCloseTo(cetesPerPeriod(0.111, 7), 14)
    expect(rf[1]).toBeCloseTo(cetesPerPeriod(0.11, 7), 14)
  })

  it('usa los días reales entre fechas, no un largo nominal', () => {
    const conHueco = ['2026-01-05', '2026-01-26']
    const rf = rfSeriesForDates(rfSeries, conHueco, '1wk')
    expect(rf[0]).toBeCloseTo(cetesPerPeriod(0.111, 21), 14)
  })

  it('antes de la primera publicación no inventa tasa', () => {
    const rf = rfSeriesForDates({ dates: ['2026-02-01'], values: [0.11] }, targetDates, '1wk')
    expect(rf).toEqual([null, null])
  })

  it(`una tasa más vieja que ${MAX_STALE_DAYS} días deja el periodo en null`, () => {
    const vieja = { dates: ['2025-10-01'], values: [0.11] }
    expect(rfSeriesForDates(vieja, targetDates, '1wk')).toEqual([null, null])
    const alFilo = { dates: ['2025-12-01'], values: [0.11] }
    expect(rfSeriesForDates(alFilo, ['2026-01-05', '2026-01-12'], '1wk')[0]).not.toBeNull()
  })

  it('no reordena la salida si la serie de tasas viene desordenada', () => {
    const desordenada = { dates: ['2026-01-08', '2025-12-25', '2026-01-01'], values: [0.11, 0.112, 0.111] }
    expect(rfSeriesForDates(desordenada, targetDates, '1wk')).toEqual(rfSeriesForDates(rfSeries, targetDates, '1wk'))
  })

  it('pide al menos dos fechas objetivo y datos bien armados', () => {
    expect(rfSeriesForDates(rfSeries, ['2026-01-05'], '1wk')).toBeNull()
    expect(rfSeriesForDates(rfSeries, [], '1wk')).toBeNull()
    expect(rfSeriesForDates({ dates: ['2026-01-01'], values: [] }, targetDates, '1wk')).toBeNull()
    expect(rfSeriesForDates({ dates: ['no-es-fecha'], values: [0.11] }, targetDates, '1wk')).toBeNull()
    expect(rfSeriesForDates({ dates: ['2026-01-01'], values: [NaN] }, targetDates, '1wk')).toBeNull()
    expect(rfSeriesForDates(null, targetDates, '1wk')).toBeNull()
  })

  it('con fechas objetivo repetidas cae al largo nominal del intervalo', () => {
    const rf = rfSeriesForDates(rfSeries, ['2026-01-05', '2026-01-05'], '1wk')
    expect(rf[0]).toBeCloseTo(cetesPerPeriod(0.111, 365 / 52), 14)
  })
})

describe('golden de la fórmula de mercado', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    expectClose(call[testCase.fn](testCase.input), testCase.expected, testCase.tol)
  })
})
