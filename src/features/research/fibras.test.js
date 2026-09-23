import { describe, expect, it } from 'vitest'
import { MAX_EXTRA, describeRate, parseExtra, rateSource, splitRateNotes, spreadBars } from './fibras.js'

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
