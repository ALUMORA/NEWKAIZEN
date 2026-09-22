import { LEGACY_TABS, LEGACY_TAB_PATHS, legacyPathForTab, legacyTabForPath } from './legacyTabs.js'
import { PATHS } from './paths.js'

describe('legacyTabs: mapeo único ruta ↔ tab del legado', () => {
  it('las 8 tabs del Workspace legado, cada una con una ruta distinta de PATHS', () => {
    expect([...LEGACY_TABS].sort()).toEqual(['analisis', 'analytics', 'fibras', 'magic', 'news', 'optimize', 'portfolio', 'screener'])
    const paths = Object.values(LEGACY_TAB_PATHS)
    expect(new Set(paths).size).toBe(paths.length)
    for (const path of paths) expect(Object.values(PATHS)).toContain(path)
  })

  it('el mapeo del spec: mercados→news, portafolio→portfolio, backtest→analytics, optimizador→optimize…', () => {
    expect(LEGACY_TAB_PATHS).toEqual({
      news: '/mercados',
      portfolio: '/portafolio',
      analytics: '/herramientas/backtest',
      optimize: '/herramientas/optimizador',
      screener: '/screener',
      analisis: '/investigar',
      fibras: '/screener/fibras',
      magic: '/screener/formula-magica',
    })
  })

  it('legacyTabForPath es la inversa de legacyPathForTab', () => {
    for (const tab of LEGACY_TABS) expect(legacyTabForPath(/** @type {string} */ (legacyPathForTab(tab)))).toBe(tab)
    expect(legacyTabForPath('herramientas/optimizador')).toBe('optimize')
    expect(legacyTabForPath('/screener/')).toBe('screener')
  })

  it('rutas y tabs que no existen dan null', () => {
    expect(legacyPathForTab('no-existe')).toBeNull()
    expect(legacyPathForTab('toString')).toBeNull()
    expect(legacyPathForTab(undefined)).toBeNull()
    expect(legacyTabForPath('/portafolio/riesgo')).toBeNull()
    expect(legacyTabForPath('/')).toBeNull()
  })
})
