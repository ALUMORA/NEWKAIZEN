import { describe, expect, it } from 'vitest'
import { parseSymbols } from './symbols.js'

describe('parseSymbols', () => {
  it('normaliza, quita repetidos y vacíos', () => {
    expect(parseSymbols('aapl, msft,,walmex.mx AAPL')).toEqual(['AAPL', 'MSFT', 'WALMEX.MX'])
  })
  it('descarta claves inválidas y tolera null', () => {
    expect(parseSymbols('AAPL, <x>, ^MXX')).toEqual(['AAPL', '^MXX'])
    expect(parseSymbols(null)).toEqual([])
  })
})
