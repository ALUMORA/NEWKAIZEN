// Aprender (F5). Rutas públicas: no piden sesión (handle.public).
import ComingSoon from '../../app/ComingSoon.jsx'
import { PATHS, route } from '../../app/paths.js'

export const routes = [
  {
    path: route(PATHS.learn),
    element: <ComingSoon />,
    handle: { title: 'Aprender', public: true, description: 'Glosario y guías cortas sobre inversión, riesgo y mercados en México.' },
  },
  {
    path: route(PATHS.learnTerm),
    element: <ComingSoon />,
    handle: { title: 'Aprender', public: true, description: 'Explicación de este concepto con ejemplos en pesos.' },
  },
]
