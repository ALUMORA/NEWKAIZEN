// Herramientas (F4). Optimizador y backtest montan la app legada hasta que existan las páginas
// nuevas; el simulador (Monte Carlo, metas y retiro) es ruta nueva.
import { Navigate } from 'react-router'
import ComingSoon from '../../app/ComingSoon.jsx'
import { legacyRoute } from '../../app/legacyRoute.jsx'
import { PATHS, route } from '../../app/paths.js'

export const routes = [
  {
    path: route(PATHS.tools),
    element: <Navigate replace to={PATHS.toolsOptimizer} />,
  },
  legacyRoute(PATHS.toolsOptimizer, { title: 'Optimizador' }),
  legacyRoute(PATHS.toolsBacktest, { title: 'Backtest' }),
  {
    path: route(PATHS.toolsSimulator),
    element: <ComingSoon />,
    handle: { title: 'Simulador', description: 'Escenarios de Monte Carlo para metas y retiro, con supuestos visibles.' },
  },
]
