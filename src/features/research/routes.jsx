// Investigar (F3): buscador, ficha, comparador y los tres screeners.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Search: lazy(() => import('./pages/Search.jsx')),
  Screener: lazy(() => import('./pages/Screener.jsx')),
  Instrument: lazy(() => import('./pages/Instrument.jsx')),
  Compare: lazy(() => import('./pages/Compare.jsx')),
}

// Screeners de la segunda tanda (F3c).
const Screeners = {
  MagicFormula: lazy(() => import('./pages/MagicFormula.jsx')),
  Fibras: lazy(() => import('./pages/Fibras.jsx')),
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
    handle: { title: 'Screener de factores', description: 'Emisoras ordenadas por factores relativos a su sector, con cobertura y pruebas cumple o no cumple.' },
  },
  {
    path: route(PATHS.screenerMagic),
    element: <Screeners.MagicFormula />,
    handle: { title: 'Fórmula mágica', description: 'Ranking de Greenblatt por rendimiento de utilidades y rendimiento sobre capital, con sus exclusiones y empates.' },
  },
  {
    path: route(PATHS.screenerFibras),
    element: <Screeners.Fibras />,
    handle: { title: 'FIBRAs', description: 'LTV, cap rate implícito, flujo, distribución pagada, P/NAV y diferencial contra la tasa de cada FIBRA.' },
  },
]
