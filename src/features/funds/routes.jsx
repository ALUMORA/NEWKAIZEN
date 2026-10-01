// Fondos y Rayos X (V5PF): lo que tiene adentro cada ETF y la exposición real del portafolio.
// La sección de la ficha vive en sections/FundSection.jsx.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Xray: lazy(() => import('./pages/XrayPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.portfolioXray),
    element: <Pages.Xray />,
    handle: { title: 'Rayos X del portafolio', description: 'Exposición por sector y por emisora sumando tus acciones directas y lo que hay dentro de cada ETF, con la cobertura visible.' },
  },
]
