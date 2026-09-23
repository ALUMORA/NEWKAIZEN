import { flatNav } from '../nav.js'
import { buildGroups, fold, isTickerLike, matchSymbol, pushRecent, readRecents } from './palette-model.js'

const routes = flatNav()
const walmex = { symbol: 'WALMEX.MX', name: 'Wal-Mart de México', exchange: 'BMV' }

describe('palette-model', () => {
  it('fold quita acentos y mayúsculas', () => {
    expect(fold('  México ')).toBe('mexico')
  })

  it('isTickerLike', () => {
    expect(isTickerLike('WALMEX')).toBe(true)
    expect(isTickerLike('^MXX')).toBe(true)
    expect(isTickerLike('wal mart')).toBe(false)
    expect(isTickerLike('')).toBe(false)
  })

  it('matchSymbol: exacto, luego el de la BMV', () => {
    expect(matchSymbol('WALMEX', [walmex])).toBe('WALMEX.MX')
    expect(matchSymbol('walmex.mx', [walmex])).toBe('WALMEX.MX')
    expect(matchSymbol('AAPL', [{ symbol: 'AAPL' }, { symbol: 'AAPL.MX' }])).toBe('AAPL')
    expect(matchSymbol('FEMSA', [walmex])).toBeNull()
  })

  it('sin texto: recientes, todas las rutas y las acciones', () => {
    const groups = buildGroups({ q: '', recents: [{ symbol: 'AMXB.MX', name: 'América Móvil' }], routes, dark: false })
    expect(groups.map((g) => g.label)).toEqual(['Emisoras', 'Ir a', 'Acciones'])
    expect(groups[0].options[0]).toMatchObject({ label: 'AMXB.MX', to: '/investigar/AMXB.MX', detail: 'América Móvil · Reciente' })
    expect(groups[1].options).toHaveLength(routes.length)
    expect(groups[2].options.map((o) => o.label)).toEqual(['Cambiar a tema oscuro', 'Cerrar sesión'])
  })

  it('con texto filtra rutas sin acentos y pone primero las emisoras', () => {
    const groups = buildGroups({ q: 'mexico', results: [walmex], routes, dark: true })
    expect(groups[0].options[0]).toMatchObject({ kind: 'symbol', to: '/investigar/WALMEX.MX' })
    expect(groups[1].options.map((o) => o.label)).toEqual(['México y tasas'])
    expect(groups.find((g) => g.id === 'acciones')).toBeUndefined()
  })

  it('tema: el texto de la acción sigue al tema actual', () => {
    const groups = buildGroups({ q: 'tema', routes, dark: true })
    expect(groups.at(-1)?.options[0].label).toBe('Cambiar a tema claro')
  })

  it('recientes: sin repetir y con tope de cinco', () => {
    localStorage.clear()
    for (const s of ['A', 'B', 'C', 'D', 'E', 'F', 'B']) pushRecent({ symbol: s })
    expect(readRecents().map((r) => r.symbol)).toEqual(['B', 'F', 'E', 'D', 'C'])
  })
})
