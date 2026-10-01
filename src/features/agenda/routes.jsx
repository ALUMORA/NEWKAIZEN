// Agenda (V5PF): reportes y dividendos de tu portafolio y temporada de reportes del mercado.
// Vive aquí y no en portfolio/routes.jsx para que el stream no toque archivos de otro.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Agenda: lazy(() => import('./pages/AgendaPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.portfolioAgenda),
    element: <Pages.Agenda />,
    handle: { title: 'Agenda de reportes y dividendos', description: 'Próximos reportes y dividendos de tu portafolio y tu lista, y la temporada de reportes de México y Estados Unidos.' },
  },
]
