// Monta la app legada (src/legacy/App.legacy.jsx) en la tab que corresponde a la ruta, mientras
// la feature nueva no exista. Las rutas no la usan directo: usan legacyRoute() en su routes.jsx,
//
//   legacyRoute(PATHS.portfolio, { title: 'Mi portafolio' })   → <LegacyPage tab="portfolio" />
//
// que toma la tab del mapeo único de src/app/legacyTabs.js y marca `handle.legacy` (así
// CapabilitiesBanner sabe que aquí el API viejo sí sirve). El módulo legado pesa mucho y se carga
// aparte (import dinámico): la primera pantalla de las rutas nuevas no lo descarga.
//
// URL y tab van juntas: si la persona cambia de tab dentro del legado, onTabChange navega (push)
// a la ruta de esa tab, así que el título cambia, recargar conserva la tab y Atrás regresa. Al
// cambiar la ruta, el Workspace sigue montado (mismo componente en la misma posición) y solo
// cambia de tab. Sin ciclos: si la tab que avisa el legado ya es la de esta ruta, no se navega.
//
// Sesión: el legado pide sus datos con authorizedFetch (src/lib/api/client.js), así que cada
// request de datos al API lleva Authorization: Bearer <token> (el backend v2 exige sesión también
// en las rutas v1; /health es pública y va sin token) y un 401 cierra la sesión: RequireAuth
// manda a /login?next=<ruta>.
import { Suspense, lazy, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { API_BASE } from '../lib/api/config.js'
import { logout } from '../lib/auth/session.js'
import { legacyPathForTab } from './legacyTabs.js'
import { PATHS } from './paths.js'

const LegacyWorkspaceHost = lazy(() =>
  import('../legacy/App.legacy.jsx').then((m) => ({ default: m.LegacyWorkspaceHost })),
)

/** @param {{ tab: import('./legacyTabs.js').LegacyTab }} props tab del Workspace legado */
export default function LegacyPage({ tab }) {
  const navigate = useNavigate()
  const onLogout = useCallback(() => {
    logout()
    navigate(PATHS.login, { replace: true })
  }, [navigate])
  const onTabChange = useCallback(
    (/** @type {string} */ next) => {
      if (next === tab) return
      const path = legacyPathForTab(next)
      if (path) navigate(path)
    },
    [navigate, tab],
  )
  return (
    <Suspense fallback={null}>
      <LegacyWorkspaceHost apiBase={API_BASE} onLogout={onLogout} onTabChange={onTabChange} tab={tab} />
    </Suspense>
  )
}
