// Gráficas de C2 que usan los screeners de fórmula mágica y FIBRAs, cargadas bajo demanda.
import { lazy } from 'react'

export const Bars = lazy(() => import('../../../components/charts/Bars.jsx').then((m) => ({ default: m.Bars })))
