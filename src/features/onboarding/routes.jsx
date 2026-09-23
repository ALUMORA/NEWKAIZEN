// Bienvenida (F5). settings.onboardingDone en src/lib/storage.js dice si ya se completó.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = { Onboarding: lazy(() => import('./pages/Onboarding.jsx')) }

export const routes = [
  {
    path: route(PATHS.onboarding),
    element: <Pages.Onboarding />,
    handle: { title: 'Bienvenida', description: 'Primeros pasos: tu perfil, tu primer portafolio o uno de ejemplo.' },
  },
]
