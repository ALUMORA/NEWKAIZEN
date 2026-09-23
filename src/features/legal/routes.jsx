// Legales (F5). Rutas públicas: no piden sesión (handle.public).
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Terms: lazy(() => import('./pages/Terms.jsx')),
  Privacy: lazy(() => import('./pages/Privacy.jsx')),
  Notice: lazy(() => import('./pages/Notice.jsx')),
}

export const routes = [
  {
    path: route(PATHS.legalTerms),
    element: <Pages.Terms />,
    handle: { title: 'Términos de uso', public: true, description: 'Condiciones de uso de Kaizen.' },
  },
  {
    path: route(PATHS.legalPrivacy),
    element: <Pages.Privacy />,
    handle: { title: 'Aviso de privacidad', public: true, description: 'Qué datos guarda Kaizen, dónde y para qué.' },
  },
  {
    path: route(PATHS.legalNotice),
    element: <Pages.Notice />,
    handle: { title: 'Aviso legal', public: true, description: 'Kaizen es una herramienta informativa: no da recomendaciones de inversión.' },
  },
]
