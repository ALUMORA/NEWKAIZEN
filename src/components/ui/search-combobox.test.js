import { SEARCH_DEBOUNCE_MS, comboboxStatus, defaultGroups, moveActive, resultOptions, symbolOptionId } from './search-combobox.js'

const RESULTS = [
  { symbol: 'WALMEX.MX', name: 'Wal-Mart de México', exchange: 'BMV', type: 'equity', currency: 'MXN', aliases: [] },
  { symbol: 'WMT', name: 'Walmart Inc.', exchange: 'NYSE', type: 'equity', currency: 'USD', aliases: [] },
  { symbol: 'walmex.mx', name: 'Repetida en minúsculas', exchange: 'BMV' },
]

describe('search-combobox: lógica pura', () => {
  it('espera 200 ms antes de buscar', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(200)
  })

  it('id estable por emisora, igual al de la paleta', () => {
    expect(symbolOptionId('WALMEX.MX')).toBe('sym-WALMEX_MX')
    expect(symbolOptionId('^mxx')).toBe('sym-_x5eMXX')
    expect(symbolOptionId('BRK.B')).not.toBe(symbolOptionId('BRK-B'))
    expect(symbolOptionId('A.X20')).not.toBe(symbolOptionId('A 20'))
  })

  it('arma opciones sin repetidos, con nombre y bolsa como detalle', () => {
    const opts = resultOptions(RESULTS)
    expect(opts.map((o) => o.label)).toEqual(['WALMEX.MX', 'WMT'])
    expect(opts[0]).toMatchObject({ id: 'sym-WALMEX_MX', detail: 'Wal-Mart de México · BMV', symbol: 'WALMEX.MX' })
    expect(opts[0].result).toBe(RESULTS[0])
  })

  it('exclude quita las que ya se eligieron, sin importar mayúsculas', () => {
    expect(resultOptions(RESULTS, { exclude: ['walmex.mx'] }).map((o) => o.symbol)).toEqual(['WMT'])
  })

  it('ignora resultados sin símbolo y deja el detalle vacío si no hay datos', () => {
    // basura del API a propósito
    expect(resultOptions([null, { symbol: '' }, { symbol: 'AAPL' }])).toEqual([{ id: 'sym-AAPL', label: 'AAPL', detail: undefined, symbol: 'AAPL', result: { symbol: 'AAPL' } }])
    expect(resultOptions(undefined)).toEqual([])
  })

  it('un solo grupo "Emisoras", o ninguno', () => {
    expect(defaultGroups(RESULTS)).toMatchObject([{ id: 'emisoras', label: 'Emisoras' }])
    expect(defaultGroups([])).toEqual([])
  })

  it('las flechas dan la vuelta; sin activa, abajo es la primera y arriba la última', () => {
    expect(moveActive(0, 'ArrowDown', 3)).toBe(1)
    expect(moveActive(2, 'ArrowDown', 3)).toBe(0)
    expect(moveActive(0, 'ArrowUp', 3)).toBe(2)
    expect(moveActive(-1, 'ArrowDown', 3)).toBe(0)
    expect(moveActive(-1, 'ArrowUp', 3)).toBe(2)
    expect(moveActive(1, 'Home', 3)).toBe(0)
    expect(moveActive(1, 'End', 3)).toBe(2)
    expect(moveActive(0, 'ArrowDown', 0)).toBe(-1)
  })

  it('el estado dice buscando, error, no disponible, vacío o cuántos', () => {
    const base = { q: 'wal', searching: false, error: false, available: true, total: 0 }
    expect(comboboxStatus({ ...base, searching: true })).toBe('Buscando emisoras…')
    expect(comboboxStatus({ ...base, error: true })).toBe('No se pudo buscar ahora. Intenta de nuevo en un momento.')
    expect(comboboxStatus({ ...base, available: false })).toBe('La búsqueda de emisoras no está disponible por ahora.')
    expect(comboboxStatus({ ...base, available: false, connecting: true })).toBe('Conectando con el servidor…')
    expect(comboboxStatus(base)).toBe('Sin resultados')
    expect(comboboxStatus({ ...base, total: 1 })).toBe('1 resultado')
    expect(comboboxStatus({ ...base, total: 2, error: true })).toBe('2 resultados')
    expect(comboboxStatus({ ...base, q: '', available: false })).toBe('Sin resultados')
  })
})
