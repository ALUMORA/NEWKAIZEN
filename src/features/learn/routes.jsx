// Aprender (F5). Rutas públicas: no piden sesión (handle.public).
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  LearnIndex: lazy(() => import('./pages/LearnIndex.jsx')),
  LearnTerm: lazy(() => import('./pages/LearnTerm.jsx')),
}

export const routes = [
  {
    path: route(PATHS.learn),
    element: <Pages.LearnIndex />,
    handle: { title: 'Aprender', public: true, description: 'Glosario y guías cortas sobre inversión, riesgo y mercados en México.' },
  },
  {
    path: route(PATHS.learnTerm),
    element: <Pages.LearnTerm />,
    handle: { title: 'Aprender', public: true, description: 'Explicación de este concepto con ejemplos en pesos.' },
  },
]
