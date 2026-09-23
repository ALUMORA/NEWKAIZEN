// Resultados del backtest: cifras principales, tabla de métricas contra el referente, crecimiento
// de 1 peso y caídas desde el máximo. Todo describe el pasado con los supuestos elegidos.
import { Suspense, lazy } from 'react'
import { Card, DataStatus, DataTable, Delta, ErrorState, Skeleton, Stat } from '../../../components/ui/index.js'
import { MISSING, fmtDate, fmtNumber, fmtPct } from '../../../lib/format.js'

const TimeSeries = lazy(() => import('../../../components/charts/TimeSeries.jsx').then((m) => ({ default: m.TimeSeries })))
const DrawdownChart = lazy(() => import('../../../components/charts/DrawdownChart.jsx').then((m) => ({ default: m.DrawdownChart })))

const pct = (/** @type {number | null | undefined} */ v) => (v === null || v === undefined ? MISSING : fmtPct(v, { decimals: 1 }))
const num = (/** @type {number | null | undefined} */ v) => (v === null || v === undefined ? MISSING : fmtNumber(v, { decimals: 2 }))

const METRICS = [
  { id: 'cagr', label: 'CAGR', get: (s) => s.cagr, fmt: pct },
  { id: 'vol', label: 'Volatilidad', get: (s) => s.vol, fmt: pct },
  { id: 'mdd', label: 'Caída máxima', get: (s) => s.maxDrawdown, fmt: pct },
  { id: 'calmar', label: 'Calmar', get: (s) => s.calmar, fmt: num },
  { id: 'sharpe', label: 'Sharpe', get: (s) => s.sharpe, fmt: num },
  { id: 'sortino', label: 'Sortino', get: (s) => s.sortino, fmt: num },
  { id: 'var', label: 'VaR 95 %', get: (s) => s.var95, fmt: pct },
  { id: 'cvar', label: 'CVaR 95 %', get: (s) => s.cvar95, fmt: pct },
  { id: 'best', label: 'Mejor semana', get: (s) => s.best, fmt: pct },
  { id: 'worst', label: 'Peor semana', get: (s) => s.worst, fmt: pct },
  { id: 'pos', label: 'Semanas al alza', get: (s) => s.positivePct, fmt: (v) => (v === null ? MISSING : fmtPct(v, { decimals: 0 })) },
]

/** @param {any} dd @param {string} end */
function drawdownText(dd, end) {
  if (!dd || !dd.peak || !dd.trough || dd.maxDrawdown === 0) return 'Sin caídas en el periodo.'
  const recovered = dd.recovery ? `se recuperó el ${fmtDate(dd.recovery)}` : `al ${fmtDate(end)} no se había recuperado`
  return `Del ${fmtDate(dd.peak)} al ${fmtDate(dd.trough)}; ${recovered}.`
}

/**
 * @param {{ result: any, benchLabel: string, benchShort?: string, mineLabel?: string, status?: any, rf: { meta?: any, isError: boolean, refetch: () => unknown } }} props
 */
export function BacktestResults({ result, benchLabel, benchShort = benchLabel, mineLabel = 'Tu mezcla', status, rf }) {
  const p = result.portfolio
  const b = result.benchmark
  const c = result.comparison
  const cagrGap = p?.cagr !== null && b?.cagr !== null && p && b ? p.cagr - b.cagr : null
  const rows = METRICS.map((m) => ({ id: m.id, label: m.label, mine: p ? m.get(p) : null, bench: b ? m.get(b) : null, fmt: m.fmt }))
  const columns = [
    { key: 'label', header: 'Métrica' },
    { key: 'mine', header: mineLabel, numeric: true, format: (v, row) => row.fmt(v) },
    { key: 'bench', header: benchShort, numeric: true, format: (v, row) => row.fmt(v) },
  ]
  const weights = Object.entries(result.weights).map(([symbol, w]) => ({ symbol, w }))
  const series = [
    { id: 'mine', label: mineLabel, points: result.growth.portfolio },
    { id: 'bench', label: benchLabel, points: result.growth.benchmark },
  ]

  return (
    <>
      <Card
        title="Resultado"
        status={status}
        description={`${fmtNumber(result.periods, { decimals: 0 })} semanas, del ${fmtDate(result.start)} al ${fmtDate(result.end)}, en pesos. Referente: ${benchLabel}.`}
      >
        <div className="kz-tool__stats">
          <Stat
            label="CAGR"
            value={pct(p?.cagr)}
            delta={cagrGap === null ? undefined : <Delta value={cagrGap} kind="pp" decimals={1} hint="contra el referente" />}
            info={{ termKey: 'cagr', term: 'CAGR' }}
          />
          <Stat label="Volatilidad anual" value={pct(p?.vol)} info={{ termKey: 'volatilidad', term: 'Volatilidad' }} />
          <Stat label="Caída máxima" value={pct(result.drawdown.portfolio?.maxDrawdown)} sublabel={drawdownText(result.drawdown.portfolio, result.end)} info={{ termKey: 'drawdown-maximo', term: 'Caída máxima' }} />
          <Stat label="Sharpe" value={num(p?.sharpe)} sublabel={result.rfComplete ? 'Sobre CETES 28 de cada semana.' : 'Contra cero: faltó la serie de CETES.'} info={{ termKey: 'sharpe', term: 'Sharpe' }} />
        </div>
        <div className="kz-tool__stats">
          <Stat size="sm" label="Tracking error" value={pct(c?.trackingError)} info={{ termKey: 'tracking-error', term: 'Tracking error' }} />
          <Stat size="sm" label="Information ratio" value={num(c?.informationRatio)} info={{ termKey: 'information-ratio', term: 'Information ratio' }} />
          {result.turnover && (
            <Stat size="sm" label="Rotación anual" value={pct(result.turnover.annual)} sublabel={`${fmtNumber(result.turnover.rebalances, { decimals: 0 })} rebalanceos. Cada uno cuesta comisiones que aquí no se cuentan.`} info={{ termKey: 'rebalanceo', term: 'Rebalanceo' }} />
          )}
        </div>
        <DataTable caption="Métricas contra el referente" columns={columns} rows={rows} rowKey="id" density="compact" />
        <div className="kz-tool__rf">
          <p className="kz-tool__hint">
            {result.rfComplete
              ? 'CAGR y volatilidad son anuales; VaR y CVaR, pérdidas semanales. Sharpe y Sortino miden el exceso sobre CETES 28 alineado a cada semana.'
              : 'CAGR y volatilidad son anuales; VaR y CVaR, pérdidas semanales. Sin la serie de CETES completa para estas fechas, Sharpe y Sortino se miden contra cero.'}
          </p>
          {rf.meta && <DataStatus {...rf.meta} />}
        </div>
        {rf.isError && <ErrorState size="sm" title="No pudimos traer la tasa de CETES" message="Sin ella, Sharpe y Sortino se miden contra cero." onRetry={() => rf.refetch()} />}
      </Card>

      <Card>
        <Suspense fallback={<Skeleton height={320} />}>
          <TimeSeries title="Crecimiento de 1 peso" titleAs="h2" description={`Cuánto valdría cada peso invertido al inicio: ${mineLabel.toLowerCase()} contra ${benchLabel}.`} series={series} format="money" decimals={2} status={status} source="Kaizen con precios semanales ajustados en pesos." />
        </Suspense>
      </Card>
      <Card>
        <Suspense fallback={<Skeleton height={260} />}>
          <DrawdownChart title="Caídas desde el máximo" titleAs="h2" description={`Qué tan abajo de su máximo anterior estuvo ${mineLabel.toLowerCase()} cada semana.`} points={result.drawdown.portfolio?.points ?? []} label={mineLabel} status={status} source="Kaizen con precios semanales ajustados en pesos." />
        </Suspense>
      </Card>
      <Card title="Pesos al inicio">
        <DataTable
          caption="Pesos al inicio"
          captionHidden
          columns={[
            { key: 'symbol', header: 'Emisora', format: (v) => <span className="mono">{v}</span> },
            { key: 'w', header: 'Peso', numeric: true, sortable: true, format: (v) => pct(v) },
          ]}
          rows={weights}
          rowKey="symbol"
          defaultSort={{ key: 'w', direction: 'descending' }}
          density="compact"
        />
      </Card>
    </>
  )
}
