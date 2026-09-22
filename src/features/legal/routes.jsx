// Legales (F5). Rutas públicas: no piden sesión (handle.public).
import ComingSoon from '../../app/ComingSoon.jsx'
import { PATHS, route } from '../../app/paths.js'

export const routes = [
  {
    path: route(PATHS.legalTerms),
    element: <ComingSoon />,
    handle: { title: 'Términos de uso', public: true, description: 'Condiciones de uso de Kaizen.' },
  },
  {
    path: route(PATHS.legalPrivacy),
    element: <ComingSoon />,
    handle: { title: 'Aviso de privacidad', public: true, description: 'Qué datos guarda Kaizen, dónde y para qué.' },
  },
  {
    path: route(PATHS.legalNotice),
    element: <ComingSoon />,
    handle: { title: 'Aviso legal', public: true, description: 'Kaizen es una herramienta informativa: no da recomendaciones de inversión.' },
  },
]
