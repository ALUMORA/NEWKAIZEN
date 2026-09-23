import { describe, expect, it } from 'vitest'
import {
  decimalsOf, extent, fmtAxisDate, linearScale, logScale, logTicks, nearestIndex, niceStep, niceTicks,
  timeScale, timeTicks, toMs, valueFormatter,
} from './scale.js'
import { fitText, placeLabels, placeXTicks } from './measure.js'

describe('niceTicks', () => {
  it('da pasos 1, 2, 2.5 y 5 por década', () => {
    expect(niceStep(0.7)).toBe(1)
    expect(niceStep(1.5)).toBe(2)
    expect(niceStep(2.2)).toBe(2.5)
    expect(niceStep(3)).toBe(5)
    expect(niceStep(7)).toBe(10)
    expect(niceStep(0.03)).toBeCloseTo(0.05)
  })
  it('cubre el dominio con marcas limpias', () => {
    const { ticks, step } = niceTicks(0.013, 0.97, 5)
    expect(step).toBe(0.2)
    expect(ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })
  it('sin errores de coma flotante', () => {
    expect(niceTicks(-0.3, 0.3, 6).ticks).toEqual([-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3])
  })
  it('dominio degenerado se abre alrededor del valor', () => {
    const { ticks } = niceTicks(5, 5)
    expect(ticks[0]).toBeLessThan(5)
    expect(ticks.at(-1)).toBeGreaterThan(5)
    expect(niceTicks(0, 0).ticks).toContain(0)
  })
  it('faltantes dan cero marcas', () => {
    expect(niceTicks(NaN, 1).ticks).toEqual([])
  })
  it('decimalsOf', () => {
    expect(decimalsOf(0.25)).toBe(2)
    expect(decimalsOf(5)).toBe(0)
    expect(decimalsOf(0.1)).toBe(1)
  })
})

describe('linearScale', () => {
  it('mapea e invierte', () => {
    const s = linearScale([0, 100], [0, 200])
    expect(s(50)).toBe(100)
    expect(s.invert(100)).toBe(50)
  })
  it('rango invertido (eje y)', () => {
    const s = linearScale([0, 10], [100, 0])
    expect(s(10)).toBe(0)
    expect(s(0)).toBe(100)
  })
  it('dominio degenerado va al centro', () => {
    expect(linearScale([3, 3], [0, 100])(3)).toBe(50)
  })
  it('ticks dentro del dominio', () => {
    expect(linearScale([0, 1], [0, 1]).ticks(5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })
})

describe('logScale', () => {
  it('potencias de 10 equidistantes', () => {
    const s = logScale([1, 1000], [0, 300])
    expect(s(10)).toBeCloseTo(100)
    expect(s(100)).toBeCloseTo(200)
    expect(s.invert(200)).toBeCloseTo(100)
  })
  it('no positivos son NaN', () => {
    expect(logScale([1, 10], [0, 1])(0)).toBeNaN()
    expect(logScale([1, 10], [0, 1])(-2)).toBeNaN()
  })
  it('marcas log', () => {
    expect(logTicks(1, 1000)).toEqual([1, 10, 100, 1000])
    expect(logTicks(100, 800)).toEqual([100, 200, 500])
    expect(logTicks(0, 10)).toEqual([])
  })
})

describe('tiempo', () => {
  it('toMs acepta YYYY-MM-DD como medianoche UTC y rechaza fechas imposibles', () => {
    expect(toMs('2026-09-19')).toBe(Date.UTC(2026, 8, 19))
    expect(toMs('2026-02-31')).toBeNull()
    expect(toMs(new Date(Date.UTC(2026, 0, 1)))).toBe(Date.UTC(2026, 0, 1))
    expect(toMs('basura')).toBeNull()
    expect(toMs(undefined)).toBeNull()
  })
  it('fmtAxisDate no mueve el día', () => {
    expect(fmtAxisDate(Date.UTC(2026, 8, 19))).toBe('19 sep 2026')
    expect(fmtAxisDate(NaN)).toBe('s/d')
  })
  it('marcas de mes en es-MX con año en el primero y en enero', () => {
    const ticks = timeTicks(Date.UTC(2025, 9, 15), Date.UTC(2026, 3, 20), 8)
    expect(ticks.map((t) => t.label)).toEqual(['nov 2025', 'dic', 'ene 2026', 'feb', 'mar', 'abr'])
  })
  it('trimestres alineados en tramos largos', () => {
    const ticks = timeTicks(Date.UTC(2024, 0, 1), Date.UTC(2026, 0, 1), 8)
    expect(ticks.map((t) => new Date(t.value).getUTCMonth() % 3)).toEqual(ticks.map(() => 0))
    expect(ticks.length).toBeLessThanOrEqual(9)
  })
  it('años en tramos de décadas', () => {
    const ticks = timeTicks(Date.UTC(2000, 0, 1), Date.UTC(2026, 0, 1), 6)
    expect(ticks.every((t) => /^\d{4}$/.test(t.label))).toBe(true)
  })
  it('días en tramos cortos', () => {
    const ticks = timeTicks(Date.UTC(2026, 8, 1), Date.UTC(2026, 8, 20), 6)
    expect(ticks[0].label).toBe('1 sep')
  })
  it('un solo instante da una marca', () => {
    expect(timeTicks(Date.UTC(2026, 8, 19), Date.UTC(2026, 8, 19))).toHaveLength(1)
  })
  it('timeScale', () => {
    const s = timeScale([0, 1000], [0, 10])
    expect(s(500)).toBe(5)
    expect(s.type).toBe('time')
  })
})

describe('valueFormatter', () => {
  it('porcentaje con signo menos U+2212 y decimales del paso', () => {
    const f = valueFormatter('pct', { step: 0.05 })
    expect(f(-0.1)).toBe('−10%')
    expect(f(0)).toBe('0%')
    expect(valueFormatter('pct', { step: 0.005 })(0.015)).toBe('1.5%')
  })
  it('dinero compacto en pasos grandes', () => {
    expect(valueFormatter('money', { step: 50000 })(150000)).toMatch(/^\$150(\.0)? mil MXN$/)
    expect(valueFormatter('money', { step: 5 })(-15)).toBe('−$15 MXN')
  })
  it('faltante es s/d', () => {
    expect(valueFormatter('number')(null)).toBe('s/d')
    expect(valueFormatter('pct')(undefined)).toBe('s/d')
  })
  it('puntos porcentuales y base', () => {
    expect(valueFormatter('pp', { decimals: 1 })(0.012)).toBe('+1.2 pp')
    expect(valueFormatter('bp')(-25)).toBe('−25 pb')
  })
})

describe('utilidades', () => {
  it('extent ignora faltantes', () => {
    expect(extent([3, null, -1, NaN, 7])).toEqual([-1, 7])
    expect(extent([null])).toBeNull()
  })
  it('nearestIndex', () => {
    expect(nearestIndex([0, 10, 20], 14)).toBe(1)
    expect(nearestIndex([0, 10, 20], 16)).toBe(2)
    expect(nearestIndex([], 3)).toBe(-1)
  })
})

describe('placeLabels', () => {
  it('evita encimar y omite las opcionales sin lugar', () => {
    const b = { x0: 0, x1: 200, y0: 0, y1: 100 }
    const out = placeLabels([{ x: 50, y: 50, text: 'Mínima varianza' }, { x: 52, y: 50, text: 'CETES', optional: true }], b)
    expect(out[0].anchor).toBe('start')
    expect(out[1].hidden || out[1].anchor !== 'start').toBe(true)
  })
  it('ancla al borde y omite marcas de x que chocan', () => {
    const t = placeXTicks([{ value: 0, label: 'ene 2026' }, { value: 1, label: 'feb' }, { value: 100, label: 'dic' }], (v) => v * 3, 0, 300)
    expect(t[0].anchor).toBe('start')
    expect(t.map((x) => x.label)).toEqual(['ene 2026', 'dic'])
  })
  it('recorta con puntos suspensivos', () => {
    expect(fitText('GFNORTE', 30)).toBe('GFN…')
    expect(fitText('AMX', 30)).toBe('AMX')
  })
})
