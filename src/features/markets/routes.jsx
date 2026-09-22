// Mercados (F2). /mercados monta la tab "Noticias" de la app legada hasta que exista la página
// nueva; el resto son rutas nuevas. Para migrar una ruta: crear ./pages/X.jsx, cargarla con
// lazy() y cambiar legacyRoute(...) por { path: route(PATHS.x), element: <Pages.X />, handle }.
import ComingSoon from '../../app/ComingSoon.jsx'
import { legacyRoute } from '../../app/legacyRoute.jsx'
import { PATHS, route } from '../../app/paths.js'

export const routes = [
  legacyRoute(PATHS.markets, { title: 'Mercados' }),
  {
    path: route(PATHS.marketsMexico),
    element: <ComingSoon />,
    handle: {
      title: 'México: tasas, CETES e inflación',
      description: 'Tasa objetivo de Banxico, TIIE, CETES, inflación y tipo de cambio FIX, cada dato con su fuente y su fecha.',
    },
  },
  {
    path: route(PATHS.marketsCetes),
    element: <ComingSoon />,
    handle: { title: 'Calculadora de CETES', description: 'Cuánto rinde una inversión en CETES según el plazo y la tasa de la última subasta.' },
  },
  {
    path: route(PATHS.marketsNews),
    element: <ComingSoon />,
    handle: { title: 'Noticias', description: 'Titulares de mercados de México y Estados Unidos con enlace a la fuente original.' },
  },
]
