// Investigar (F3). /investigar y los tres screeners montan la app legada hasta que existan las
// páginas nuevas; la ficha por emisora y el comparador son rutas nuevas.
import ComingSoon from '../../app/ComingSoon.jsx'
import LegacyPage from '../../app/LegacyPage.jsx'
import { PATHS, route } from '../../app/paths.js'

export const routes = [
  {
    path: route(PATHS.research),
    element: <LegacyPage tab="analisis" />,
    handle: { title: 'Investigar', legacy: true },
  },
  {
    path: route(PATHS.compare),
    element: <ComingSoon />,
    handle: { title: 'Comparar emisoras', description: 'Varias emisoras lado a lado: valuación, rentabilidad, deuda y rendimiento.' },
  },
  {
    path: route(PATHS.instrument),
    element: <ComingSoon />,
    handle: { title: 'Ficha de la emisora', description: 'Precio, fundamentales, estados financieros, dividendos y valuación de una emisora.' },
  },
  {
    path: route(PATHS.screener),
    element: <LegacyPage tab="screener" />,
    handle: { title: 'Screener', legacy: true },
  },
  {
    path: route(PATHS.screenerMagic),
    element: <LegacyPage tab="magic" />,
    handle: { title: 'Fórmula Mágica', legacy: true },
  },
  {
    path: route(PATHS.screenerFibras),
    element: <LegacyPage tab="fibras" />,
    handle: { title: 'FIBRAs', legacy: true },
  },
]
