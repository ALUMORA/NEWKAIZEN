// Abanico de percentiles (simulaciones): banda p5 a p95, banda p25 a p75 y mediana. Series extra
// opcionales (lo aportado, la meta) van como líneas punteadas.
import { useMemo } from 'react'
import { TimeSeries } from './TimeSeries.jsx'

/**
 * @param {{
 *   points: { date?: any, x?: number, p5: number, p25: number, p50: number, p75: number, p95: number }[],
 *   extra?: { label: string, points: { date?: any, x?: number, value: number }[], color?: string | number }[],
 *   color?: string | number,
 * } & Omit<import('react').ComponentProps<typeof TimeSeries>, 'series' | 'bands'>} props
 */
export function FanChart({ points, extra = [], color = '--chart-1', ...rest }) {
  const { series, bands } = useMemo(() => {
    const xOf = (p) => (p.date !== undefined ? { date: p.date } : { x: p.x })
    return {
      bands: [
        { id: 'p5-95', label: 'Percentil 5 a 95', color, points: points.map((p) => ({ ...xOf(p), lower: p.p5, upper: p.p95 })) },
        { id: 'p25-75', label: 'Percentil 25 a 75', color, points: points.map((p) => ({ ...xOf(p), lower: p.p25, upper: p.p75 })) },
      ],
      series: [
        { id: 'p50', label: 'Mediana', color, points: points.map((p) => ({ ...xOf(p), value: p.p50 })) },
        ...extra.map((s, i) => ({ ...s, id: `e${i}`, dash: true, color: s.color ?? i + 2 })),
      ],
    }
  }, [points, extra, color])
  return <TimeSeries {...rest} series={series} bands={bands} legend />
}
