// Aprender (F5). Rutas públicas: no piden sesión (handle.public).
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  LearnIndex: lazy(() => import('./pages/LearnIndex.jsx')),
  LearnTerm: lazy(() => import('./pages/LearnTerm.jsx')),
  LearnGuide: lazy(() => import('./pages/LearnGuide.jsx')),
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
    handle: { title: 'Concepto del glosario', public: true, description: 'Explicación de este concepto con ejemplos en pesos.' },
  },
  {
    // Guías de docs/metodologia. Ruta propia de F5 (no está en PATHS, que es de C3); es más
    // específica que /aprender/:termino, así que el router la prefiere.
    path: route('/aprender/metodologia/:guia'),
    element: <Pages.LearnGuide />,
    handle: { title: 'Guía de metodología', public: true, description: 'Cómo calcula Kaizen cada número, con qué datos y con qué supuestos.' },
  },
]
