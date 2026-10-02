import { describe, expect, it } from 'vitest'
import { curvePoints, forwardLabel, hasMixedDates, moneyMarketRows, readParams, surveyValue, tenorLabel, tenorTick, writeParams } from './model.js'

describe('parámetros de la URL', () => {
  it('lee país y pestaña y cae en México y Curvas', () => {
    expect(readParams(new URLSearchParams('pais=us&pestana=dinero'))).toEqual({ country: 'us', tab: 'dinero' })
    expect(readParams(new URLSearchParams('pais=br&pestana=x'))).toEqual({ country: 'mx', tab: 'curvas' })
  })
  it('no escribe los valores por omisión', () => {
    expect(writeParams(new URLSearchParams('pais=us'), { country: 'mx' }).toString()).toBe('')
    expect(writeParams(new URLSearchParams(''), { tab: 'expectativas' }).toString()).toBe('pestana=expectativas')
  })
})

describe('curva', () => {
  it('marca del eje en días hasta un año y en años después', () => {
    expect(tenorTick(28 / 365)).toBe('28 d')
    expect(tenorTick(10)).toBe('10 a')
  })
  it('nodos con fechas distintas quedan aislados', () => {
    const nodes = [
      { tenorDays: 3650, value: 0.09, asOf: '2026-08-20' },
      { tenorDays: 28, value: 0.07, asOf: '2026-09-17' },
    ]
    expect(hasMixedDates(nodes)).toBe(true)
    const pts = curvePoints(nodes, { isolated: true })
    expect(pts.map((p) => p.value)).toEqual([0.07, null, 0.09])
    expect(pts[0].x).toBeCloseTo(28 / 365)
    expect(curvePoints(nodes).map((p) => p.value)).toEqual([0.07, 0.09])
  })
  it('etiquetas de plazos y tramos', () => {
    expect(tenorLabel(28)).toBe('28 días')
    expect(tenorLabel(365)).toBe('1 año')
    expect(tenorLabel(3650)).toBe('10 años')
    expect(forwardLabel(0, 28)).toBe('De hoy a 28 días')
    expect(forwardLabel(28, 91)).toBe('De 28 a 91 días')
  })
})

describe('mercado de dinero', () => {
  it('une /v2/rates/mx y /v2/money-market por id sin repetir valores', () => {
    const ratesMx = {
      items: [
        { id: 'target', label: 'Tasa objetivo', value: 0.0725, unit: 'fraction', asOf: '2026-09-18', seriesId: 'SF61745', changeBp: -25 },
        { id: 'udi', label: 'UDI', value: 8.4, unit: 'mxn', asOf: '2026-09-18', seriesId: 'SP68257', changeBp: null },
      ],
    }
    const money = {
      rows: [
        { id: 'tiie91', label: 'TIIE a 91 días', country: 'MX', value: 0.068134, convention: 'act/360 simple', asOf: '2026-10-01', change1dBp: 1, change1wBp: -8.66, change1mBp: null, seriesId: 'SF43878', source: 'banxico', stale: false },
        { id: 'sofr', label: 'SOFR', country: 'US', value: 0.0387, convention: 'overnight', asOf: '2026-09-22', change1dBp: 2, change1wBp: 23, change1mBp: 22, seriesId: 'SOFR', source: 'fred', stale: false },
      ],
      mxChanges: [{ id: 'target', change1wBp: 0, change1mBp: -25 }],
      meta: /** @type {any} */ ({}),
    }
    const out = moneyMarketRows(ratesMx, /** @type {any} */ (money))
    expect(out.MX.map((r) => r.id)).toEqual(['target', 'tiie91'])
    expect(out.MX[0]).toMatchObject({ change1dBp: -25, change1wBp: 0, change1mBp: -25, convention: 'overnight' })
    expect(out.US.map((r) => r.id)).toEqual(['sofr'])
  })
})

describe('encuesta', () => {
  it('s/d para lo que falta, porcentaje para fracciones y pesos para el tipo de cambio', () => {
    expect(surveyValue(null, 'fraction')).toBe('s/d')
    expect(surveyValue(0.0387, 'fraction')).toBe('3.87%')
    expect(surveyValue(17.5, 'mxnPerUsd')).toBe('17.50 pesos')
  })
})
