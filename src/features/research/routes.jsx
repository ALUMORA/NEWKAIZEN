// Investigar (F3). /investigar y los tres screeners montan la app legada hasta que existan las
// páginas nuevas; la ficha por emisora y el comparador son rutas nuevas.
import { lazy } from 'react'
import { legacyRoute } from '../../app/legacyRoute.jsx'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Instrument: lazy(() => import('./pages/Instrument.jsx')),
  Compare: lazy(() => import('./pages/Compare.jsx')),
}

// Screeners de la segunda tanda (F3c).
const Screeners = {
  MagicFormula: lazy(() => import('./pages/MagicFormula.jsx')),
  Fibras: lazy(() => import('./pages/Fibras.jsx')),
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
  {
    path: route(PATHS.screenerMagic),
    element: <Screeners.MagicFormula />,
    handle: { title: 'Fórmula Mágica', description: 'Ranking de Greenblatt por rendimiento de utilidades y rendimiento sobre capital, con sus exclusiones y empates.' },
  },
  {
    path: route(PATHS.screenerFibras),
    element: <Screeners.Fibras />,
    handle: { title: 'FIBRAs', description: 'LTV, cap rate implícito, flujo, distribución pagada, P/NAV y diferencial contra la tasa de cada FIBRA.' },
  },
]
