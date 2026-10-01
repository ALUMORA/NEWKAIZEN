// Movimientos del día (V5MK): las que más suben, bajan y se operan, amplitud y mapa por sector.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Movers: lazy(() => import('./pages/MoversPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.marketsMovers),
    element: <Pages.Movers />,
    handle: { title: 'Movimientos del día', description: 'Las emisoras que más suben, bajan y se operan en México y Estados Unidos, la amplitud del mercado y el mapa por sector.' },
  },
]
