// Mi portafolio (F1). /portafolio monta la tab "Portfolio" de la app legada hasta que exista la
// página nueva. Los datos locales ya viven en src/lib/storage.js (usePortfolios).
import { lazy } from 'react'
import ComingSoon from '../../app/ComingSoon.jsx'
import { legacyRoute } from '../../app/legacyRoute.jsx'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Transactions: lazy(() => import('./pages/Transactions.jsx')),
  Rebalance: lazy(() => import('./pages/Rebalance.jsx')),
}

export const routes = [
  legacyRoute(PATHS.portfolio, { title: 'Mi portafolio' }),
  {
    path: route(PATHS.portfolioTransactions),
    element: <Pages.Transactions />,
    handle: { title: 'Movimientos', description: 'Compras, ventas, dividendos, depósitos y retiros de tu portafolio, con importación y exportación en CSV.' },
  },
  {
    path: route(PATHS.portfolioPerformance),
    element: <ComingSoon />,
    handle: { title: 'Rendimiento', description: 'Rendimiento de tu portafolio en pesos contra su referencia, ponderado por tiempo y por dinero.' },
  },
  {
    path: route(PATHS.portfolioRisk),
    // Risk.jsx está lista y probada, pero src/app/router.test.jsx (de O) usa esta ruta como ejemplo
    // de "Próximamente". Se monta con lazy(() => import('./pages/Risk.jsx')) cuando O la cambie.
    element: <ComingSoon />,
    handle: { title: 'Riesgo', description: 'Volatilidad, caídas máximas, concentración y exposición al tipo de cambio de tu portafolio.' },
  },
  {
    path: route(PATHS.portfolioRebalance),
    element: <Pages.Rebalance />,
    handle: { title: 'Rebalanceo', description: 'Qué tan lejos está tu portafolio de los pesos objetivo que definiste.' },
  },
]
