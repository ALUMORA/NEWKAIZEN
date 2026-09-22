// Ruta de una feature que todavía monta la app legada. En un routes.jsx:
//
//   legacyRoute(PATHS.portfolio, { title: 'Mi portafolio' })
//
// La tab que abre sale de LEGACY_TAB_PATHS (src/app/legacyTabs.js), el único lugar con el mapeo
// ruta ↔ tab, y el handle queda marcado con legacy: true (CapabilitiesBanner no muestra ahí el
// aviso de "Servidor sin actualizar"). Para migrar la ruta, reemplaza la llamada por
// { path: route(PATHS.portfolio), element: <Pages.X />, handle: { title } }.
import LegacyPage from './LegacyPage.jsx'
import { legacyTabForPath } from './legacyTabs.js'
import { route } from './paths.js'

/**
 * @param {string} path constante de PATHS
 * @param {{ title: string, [key: string]: unknown }} handle
 */
export function legacyRoute(path, handle) {
  const tab = legacyTabForPath(path)
  if (!tab) throw new Error(`legacyRoute(): ${path} no tiene tab del legado en LEGACY_TAB_PATHS`)
  return { path: route(path), element: <LegacyPage tab={tab} />, handle: { ...handle, legacy: true } }
}
