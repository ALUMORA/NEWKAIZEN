// Watchlist (F5). Las listas viven en src/lib/storage.js (watchlists del storage v2).
import { lazy } from 'react'
import { PATHS, route } from '../../app/paths.js'

const Pages = { Watchlist: lazy(() => import('./pages/Watchlist.jsx')) }

export const routes = [
  {
    path: route(PATHS.watchlist),
    element: <Pages.Watchlist />,
    handle: { title: 'Lista de seguimiento', description: 'Tus listas de emisoras para seguir su precio y sus noticias.' },
  },
]
