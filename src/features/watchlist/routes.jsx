// Watchlist (F5). Las listas ya viven en src/lib/storage.js (useWatchlists).
import ComingSoon from '../../app/ComingSoon.jsx'
import { PATHS, route } from '../../app/paths.js'

export const routes = [
  {
    path: route(PATHS.watchlist),
    element: <ComingSoon />,
    handle: { title: 'Watchlist', description: 'Tus listas de emisoras para seguir su precio y sus noticias.' },
  },
]
