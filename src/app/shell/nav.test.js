import { BOTTOM_NAV, NAV_EXTRA, NAV_SECTIONS, activeBottomId, activeNavItem, flatNav } from '../nav.js'
import { PATHS } from '../paths.js'

const KNOWN = new Set(Object.values(PATHS))

describe('nav', () => {
  it('sigue el árbol del brief: cuatro secciones y dos sueltas', () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(['Mercados', 'Mi portafolio', 'Investigar', 'Herramientas'])
    expect(NAV_SECTIONS.map((s) => s.items.map((i) => i.label))).toEqual([
      ['Panorama', 'México y tasas', 'CETES', 'Noticias'],
      ['Resumen', 'Movimientos', 'Rendimiento', 'Riesgo', 'Rebalanceo'],
      ['Buscar emisora', 'Comparar', 'Screener de factores', 'Fórmula mágica', 'FIBRAs'],
      ['Optimizador', 'Backtest', 'Simulador y metas'],
    ])
    expect(NAV_EXTRA.map((i) => i.label)).toEqual(['Watchlist', 'Aprender'])
  })

  it('toda ruta sale de PATHS y ninguna se repite', () => {
    const all = flatNav()
    for (const item of [...all, ...BOTTOM_NAV]) expect(KNOWN.has(item.to), item.to).toBe(true)
    expect(new Set(all.map((i) => i.to)).size).toBe(all.length)
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length)
  })

  it('las rutas del brief caen donde dice', () => {
    const by = Object.fromEntries(flatNav().map((i) => [i.label, i.to]))
    expect(by.Panorama).toBe('/mercados')
    expect(by['México y tasas']).toBe('/mercados/mexico')
    expect(by.CETES).toBe('/mercados/cetes')
    expect(by.Noticias).toBe('/mercados/noticias')
    expect(by.Resumen).toBe('/portafolio')
    expect(by['Buscar emisora']).toBe('/investigar')
    expect(by['Screener de factores']).toBe('/screener')
  })

  it('barra inferior: cuatro destinos', () => {
    expect(BOTTOM_NAV.map((i) => i.label)).toEqual(['Mercados', 'Portafolio', 'Investigar', 'Herramientas'])
  })

  it('activeNavItem: exacta primero, luego el prefijo más largo', () => {
    expect(activeNavItem('/mercados')?.id).toBe('panorama')
    expect(activeNavItem('/mercados/cetes/')?.id).toBe('cetes')
    expect(activeNavItem('/investigar/WALMEX.MX')?.id).toBe('buscar')
    expect(activeNavItem('/investigar/comparar')?.id).toBe('comparar')
    expect(activeNavItem('/screener/fibras')?.id).toBe('fibras')
    expect(activeNavItem('/herramientas')).toBeNull()
    expect(activeNavItem('/nada')).toBeNull()
  })

  it('activeBottomId agrupa por sección', () => {
    expect(activeBottomId('/mercados/noticias')).toBe('mercados')
    expect(activeBottomId('/portafolio/riesgo')).toBe('portafolio')
    expect(activeBottomId('/screener/formula-magica')).toBe('investigar')
    expect(activeBottomId('/investigar/AAPL')).toBe('investigar')
    expect(activeBottomId('/herramientas/backtest')).toBe('herramientas')
    expect(activeBottomId('/watchlist')).toBe('mas')
    expect(activeBottomId('/bienvenida')).toBeNull()
  })
})
