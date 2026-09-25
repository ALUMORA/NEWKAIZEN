// Mi portafolio (F1). Todas las páginas son nuevas y se cargan con lazy; los datos locales viven
// en src/lib/storage.js (usePortfolios) y los cálculos en src/lib/finance.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Summary: lazy(() => import('./pages/Summary.jsx')),
  Transactions: lazy(() => import('./pages/Transactions.jsx')),
  Rebalance: lazy(() => import('./pages/Rebalance.jsx')),
  Risk: lazy(() => import('./pages/Risk.jsx')),
  Performance: lazy(() => import('./pages/Performance.jsx')),
}

export const routes = [
  {
    path: route(PATHS.portfolio),
    element: <Pages.Summary />,
    handle: { title: 'Mi portafolio', description: 'Valor de tu portafolio en pesos, ganancia no realizada, cambio del día, posiciones y asignación.' },
  },
  {
    path: route(PATHS.portfolioTransactions),
    element: <Pages.Transactions />,
    handle: { title: 'Movimientos del portafolio', description: 'Compras, ventas, dividendos, depósitos y retiros de tu portafolio, con importación y exportación en CSV.' },
  },
  {
    path: route(PATHS.portfolioPerformance),
    element: <Pages.Performance />,
    handle: { title: 'Rendimiento del portafolio', description: 'Rendimiento de tu portafolio en pesos contra su referencia, ponderado por tiempo y por dinero.' },
  },
  {
    path: route(PATHS.portfolioRisk),
    element: <Pages.Risk />,
    handle: { title: 'Riesgo del portafolio', description: 'Volatilidad, caídas máximas, concentración y exposición al tipo de cambio de tu portafolio.' },
  },
  {
    path: route(PATHS.portfolioRebalance),
    element: <Pages.Rebalance />,
    handle: { title: 'Rebalanceo del portafolio', description: 'Qué tan lejos está tu portafolio de los pesos objetivo que definiste.' },
  },
]
