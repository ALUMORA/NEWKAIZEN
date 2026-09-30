// Mercados (F2): /mercados es el panorama del día; México, CETES y Noticias son sus subpáginas.
// Cada página se carga aparte (lazy) para no inflar el paquete inicial.
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = {
  Overview: lazy(() => import('./pages/OverviewPage.jsx')),
  Mexico: lazy(() => import('./pages/MexicoPage.jsx')),
  Cetes: lazy(() => import('./pages/CetesPage.jsx')),
  News: lazy(() => import('./pages/NewsPage.jsx')),
}

export const routes = [
  {
    path: route(PATHS.markets),
    element: <Pages.Overview />,
    handle: {
      title: 'Mercados',
      description: 'Estado de la BMV y la NYSE, resumen del día, VIX con su percentil, tasas de EE. UU. y el mundo en dólares.',
    },
  },
  {
    path: route(PATHS.marketsMexico),
    element: <Pages.Mexico />,
    handle: {
      title: 'México: tasas, CETES e inflación',
      description: 'Tasa objetivo de Banxico, TIIE, CETES, inflación y tipo de cambio FIX, cada dato con su fuente y su fecha.',
    },
  },
  {
    path: route(PATHS.marketsCetes),
    element: <Pages.Cetes />,
    handle: { title: 'Calculadora de CETES', description: 'Cuánto rinde una inversión en CETES según el plazo y la tasa de la última subasta.' },
  },
  {
    path: route(PATHS.marketsNews),
    element: <Pages.News />,
    handle: { title: 'Noticias', description: 'Titulares de mercados de México y Estados Unidos con enlace a la fuente original.' },
  },
]
