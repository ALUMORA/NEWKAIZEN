// Árbol de rutas. Este archivo no debería volver a cambiar: cada feature declara sus rutas en
// src/features/<área>/routes.jsx y aquí solo se importan.
//
//   export const routes = [
//     { path: route(PATHS.portfolioRisk), element: <RiskPage />, handle: { title: 'Riesgo' } },
//   ]
//
// - `path` es relativo a la raíz (sin "/" inicial): usa route(PATHS.x).
// - handle.title da el título de la pestaña ("Riesgo · Kaizen").
// - handle.public: true la deja fuera de RequireAuth (login, aprender, legales).
// - handle.legacy: true marca rutas que montan la app legada (LegacyPage).
// - Las páginas se cargan con lazy() dentro de la feature, en un objeto para que la regla de
//   Fast Refresh no se queje: const Pages = { Risk: lazy(() => import('./pages/RiskPage.jsx')) }
//   y luego element: <Pages.Risk />. RootLayout pone el Suspense.
//
// Estructura:
//   /            RootLayout (título, aviso del servidor, Suspense)   errorElement: RouteError
//   ├─ rutas públicas de las features
//   ├─ (sin path) PrivateLayout = RequireAuth + AppShell (C3)
//   │   ├─ index → /mercados
//   │   └─ rutas privadas de las features
//   └─ *          NotFound
import { Navigate, createBrowserRouter } from 'react-router'
import { routes as authRoutes } from '../features/auth/routes.jsx'
import { routes as devUiRoutes } from '../features/dev-ui/routes.jsx'
import { routes as learnRoutes } from '../features/learn/routes.jsx'
import { routes as legalRoutes } from '../features/legal/routes.jsx'
import { routes as marketsRoutes } from '../features/markets/routes.jsx'
import { routes as onboardingRoutes } from '../features/onboarding/routes.jsx'
import { routes as portfolioRoutes } from '../features/portfolio/routes.jsx'
import { routes as researchRoutes } from '../features/research/routes.jsx'
import { routes as toolsRoutes } from '../features/tools/routes.jsx'
import { routes as watchlistRoutes } from '../features/watchlist/routes.jsx'
import NotFound from './NotFound.jsx'
import PrivateLayout from './PrivateLayout.jsx'
import RootLayout from './RootLayout.jsx'
import RouteError from './RouteError.jsx'
import { DEFAULT_PRIVATE_PATH } from './paths.js'

const featureRoutes = [
  ...marketsRoutes,
  ...portfolioRoutes,
  ...researchRoutes,
  ...toolsRoutes,
  ...watchlistRoutes,
  ...learnRoutes,
  ...onboardingRoutes,
  ...authRoutes,
  ...legalRoutes,
  // El catálogo de primitivas existe fuera de producción (dev y el build de e2e); routes.jsx trae
  // su propio candado por MODE, así que en producción esta lista viene vacía.
  ...devUiRoutes,
]

const isPublic = (r) => r.handle?.public === true

/** Definición de rutas (también la usan las pruebas con createMemoryRouter). */
export const appRoutes = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      ...featureRoutes.filter(isPublic),
      {
        element: <PrivateLayout />,
        children: [{ index: true, element: <Navigate replace to={DEFAULT_PRIVATE_PATH} /> }, ...featureRoutes.filter((r) => !isPublic(r))],
      },
      { path: '*', element: <NotFound />, handle: { title: 'Página no encontrada' } },
    ],
  },
]

export function createAppRouter() {
  return createBrowserRouter(appRoutes)
}
