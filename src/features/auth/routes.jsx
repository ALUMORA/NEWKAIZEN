// Acceso (F5). La página de login funciona hoy (session.login); F5 la rediseña sin cambiar la
// ruta. Pública: no pide sesión (handle.public).
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

// Las páginas van en un objeto (no en una constante por página) para que la regla de Fast Refresh
// no las tome por componentes locales de un archivo que solo exporta `routes`.
const Pages = {
  Login: lazy(() => import('./pages/LoginPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.login),
    element: <Pages.Login />,
    handle: { title: 'Iniciar sesión', public: true },
  },
]
