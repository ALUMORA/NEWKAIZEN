// Investigar (F3). /investigar y los tres screeners montan la app legada hasta que existan las
// páginas nuevas; la ficha por emisora y el comparador son rutas nuevas.
import { lazy } from 'react'
import { legacyRoute } from '../../app/legacyRoute.jsx'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Search: lazy(() => import('./pages/Search.jsx')),
  Screener: lazy(() => import('./pages/Screener.jsx')),
  Instrument: lazy(() => import('./pages/Instrument.jsx')),
  Compare: lazy(() => import('./pages/Compare.jsx')),
}

export const routes = [
  {
    path: route(PATHS.research),
    element: <Pages.Search />,
    handle: { title: 'Investigar', description: 'Busca una emisora por nombre o clave y abre su ficha.' },
  },
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
  {
    path: route(PATHS.screener),
    element: <Pages.Screener />,
    handle: { title: 'Screener', description: 'Emisoras ordenadas por factores relativos a su sector, con cobertura y pruebas cumple o no cumple.' },
  },
  legacyRoute(PATHS.screenerMagic, { title: 'Fórmula Mágica' }),
  legacyRoute(PATHS.screenerFibras, { title: 'FIBRAs' }),
]
