// Resumen del día (V5TM): una sola columna tipo terminal que cabe en hoja carta.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Briefing: lazy(() => import('./pages/BriefingPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.marketsBriefing),
    element: <Pages.Briefing />,
    handle: { title: 'Resumen del día', description: 'FIX, tasas cortas, índices, las que más se mueven, el calendario y los titulares en una hoja que puedes imprimir.' },
  },
]
