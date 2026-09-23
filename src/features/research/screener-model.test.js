import { describe, expect, it } from 'vitest'
import {
  checkDefs,
  checkValueText,
  checksOf,
  checksText,
  coverageOf,
  filterBySector,
  fmtMetric,
  fmtZ,
  groupReasons,
  readParams,
  reasonTag,
  sectorsOf,
  shortName,
  thresholdText,
  writeParams,
} from './screener-model.js'

const metrics = (n) => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`m${i}`, i < n ? 0.1 : null]))

describe('screener-model', () => {
  it('shortName quita la razón social', () => {
    expect(shortName('Wal-Mart de México, S.A.B. de C.V.')).toBe('Wal-Mart de México')
    expect(shortName('Grupo Televisa, S.A.B.')).toBe('Grupo Televisa')
    expect(shortName('Banco del Bajío, S.A.')).toBe('Banco del Bajío')
    expect(shortName('Apple Inc.')).toBe('Apple Inc.')
    expect(shortName(null)).toBe('')
  })

  it('fmtZ con signo menos U+2212 y s/d', () => {
    expect(fmtZ(1.349)).toBe('+1.35')
    expect(fmtZ(-0.42)).toBe('−0.42')
    expect(fmtZ(null)).toBe('s/d')
  })

  it('fmtMetric: fracciones como porcentaje, deuda entre capital como razón', () => {
    expect(fmtMetric('earningsYield', 0.0612)).toBe('6.1%')
    expect(fmtMetric('momentum12m1', -0.084)).toBe('−8.4%')
    expect(fmtMetric('debtToEquity', 0.55)).toBe('0.55')
    expect(fmtMetric('volatility', null)).toBe('s/d')
  })

  it('coverageOf usa la cobertura del servidor sobre el total de métricas', () => {
    expect(coverageOf({ coverage: 0.8333, metrics: metrics(10) })).toEqual({ have: 10, total: 12 })
    expect(coverageOf({ coverage: null, metrics: metrics(7) })).toEqual({ have: 7, total: 12 })
    expect(coverageOf({ coverage: 0.5 })).toEqual({ have: 6, total: 12 })
  })

  it('checksOf y checksText cuentan cumple, no cumple y s/d', () => {
    const row = { checks: [{ pass: true }, { pass: false }, { pass: null }, { pass: true }] }
    expect(checksOf(row)).toEqual({ pass: 2, fail: 1, missing: 1, total: 4 })
    expect(checksText(row)).toBe('2 de 4 (1 s/d)')
    expect(checksText({ checks: [{ pass: true }] })).toBe('1 de 1')
    expect(checksText({ checks: [] })).toBe('s/d')
  })

  it('umbral y valor de una prueba con el formato de su métrica', () => {
    expect(thresholdText({ id: 'valor', threshold: 0.06 })).toBe('6.0%')
    expect(thresholdText({ id: 'deuda', threshold: 1 })).toBe('1.00')
    expect(thresholdText({ id: 'otra', threshold: 3 })).toBe('3.00')
    expect(checkValueText({ id: 'calidad', value: 0.271 })).toBe('27.1%')
    expect(checkValueText({ id: 'momento', value: null })).toBe('s/d')
  })

  it('checkDefs junta las pruebas una vez, en orden', () => {
    const a = { id: 'valor', label: 'A' }
    const b = { id: 'deuda', label: 'B' }
    expect(checkDefs([{ checks: [a] }, { checks: [a, b] }, {}])).toEqual([a, b])
  })

  it('reasonTag y groupReasons', () => {
    const small = 'Su sector tiene menos de 5 emisoras en este universo: se compara contra todo el universo.'
    const fx = 'Reporta en USD y cotiza en MXN: las métricas de valor quedan en s/d hasta tener el tipo de cambio.'
    expect(reasonTag(small)).toBe('Contra todo el universo')
    expect(reasonTag(fx)).toBe('Valor en s/d por moneda')
    expect(reasonTag('Otra cosa.')).toBe('Con nota')
    expect(reasonTag(null)).toBeNull()
    expect(groupReasons([{ symbol: 'A', reason: small }, { symbol: 'B', reason: null }, { symbol: 'C', reason: small }, { symbol: 'D', reason: fx }])).toEqual([
      { reason: small, symbols: ['A', 'C'] },
      { reason: fx, symbols: ['D'] },
    ])
  })

  it('sectorsOf ordena en español y filterBySector filtra', () => {
    const rows = [{ sector: 'Materiales' }, { sector: null }, { sector: 'Consumo básico' }, { sector: 'Materiales' }]
    expect(sectorsOf(rows)).toEqual(['Consumo básico', 'Materiales', 'Sin sector'])
    expect(filterBySector(rows, 'Materiales')).toHaveLength(2)
    expect(filterBySector(rows, 'Sin sector')).toHaveLength(1)
    expect(filterBySector(rows, '')).toHaveLength(4)
  })

  it('readParams y writeParams van y vuelven por la URL', () => {
    expect(readParams(new URLSearchParams(''))).toEqual({ universe: 'mx', symbols: [], sector: '' })
    expect(readParams(new URLSearchParams('universo=propia&symbols=aapl,msft,,x y'))).toEqual({ universe: 'custom', symbols: ['AAPL', 'MSFT', 'X', 'Y'], sector: '' })
    expect(readParams(new URLSearchParams('universo=us&symbols=AAPL&sector=Tecnolog%C3%ADa'))).toEqual({ universe: 'us', symbols: [], sector: 'Tecnología' })
    expect(writeParams({ universe: 'mx' })).toEqual({})
    expect(writeParams({ universe: 'custom', symbols: ['AAPL', 'MSFT'], sector: 'Tecnología' })).toEqual({ universo: 'propia', symbols: 'AAPL,MSFT', sector: 'Tecnología' })
    expect(writeParams({ universe: 'us', symbols: ['AAPL'] })).toEqual({ universo: 'us' })
  })
})
