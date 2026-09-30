import { addSymbols, removeSymbolAt, resolveEnter } from './symbol-picker.js'

const msft = { id: 'sym-MSFT', label: 'MSFT', symbol: 'MSFT' }
const base = { activeOption: null, searching: false, available: true, results: [], current: ['WALMEX.MX'], max: 5 }

describe('buscador de claves (comparador y lista propia del screener)', () => {
  it('agrega sin repetir, en mayúsculas y con tope', () => {
    expect(addSymbols(['WALMEX.MX'], ['aapl', 'WALMEX.MX', 'msft'], 5)).toEqual({ next: ['WALMEX.MX', 'AAPL', 'MSFT'], repeated: ['WALMEX.MX'], overflow: [] })
    expect(addSymbols(['A', 'B'], ['C', 'D'], 3)).toEqual({ next: ['A', 'B', 'C'], repeated: [], overflow: ['D'] })
  })

  it('quitar una ficha dice a cuál pasa el foco: la siguiente, la anterior o el campo (-1)', () => {
    expect(removeSymbolAt(['A', 'B', 'C'], 1)).toEqual({ next: ['A', 'C'], focus: 1 })
    expect(removeSymbolAt(['A', 'C'], 1)).toEqual({ next: ['A'], focus: 0 })
    expect(removeSymbolAt(['A'], 0)).toEqual({ next: [], focus: -1 })
  })

  it('Enter con el campo vacío no lo resuelve el buscador: envía el formulario', () => {
    expect(resolveEnter({ ...base, q: '  ' })).toEqual({ handled: false, add: [], message: '' })
  })

  it('Enter con una opción activa la deja elegir al combobox', () => {
    expect(resolveEnter({ ...base, q: 'micro', activeOption: msft }).handled).toBe(false)
  })

  it('Enter con claves separadas por coma las agrega aunque haya opción activa', () => {
    expect(resolveEnter({ ...base, q: 'aapl, msft', activeOption: msft })).toEqual({ handled: true, add: ['AAPL', 'MSFT'], message: '' })
  })

  it('sin búsqueda disponible, lo escrito se toma como claves', () => {
    expect(resolveEnter({ ...base, available: false, q: 'aapl msft' })).toEqual({ handled: true, add: ['AAPL', 'MSFT'], message: '' })
  })

  it('con búsqueda, una clave tecleada se resuelve contra los resultados (WALMEX → WALMEX.MX)', () => {
    const results = [{ symbol: 'FEMSAUBD.MX' }, { symbol: 'WALMEX.MX' }]
    expect(resolveEnter({ ...base, current: [], q: 'walmex', results }).add).toEqual(['WALMEX.MX'])
  })

  it('con búsqueda, un nombre sin resultado no se vuelve clave: lo dice', () => {
    const out = resolveEnter({ ...base, q: 'wal mart' })
    expect(out.handled).toBe(true)
    expect(out.add).toEqual([])
    expect(out.message).toMatch(/No encontramos/)
  })

  it('Enter mientras la búsqueda sigue en camino no toma la clave cruda: pide buscarla primero', () => {
    // Sin esto, "walmex" tecleado rápido entraba como WALMEX sin el .MX de la BMV.
    expect(resolveEnter({ ...base, q: 'walmex', searching: true })).toEqual({ handled: true, add: [], message: '', lookup: 'walmex' })
    expect(resolveEnter({ ...base, q: 'walmart de', searching: true }).lookup).toBe('walmart de')
    // Con comas son claves: no hay nada que buscar.
    expect(resolveEnter({ ...base, q: 'aapl, msft', searching: true })).toEqual({ handled: true, add: ['AAPL', 'MSFT'], message: '' })
    // Sin búsqueda disponible tampoco.
    expect(resolveEnter({ ...base, available: false, q: 'walmex', searching: true })).toEqual({ handled: true, add: ['WALMEX'], message: '' })
  })

  it('texto que no es clave, sin búsqueda: lo dice en vez de agregar basura', () => {
    const out = resolveEnter({ ...base, available: false, q: '¿?' })
    expect(out).toEqual({ handled: true, add: [], message: expect.stringMatching(/claves/) })
  })
})
