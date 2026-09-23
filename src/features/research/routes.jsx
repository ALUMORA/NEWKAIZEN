// Investigar (F3). /investigar y los tres screeners montan la app legada hasta que existan las
// páginas nuevas; la ficha por emisora y el comparador son rutas nuevas.
import { lazy } from 'react'
import { legacyRoute } from '../../app/legacyRoute.jsx'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Instrument: lazy(() => import('./pages/Instrument.jsx')),
  Compare: lazy(() => import('./pages/Compare.jsx')),
}

export const routes = [
  legacyRoute(PATHS.research, { title: 'Investigar' }),
  {
    path: route(PATHS.compare),
    element: <Pages.Compare />,
    handle: { title: 'Comparar emisoras', description: 'Varias emisoras lado a lado: valuación, rentabilidad, deuda y rendimiento.' },
  },
  {
    path: route(PATHS.instrument),
    element: <Pages.Instrument />,
    handle: { title: 'Ficha de la emisora', description: 'Precio, fundamentales, estados financieros, dividendos y valuación de una emisora.' },
  },
  legacyRoute(PATHS.screener, { title: 'Screener' }),
  legacyRoute(PATHS.screenerMagic, { title: 'Fórmula Mágica' }),
  legacyRoute(PATHS.screenerFibras, { title: 'FIBRAs' }),
]
