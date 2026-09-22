// Tabs del Workspace legado (src/legacy/App.legacy.jsx) y la ruta de la app nueva que monta cada
// una. Es la ÚNICA fuente de ese mapeo, en los dos sentidos:
// - ruta → tab: legacyRoute() (src/app/legacyRoute.jsx) elige con él la tab que abre cada ruta de
//   las features que todavía monta el legado.
// - tab → ruta: LegacyPage lleva la URL (y el título) cuando la persona cambia de tab dentro del
//   legado, con push para que Atrás regrese.
// Cuando una feature reemplaza una ruta, el mapeo se queda: así la barra lateral del legado lleva
// a la página nueva. Se borra con src/legacy (M3).
import { PATHS } from './paths.js'

export const LEGACY_TAB_PATHS = Object.freeze({
  news: PATHS.markets,
  portfolio: PATHS.portfolio,
  analytics: PATHS.toolsBacktest,
  optimize: PATHS.toolsOptimizer,
  screener: PATHS.screener,
  analisis: PATHS.research,
  fibras: PATHS.screenerFibras,
  magic: PATHS.screenerMagic,
})

/** @typedef {keyof typeof LEGACY_TAB_PATHS} LegacyTab */

/** @type {readonly LegacyTab[]} */
export const LEGACY_TABS = Object.freeze(/** @type {LegacyTab[]} */ (Object.keys(LEGACY_TAB_PATHS)))

/**
 * Ruta de la app nueva para una tab del legado, o null si la tab no existe.
 * @param {unknown} tab
 * @returns {string | null}
 */
export function legacyPathForTab(tab) {
  return typeof tab === 'string' && Object.hasOwn(LEGACY_TAB_PATHS, tab) ? LEGACY_TAB_PATHS[/** @type {LegacyTab} */ (tab)] : null
}

/**
 * Tab del legado que abre una ruta ("/mercados" o "mercados"), o null si ninguna la usa.
 * @param {string} path
 * @returns {LegacyTab | null}
 */
export function legacyTabForPath(path) {
  const normalized = `/${String(path).replace(/^\/+|\/+$/g, '')}`
  return LEGACY_TABS.find((tab) => LEGACY_TAB_PATHS[tab] === normalized) ?? null
}
