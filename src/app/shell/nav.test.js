import { BOTTOM_NAV, NAV_EXTRA, NAV_SECTIONS, activeBottomId, activeNavItem, flatNav } from '../nav.js'
import { PATHS } from '../paths.js'

const KNOWN = new Set(Object.values(PATHS))

describe('nav', () => {
  it('sigue el árbol del brief con la fase 5: cinco secciones y tres sueltas', () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(['Mercados', 'Mi portafolio', 'Investigar', 'Herramientas', 'Empresas'])
    expect(NAV_SECTIONS.map((s) => s.items.map((i) => i.label))).toEqual([
      ['Panorama', 'Resumen del día', 'México', 'Tasas y curvas', 'Tipo de cambio', 'Economía', 'Calendario', 'Movimientos del día', 'CETES', 'Noticias'],
      ['Resumen', 'Movimientos', 'Rendimiento', 'Riesgo', 'Rebalanceo', 'Agenda', 'Rayos X'],
      ['Buscar emisora', 'Comparar', 'Screener de factores', 'Fórmula mágica', 'FIBRAs'],
      ['Optimizador', 'Backtest', 'Simulador y metas'],
      ['Actualización e INPC', 'Valores de referencia', 'Tipo de cambio contable', 'Forward y presupuesto', 'Costo de capital', 'Crédito a TIIE', 'Contrapartes'],
    ])
    expect(NAV_EXTRA.map((i) => i.label)).toEqual(['Lista de seguimiento', 'Alertas', 'Aprender'])
  })

  it('toda entrada trae ícono', () => {
    for (const s of NAV_SECTIONS) expect(s.icon, s.id).toBeTruthy()
    for (const item of flatNav()) expect(item.icon, item.id).toBeTruthy()
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
    expect(by['México']).toBe('/mercados/mexico')
    expect(by['Resumen del día']).toBe('/mercados/resumen')
    expect(by['Tasas y curvas']).toBe('/mercados/tasas')
    expect(by['Tipo de cambio']).toBe('/mercados/tipo-de-cambio')
    expect(by['Economía']).toBe('/mercados/economia')
    expect(by.Calendario).toBe('/mercados/calendario')
    expect(by['Movimientos del día']).toBe('/mercados/movimientos')
    expect(by.Agenda).toBe('/portafolio/agenda')
    expect(by['Rayos X']).toBe('/portafolio/rayos-x')
    expect(by['Actualización e INPC']).toBe('/empresas/actualizacion')
    expect(by['Valores de referencia']).toBe('/empresas/referencias')
    expect(by['Tipo de cambio contable']).toBe('/empresas/tipo-de-cambio')
    expect(by['Forward y presupuesto']).toBe('/empresas/cobertura')
    expect(by['Costo de capital']).toBe('/empresas/costo-de-capital')
    expect(by['Crédito a TIIE']).toBe('/empresas/credito')
    expect(by.Contrapartes).toBe('/empresas/contrapartes')
    expect(by.Alertas).toBe('/alertas')
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
    expect(activeNavItem('/mercados/movimientos')?.id).toBe('movimientos-dia')
    expect(activeNavItem('/empresas/contrapartes')?.id).toBe('contrapartes')
    expect(activeNavItem('/empresas')).toBeNull()
    expect(activeNavItem('/nada')).toBeNull()
  })

  it('activeBottomId agrupa por sección', () => {
    expect(activeBottomId('/mercados/noticias')).toBe('mercados')
    expect(activeBottomId('/portafolio/riesgo')).toBe('portafolio')
    expect(activeBottomId('/screener/formula-magica')).toBe('investigar')
    expect(activeBottomId('/investigar/AAPL')).toBe('investigar')
    expect(activeBottomId('/herramientas/backtest')).toBe('herramientas')
    expect(activeBottomId('/watchlist')).toBe('mas')
    expect(activeBottomId('/alertas')).toBe('mas')
    expect(activeBottomId('/empresas')).toBe('mas')
    expect(activeBottomId('/empresas/credito')).toBe('mas')
    expect(activeBottomId('/mercados/tasas')).toBe('mercados')
    expect(activeBottomId('/portafolio/rayos-x')).toBe('portafolio')
    expect(activeBottomId('/bienvenida')).toBeNull()
  })
})
