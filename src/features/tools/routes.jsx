// Herramientas (F4). Optimizador y backtest montan la app legada hasta que existan las páginas
// nuevas; el simulador (Monte Carlo, metas y retiro) ya es página nueva.
import { lazy } from 'react'
import { Navigate } from 'react-router'
import { legacyRoute } from '../../app/legacyRoute.jsx'
import { PATHS, route } from '../../app/paths.js'

// Las páginas van en un objeto para que la regla de Fast Refresh no las tome por componentes
// locales de un archivo que solo exporta `routes`.
const Pages = {
  Simulator: lazy(() => import('./pages/SimulatorPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.tools),
    element: <Navigate replace to={PATHS.toolsOptimizer} />,
  },
  legacyRoute(PATHS.toolsOptimizer, { title: 'Optimizador' }),
  legacyRoute(PATHS.toolsBacktest, { title: 'Backtest' }),
  {
    path: route(PATHS.toolsSimulator),
    element: <Pages.Simulator />,
    handle: { title: 'Simulador', description: 'Escenarios de Monte Carlo para metas y retiro, con supuestos visibles.' },
  },
]
