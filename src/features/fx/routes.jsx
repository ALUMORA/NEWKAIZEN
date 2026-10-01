// Tipo de cambio (V5FX): monitor del peso y cruces en Mercados; FIX contable, regla del DOF y forward
// teórico en Empresas. Las dos de Empresas se declaran aquí con su ruta completa y el índice /empresas
// (V5EM) las liga solo porque lee la sección 'Empresas' de nav.js.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Monitor: lazy(() => import('./pages/FxMonitorPage.jsx')),
  Accounting: lazy(() => import('./pages/FxAccountingPage.jsx')),
  Hedge: lazy(() => import('./pages/HedgePage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.marketsFx),
    element: <Pages.Monitor />,
    handle: { title: 'Tipo de cambio', description: 'El peso frente al dólar: FIX, rango de 52 semanas, volatilidad, promedios mensuales y cruces con otras monedas.' },
  },
  {
    path: route(PATHS.businessFx),
    element: <Pages.Accounting />,
    handle: { title: 'Tipo de cambio contable', description: 'FIX de Banxico por fecha o con la regla del DOF, cierres de mes y conversión por lote para tu contabilidad.' },
  },
  {
    path: route(PATHS.businessHedge),
    element: <Pages.Hedge />,
    handle: { title: 'Forward y presupuesto en dólares', description: 'Forward teórico del dólar por paridad de tasas y el impacto en pesos de tu presupuesto en dólares. No es cotización.' },
  },
]
