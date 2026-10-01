// Empresas (V5EM). /empresas NO es ruta layout: es una página índice que arma sus ligas leyendo la
// sección 'Empresas' de nav.js, así las páginas que declaran otras features (V5FX en fx/routes.jsx)
// aparecen solas. Cada página es hermana, con su ruta completa.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Index: lazy(() => import('./pages/BusinessIndex.jsx')),
  Update: lazy(() => import('./pages/UpdatePage.jsx')),
  Reference: lazy(() => import('./pages/ReferencePage.jsx')),
  Capital: lazy(() => import('./pages/CapitalPage.jsx')),
  Credit: lazy(() => import('./pages/CreditPage.jsx')),
  Counterparties: lazy(() => import('./pages/CounterpartiesPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.business),
    element: <Pages.Index />,
    handle: { title: 'Empresas', description: 'Herramientas para empresas chicas y medianas: tipo de cambio contable, actualización por INPC, costo de capital, crédito y contrapartes.' },
  },
  {
    path: route(PATHS.businessUpdate),
    element: <Pages.Update />,
    handle: { title: 'Actualización por INPC', description: 'Factor de actualización con el INPC, recargos y ajuste de rentas o contratos, con la fórmula y las fechas a la vista.' },
  },
  {
    path: route(PATHS.businessReference),
    element: <Pages.Reference />,
    handle: { title: 'Valores de referencia', description: 'UMA, salario mínimo y otros valores oficiales por año, con convertidor de UMA a pesos y liga a la publicación.' },
  },
  {
    path: route(PATHS.businessCapital),
    element: <Pages.Capital />,
    handle: { title: 'Costo de capital', description: 'Costo de capital y WACC de tu empresa con la beta de su industria, la prima de mercado y la prima país.' },
  },
  {
    path: route(PATHS.businessCredit),
    element: <Pages.Credit />,
    handle: { title: 'Crédito a TIIE', description: 'Tabla de pagos de un crédito a TIIE o SOFR más sobretasa, con escenarios de 100 pb arriba y abajo.' },
  },
  {
    path: route(PATHS.businessCounterparties),
    element: <Pages.Counterparties />,
    handle: { title: 'Salud financiera de contrapartes', description: 'Razones de liquidez, deuda y cobertura de intereses de clientes y proveedores que cotizan, lado a lado.' },
  },
]
