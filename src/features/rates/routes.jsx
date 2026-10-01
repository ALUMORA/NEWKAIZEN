// Tasas y curvas (V5TS): curvas de México y EE. UU., mercado de dinero, expectativas y tasa real.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Rates: lazy(() => import('./pages/RatesPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.marketsRates),
    element: <Pages.Rates />,
    handle: { title: 'Tasas y curvas', description: 'Curvas de rendimiento de México y Estados Unidos, mercado de dinero, expectativas de la encuesta de Banxico y tasa real, cada nodo con su fecha.' },
  },
]
