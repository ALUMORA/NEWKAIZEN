// Economía (V5EC): tablero de indicadores de México y EE. UU. y calendario económico.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Economy: lazy(() => import('./pages/EconomyPage.jsx')),
  Calendar: lazy(() => import('./pages/CalendarPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.marketsEconomy),
    element: <Pages.Economy />,
    handle: { title: 'Economía de México y Estados Unidos', description: 'Inflación, crecimiento, empleo y otros indicadores con su última cifra, su cambio anual y la comparación entre países.' },
  },
  {
    path: route(PATHS.marketsCalendar),
    element: <Pages.Calendar />,
    handle: { title: 'Calendario económico', description: 'Publicaciones de indicadores y decisiones de Banxico y la Fed de México y Estados Unidos, por semana o por mes.' },
  },
]
