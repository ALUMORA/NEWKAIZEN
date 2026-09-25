import { describe, expect, it } from 'vitest'
import { parseSymbols, safeUrl } from './symbols.js'

describe('parseSymbols', () => {
  it('normaliza, quita repetidos y vacíos', () => {
    expect(parseSymbols('aapl, msft,,walmex.mx AAPL')).toEqual(['AAPL', 'MSFT', 'WALMEX.MX'])
  })
  it('descarta claves inválidas y tolera null', () => {
    expect(parseSymbols('AAPL, <x>, ^MXX')).toEqual(['AAPL', '^MXX'])
    expect(parseSymbols(null)).toEqual([])
  })
})

describe('safeUrl', () => {
  it('deja pasar http y https', () => {
    expect(safeUrl('https://example.com/n1')).toBe('https://example.com/n1')
  })
  it('una liga javascript: o sin URL no se vuelve enlace', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('')).toBeNull()
    expect(safeUrl(undefined)).toBeNull()
  })
})
