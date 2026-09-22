// Mercados (F2). /mercados monta la tab "Noticias" de la app legada hasta que exista la página
// nueva; el resto son rutas nuevas. Para migrar una ruta: crear ./pages/X.jsx, cargarla con
// lazy() y quitar `legacy: true` del handle.
import ComingSoon from '../../app/ComingSoon.jsx'
import LegacyPage from '../../app/LegacyPage.jsx'
import { PATHS, route } from '../../app/paths.js'

export const routes = [
  {
    path: route(PATHS.markets),
    element: <LegacyPage tab="news" />,
    handle: { title: 'Mercados', legacy: true },
  },
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
