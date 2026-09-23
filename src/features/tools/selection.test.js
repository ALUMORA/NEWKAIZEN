import { addSymbol, equalPercents, parseSymbols } from './selection.js'

describe('selección de emisoras', () => {
  it('limpia, pasa a mayúsculas y quita repetidos e inválidos', () => {
    expect(parseSymbols('walmex.mx, aapl,,AAPL  msft <x>')).toEqual(['WALMEX.MX', 'AAPL', 'MSFT'])
    expect(parseSymbols(null)).toEqual([])
  })

  it('agregar respeta repetidos, claves inválidas y el tope', () => {
    expect(addSymbol(['A'], ' b ', 3)).toEqual({ list: ['A', 'B'], error: null })
    expect(addSymbol(['A'], 'a', 3).error).toMatch(/ya está/)
    expect(addSymbol(['A'], 'no válida', 3).error).toMatch(/clave válida/)
    expect(addSymbol(['A', 'B'], 'C', 2).error).toMatch(/hasta 2/)
  })

  it('pesos parejos que suman 100', () => {
    const p = equalPercents(['A', 'B', 'C'])
    expect(p).toEqual({ A: 33.34, B: 33.33, C: 33.33 })
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10)
    expect(equalPercents([])).toEqual({})
  })
})
