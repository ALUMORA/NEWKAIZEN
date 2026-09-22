// Bienvenida (F5). settings.onboardingDone en src/lib/storage.js dice si ya se completó.
import ComingSoon from '../../app/ComingSoon.jsx'
import { PATHS, route } from '../../app/paths.js'

export const routes = [
  {
    path: route(PATHS.onboarding),
    element: <ComingSoon />,
    handle: { title: 'Bienvenida', description: 'Primeros pasos: tu perfil, tu primer portafolio o uno de ejemplo.' },
  },
]
