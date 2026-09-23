// Herramientas (F4): optimizador, backtest y simulador (Monte Carlo, metas y retiro), las tres
// como páginas nuevas cargadas con lazy.
import { lazy } from 'react'
import { Navigate } from 'react-router'
import { legacyRoute } from '../../app/legacyRoute.jsx'
import { PATHS, route } from '../../app/paths.js'

// Las páginas van en un objeto para que la regla de Fast Refresh no las tome por componentes
// locales de un archivo que solo exporta `routes`.
const Pages = {
  Optimizer: lazy(() => import('./pages/OptimizerPage.jsx')),
  Simulator: lazy(() => import('./pages/SimulatorPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.tools),
    element: <Navigate replace to={PATHS.toolsOptimizer} />,
  },
  {
    path: route(PATHS.toolsOptimizer),
    element: <Pages.Optimizer />,
    handle: { title: 'Optimizador', description: 'Mínima varianza, paridad de riesgo y máximo Sharpe con supuestos editables y validación fuera de muestra.' },
  },
  legacyRoute(PATHS.toolsBacktest, { title: 'Backtest' }),
  {
    path: route(PATHS.toolsSimulator),
    element: <Pages.Simulator />,
    handle: { title: 'Simulador', description: 'Escenarios de Monte Carlo para metas y retiro, con supuestos visibles.' },
  },
]
