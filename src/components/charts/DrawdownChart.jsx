// Caída desde el máximo: área bajo 0, tope del eje en 0 y resumen con la caída máxima.
import { useMemo } from 'react'
import { fmtPct } from '../../lib/format.js'
import { TimeSeries } from './TimeSeries.jsx'
import { drawdownFrom, maxDrawdown } from './drawdown.js'
import { fmtAxisDate, toMs } from './scale.js'

/**
 * @param {{
 *   points: { date: any, value: number | null }[],
 *   fromPrices?: boolean,
 *   label?: string,
 *   color?: string | number,
 * } & Omit<import('react').ComponentProps<typeof TimeSeries>, 'series' | 'format'>} props
 *   points: caídas en fracción (≤ 0), o precios con fromPrices.
 */
export function DrawdownChart({ points, fromPrices = false, label = 'Caída desde el máximo', color = '--down', summary, ...rest }) {
  const dd = useMemo(() => (fromPrices ? drawdownFrom(points) : points), [points, fromPrices])
  const worst = maxDrawdown(dd)
  const series = useMemo(() => [{ id: 'dd', label, color, area: true, points: dd }], [dd, label, color])
  const text = summary ?? (worst ? `Caída máxima de ${fmtPct(worst.value, { decimals: 1 })} el ${fmtAxisDate(toMs(worst.date))}.` : undefined)
  return <TimeSeries {...rest} series={series} format="pct" zeroBaseline yDomain={[undefined, 0]} summary={text} />
}
