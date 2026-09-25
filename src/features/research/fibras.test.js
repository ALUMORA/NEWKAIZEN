import { describe, expect, it } from 'vitest'
import { MAX_EXTRA, describeRate, missingFields, parseExtra, rateDate, rateSource, referenceRate, splitRateNotes, spreadBars } from './fibras.js'

describe('parseExtra', () => {
  it('normaliza y corta en el máximo que acepta el API', () => {
    expect(parseExtra('fibrahd15, EDUCA18,,fibrahd15')).toEqual(['FIBRAHD15', 'EDUCA18'])
    const many = Array.from({ length: 30 }, (_, i) => `F${i}`).join(',')
    expect(parseExtra(many)).toHaveLength(MAX_EXTRA)
    expect(parseExtra(null)).toEqual([])
  })
})

describe('rateSource y describeRate', () => {
  it('lee la fuente de la tasa en meta.source', () => {
    expect(rateSource('yahoo,computed,fred')).toBe('fred')
    expect(rateSource('yahoo,computed,banxico')).toBe('banxico')
    expect(rateSource('yahoo,computed')).toBe(null)
  })
  it('con FRED es una tasa sustituta, nunca "CETES 28 días"', () => {
    const r = describeRate({ source: 'yahoo,computed,fred', fallback: true }, 0.0679)
    expect(r).toMatchObject({ substitute: true, missing: false, source: 'fred', label: 'Tasa sustituta de corto plazo' })
    expect(r.against).toMatch(/no son CETES de 28 días/)
  })
  it('Banxico sin respaldo sí son CETES 28 días; marcada como respaldo, no', () => {
    expect(describeRate({ source: 'yahoo,computed,banxico', fallback: false }, 0.0725)).toMatchObject({ substitute: false, label: 'CETES 28 días' })
    expect(describeRate({ source: 'yahoo,computed,banxico', fallback: true }, 0.0725).substitute).toBe(true)
  })
  it('sin tasa no hay diferencial ni etiqueta de CETES', () => {
    expect(describeRate({ source: 'yahoo,computed', fallback: false }, null)).toMatchObject({ missing: true, substitute: false, label: 'Tasa de referencia' })
  })
})

describe('splitRateNotes', () => {
  it('separa las notas de la tasa sustituta del resto', () => {
    const substitute = 'El campo cetes28 y el diferencial usan una tasa sustituta, no CETES de 28 días.'
    const token = 'Falta el token de Banxico (BANXICO_TOKEN) para servir CETES del SIE.'
    const fallback = 'Respaldo: serie interbancaria de México a 3 meses de la OCDE en FRED, mensual.'
    const nav = 'El NAV por CBFI es el valor en libros que reporta la FIBRA, no un avalúo independiente.'
    expect(splitRateNotes([nav, substitute, token, fallback])).toEqual({ rate: [substitute, token, fallback], rest: [nav] })
  })
})

describe('spreadBars', () => {
  it('ordena de mayor a menor y deja las s/d al final', () => {
    const rows = [
      { symbol: 'FSHOP13.MX', spreadVsCetes: -0.0045 },
      { symbol: 'FIBRAPL14.MX', spreadVsCetes: null },
      { symbol: 'FUNO11.MX', spreadVsCetes: 0.0181 },
    ]
    expect(spreadBars(rows)).toEqual([
      { label: 'FUNO11.MX', value: 0.0181 },
      { label: 'FSHOP13.MX', value: -0.0045 },
      { label: 'FIBRAPL14.MX', value: null },
    ])
  })
})

describe('missingFields', () => {
  it('nombra las métricas en s/d en el orden de la tabla', () => {
    // FMTY14.MX del 22 sep 2026: estados del fiduciario descartados.
    const row = { price: 13.2, pNav: 1.059, distributionYield: 0.0704, spreadVsCetes: 0.0025, ltv: null, debtToMarketCap: null, capRate: null, cashFlowYield: null }
    expect(missingFields(row)).toEqual(['LTV', 'deuda entre capitalización', 'cap rate', 'rendimiento de flujo'])
    expect(missingFields({ ...row, ltv: 0.3, debtToMarketCap: 0.5, capRate: 0.07, cashFlowYield: 0.09 })).toEqual([])
  })
})

describe('rateDate', () => {
  it('saca la fecha de la tasa de las notas, no la de los precios', () => {
    const notes = [
      'El campo cetes28 y el diferencial usan una tasa sustituta, no CETES de 28 días: la tasa interbancaria de México a 91 días de la OCDE en FRED, promedio mensual, dato del 2026-08-01.',
      'Los precios son del 2026-09-22; la tasa de referencia, del 2026-08-01; los estados financieros cierran a más tardar el 2025-12-31.',
    ]
    expect(rateDate(notes)).toBe('2026-08-01')
    expect(rateDate([notes[1]])).toBe('2026-08-01')
    expect(rateDate(['Su último cierre anual es del 2023-12-31.'])).toBe(null)
    expect(rateDate(null)).toBe(null)
  })
})

describe('splitRateNotes con las notas que escribe hoy el backend', () => {
  // kaizen_api/domain/rates.py (get_rf_series) y kaizen_api/domain/screeners/fibras.py (NO_RATE).
  const RATE_NOTES = [
    'La serie SF43936 todavía no tiene revisión humana (verified: false en el catálogo), así que no se usó.',
    'Banxico no respondió (UPSTREAM_UNAVAILABLE).',
    'Banxico no tiene datos de CETES en ese rango de fechas.',
    'El SIE no confirmó la serie SF43936, así que no se usó: el título no trae "28".',
    'Todavía no hay tasa de CETES 28 en este servidor, así que el diferencial va en s/d.',
  ]
  it('cada nota de la tasa cae en la tarjeta de la tasa', () => {
    const { rate, rest } = splitRateNotes([...RATE_NOTES, 'FUNO11.MX no trae precio en esta corrida.'])
    expect(rate).toEqual(RATE_NOTES)
    expect(rest).toEqual(['FUNO11.MX no trae precio en esta corrida.'])
  })
})

describe('referenceRate', () => {
  it('con `rate` (fase 3) toma valor, fecha, fuente, respaldo y plazo del objeto, no de las notas', () => {
    const data = {
      cetes28: 0.0712,
      rate: { value: 0.0712, asOf: '2026-09-18', source: 'fred', fallback: true, tenorDays: 91 },
      // meta dice otra cosa a propósito: manda `rate`.
      meta: { source: 'yahoo,computed,banxico', fallback: false, notes: ['Tasa: la tasa de referencia, del 2026-08-01.'] },
    }
    expect(referenceRate(data)).toEqual({ value: 0.0712, asOf: '2026-09-18', source: 'fred', fallback: true, tenorDays: 91, fromNotes: false })
    expect(describeRate({ source: 'fred', fallback: true }, 0.0712)).toMatchObject({ substitute: true, label: 'Tasa sustituta de corto plazo' })
  })

  it('con `rate: null` no hay tasa, aunque meta traiga una fecha', () => {
    expect(referenceRate({ cetes28: null, rate: null, meta: { source: 'banxico', notes: ['la tasa de referencia, del 2026-08-01'] } })).toMatchObject({ value: null, asOf: null, source: null, fromNotes: false })
  })

  it('un API anterior sin `rate`: respaldo a cetes28, meta.source y la fecha de la nota', () => {
    const data = { cetes28: 0.0725, meta: { source: 'yahoo,computed,banxico', fallback: false, notes: ['Diferencial contra la tasa de referencia, del 2026-09-18.'] } }
    expect(referenceRate(data)).toEqual({ value: 0.0725, asOf: '2026-09-18', source: 'banxico', fallback: false, tenorDays: null, fromNotes: true })
  })
})
