// Gráficas de C2 cargadas bajo demanda: no entran al JS inicial.
import { lazy } from 'react'

export const TimeSeries = lazy(() => import('../../../components/charts/TimeSeries.jsx').then((m) => ({ default: m.TimeSeries })))
