// Monta la app legada (src/legacy/App.legacy.jsx) en la tab que corresponde a la ruta, mientras
// la feature nueva no exista. Uso en un routes.jsx:
//
//   { path: route(PATHS.portfolio), element: <LegacyPage tab="portfolio" />,
//     handle: { title: 'Mi portafolio', legacy: true } }
//
// `handle.legacy` le dice a CapabilitiesBanner que aquí el API viejo sí sirve. El módulo legado
// pesa mucho y se carga aparte (import dinámico): la primera pantalla de las rutas nuevas no lo
// descarga.
//
// Sesión: el legado pide sus datos con authorizedFetch (src/lib/api/client.js), así que cada
// request de datos al API lleva Authorization: Bearer <token> (el backend v2 exige sesión también
// en las rutas v1; /health es pública y va sin token) y un 401 cierra la sesión: RequireAuth
// manda a /login?next=<ruta>.
import { Suspense, lazy, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { API_BASE } from '../lib/api/config.js'
import { logout } from '../lib/auth/session.js'
import { PATHS } from './paths.js'

/** Tabs del Workspace legado. */
const LEGACY_TABS = /** @type {const} */ (['news', 'portfolio', 'analytics', 'optimize', 'screener', 'analisis', 'fibras', 'magic'])

const LegacyWorkspaceHost = lazy(() =>
  import('../legacy/App.legacy.jsx').then((m) => ({ default: m.LegacyWorkspaceHost })),
)

/** @param {{ tab: (typeof LEGACY_TABS)[number] }} props tab del Workspace legado */
export default function LegacyPage({ tab }) {
  const navigate = useNavigate()
  const onLogout = useCallback(() => {
    logout()
    navigate(PATHS.login, { replace: true })
  }, [navigate])
  return (
    <Suspense fallback={null}>
      <LegacyWorkspaceHost apiBase={API_BASE} onLogout={onLogout} tab={tab} />
    </Suspense>
  )
}
