import { describe, expect, it } from 'vitest'
import { groupExclusions, parseUniverse, sharedValues, withPositions } from './magicFormula.js'

describe('parseUniverse', () => {
  it('acepta mx y us, sin importar mayúsculas', () => {
    expect(parseUniverse('us')).toBe('us')
    expect(parseUniverse(' MX ')).toBe('mx')
  })
  it('lo demás cae en México', () => {
    expect(parseUniverse(null)).toBe('mx')
    expect(parseUniverse('custom')).toBe('mx')
  })
})

describe('sharedValues', () => {
  // Suma de lugares del universo mx grabado el 22 sep 2026: tres emisoras empatan en 14.
  const rows = [
    { symbol: 'LIVEPOLC-1.MX', rank: 12, rankEY: 2 },
    { symbol: 'AC.MX', rank: 13, rankEY: 7 },
    { symbol: 'ALSEA.MX', rank: 14, rankEY: 5 },
    { symbol: 'OMAB.MX', rank: 14, rankEY: 11 },
    { symbol: 'GAPB.MX', rank: 14, rankEY: 13 },
    { symbol: 'X', rank: null, rankEY: 13 },
  ]
  it('marca los valores que comparten dos o más emisoras', () => {
    expect([...sharedValues(rows, 'rank')]).toEqual([14])
    expect([...sharedValues(rows, 'rankEY')]).toEqual([13])
  })
  it('sin repetidos no hay empates', () => {
    expect(sharedValues(rows.slice(0, 3), 'rank').size).toBe(0)
  })
})

describe('withPositions', () => {
  it('numera en el orden del API', () => {
    expect(withPositions([{ symbol: 'A' }, { symbol: 'B' }])).toEqual([
      { symbol: 'A', position: 1 },
      { symbol: 'B', position: 2 },
    ])
  })
})

describe('groupExclusions', () => {
  it('agrupa por motivo, del más frecuente al menos frecuente', () => {
    const excluded = [
      { symbol: 'GRUMAB.MX', reason: 'Reporta en USD y cotiza en MXN: falta el tipo de cambio para no mezclar monedas.' },
      { symbol: 'GFNORTEO.MX', reason: 'La fórmula deja fuera el sector Servicios financieros.' },
      { symbol: 'Q.MX', reason: 'La fórmula deja fuera el sector Servicios financieros.' },
      { symbol: 'TV.MX', reason: '' },
    ]
    expect(groupExclusions(excluded)).toEqual([
      { reason: 'La fórmula deja fuera el sector Servicios financieros.', symbols: ['GFNORTEO.MX', 'Q.MX'] },
      { reason: 'Reporta en USD y cotiza en MXN: falta el tipo de cambio para no mezclar monedas.', symbols: ['GRUMAB.MX'] },
      { reason: 'Sin motivo escrito por el servidor.', symbols: ['TV.MX'] },
    ])
    expect(groupExclusions(null)).toEqual([])
  })
})
