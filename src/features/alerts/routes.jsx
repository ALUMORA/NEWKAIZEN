// Alertas (V5TM): reglas que se revisan dentro de la app mientras la pestaña está abierta.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Alerts: lazy(() => import('./pages/AlertsPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.alerts),
    element: <Pages.Alerts />,
    handle: { title: 'Alertas', description: 'Avisos dentro de la app cuando un precio cruza un nivel, un movimiento del día es grande, el FIX cambia o se acerca un dividendo.' },
  },
]
