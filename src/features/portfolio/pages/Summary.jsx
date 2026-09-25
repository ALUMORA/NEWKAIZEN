// /portafolio: resumen del portafolio activo a precios de hoy. Valor total en pesos, ganancia no
// realizada, cambio del día, posiciones con su peso y resultado, asignación y ligas al resto de
// Mi portafolio. Las cotizaciones son de /v2/quotes y el tipo de cambio de /v2/fx.
import { lazy, Suspense, useMemo } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Card, DataTable, Delta, EmptyState, ErrorState, PageHeader, Select, Skeleton, Stat } from '../../../components/ui/index.js'
import { fmtMoney, fmtNumber, fmtPct } from '../../../lib/format.js'
import { fxQuery, quotesQuery } from '../../../lib/api/queries.js'
import { derivePositions } from '../../../lib/finance/index.js'
import { usePortfolios } from '../../../lib/portfolio/usePortfolios.js'
import { PATHS } from '../../../app/paths.js'
import { todayMx } from '../tx-labels.js'
import { summarize } from '../lib/summary-view.js'
import DataSources from '../components/DataSources.jsx'
import PortfolioLinks from '../components/PortfolioLinks.jsx'
import '../portfolio.css'

const Donut = lazy(() => import('../../../components/charts/Donut.jsx').then((m) => ({ default: m.Donut })))

/** @param {any} v */
const fmtQty = (v) => fmtNumber(v, { decimals: Number.isInteger(v) ? 0 : 4 })

const COLUMNS = [
  { key: 'symbol', header: 'Clave', sortable: true },
  { key: 'quantity', header: 'Títulos', numeric: true, format: fmtQty },
  { key: 'price', header: 'Precio', numeric: true, format: (/** @type {any} */ v, /** @type {any} */ r) => fmtMoney(v, r.currency) },
  { key: 'changePct', header: 'Hoy', numeric: true, sortable: true, format: (/** @type {any} */ v) => <Delta value={v} /> },
  { key: 'value', header: 'Valor en pesos', numeric: true, sortable: true, format: (/** @type {any} */ v) => fmtMoney(v) },
  { key: 'weight', header: 'Peso', numeric: true, sortable: true, format: (/** @type {any} */ v) => fmtPct(v) },
  {
    key: 'pnl',
    header: 'Resultado',
    numeric: true,
    sortable: true,
    format: (/** @type {any} */ v, /** @type {any} */ r) => (
      <span className="kz-portfolio-pnl">
        <Delta value={v} kind="money" currency={r.pnlCurrency} />
        <Delta value={r.pnlPct} />
      </span>
    ),
  },
]

export default function Summary() {
  const { portfolios, active, actions } = usePortfolios()
  const transactions = useMemo(() => /** @type {any[]} */ (active?.transactions ?? []), [active])
  const symbols = useMemo(() => derivePositions(transactions).map((p) => p.symbol).sort(), [transactions])
  const quotes = useQuery({ ...quotesQuery(symbols), enabled: symbols.length > 0 })
  const needsFx = transactions.some((t) => t.currency === 'USD') || (quotes.data?.quotes ?? []).some((/** @type {any} */ q) => q.currency === 'USD')
  const fx = useQuery({ ...fxQuery(), enabled: needsFx })
  const today = todayMx()
  const view = useMemo(
    () => summarize({ transactions, quotes: quotes.data?.quotes, usdmxn: fx.data?.rate ?? null, today }),
    [transactions, quotes.data, fx.data, today],
  )

  const selector =
    portfolios.length > 1 ? (
      <Select
        label="Portafolio activo"
        value={active?.id ?? ''}
        options={portfolios.map((/** @type {any} */ p) => ({ value: p.id, label: p.name }))}
        onChange={(e) => actions.setActive(e.target.value)}
      />
    ) : undefined
  const header = (
    <PageHeader
      title="Mi portafolio"
      // El nombre por omisión repite el h1 ("MI PORTAFOLIO / Mi portafolio"); solo va si es otro.
      eyebrow={active?.name && active.name.trim().toLowerCase() !== 'mi portafolio' ? active.name : undefined}
      description="Tu portafolio a precios de hoy: cuánto vale en pesos, cómo le va y cómo está repartido."
      actions={selector}
    />
  )

  if (!active) {
    return (
      <div className="kz-container kz-col kz-portfolio-page" data-gap="6">
        {header}
        <EmptyState
          title="Todavía no tienes un portafolio"
          text="Crea uno en la bienvenida: con un ejemplo, importando un CSV o desde cero."
          action={<Link className="kz-button" data-variant="primary" data-size="md" to={PATHS.onboarding}>Ir a la bienvenida</Link>}
        />
      </div>
    )
  }

  const loading = symbols.length > 0 && (quotes.isLoading || (needsFx && fx.isLoading))
  const failed = quotes.isError || fx.isError
  const retry = () => {
    if (quotes.isError) quotes.refetch()
    if (fx.isError) fx.refetch()
  }
  const empty = symbols.length === 0 && !(view.cashMxn && view.cashMxn > 0)
  const sources = (
    <DataSources
      items={[
        { label: 'Cotizaciones', meta: quotes.data?.meta },
        { label: 'Tipo de cambio', meta: fx.data?.meta },
      ]}
    />
  )
  const donutData = [
    ...view.rows.filter((r) => r.value != null && r.value > 0).map((r) => ({ label: r.symbol, value: /** @type {number} */ (r.value) })),
    ...(view.cashMxn && view.cashMxn > 0 ? [{ label: 'Efectivo', value: view.cashMxn }] : []),
  ]

  return (
    <div className="kz-container kz-col kz-portfolio-page" data-gap="6">
      {header}

      {empty ? (
        <EmptyState
          title="Aún no hay posiciones"
          text="Registra tus compras y depósitos en Movimientos, o impórtalos de un CSV."
          action={<Link className="kz-button" data-variant="primary" data-size="md" to={PATHS.portfolioTransactions}>Ir a Movimientos</Link>}
        />
      ) : (
        <>
          <Card title="Resumen" footer={sources}>
            {failed ? (
              <ErrorState message="No pudimos traer las cotizaciones o el tipo de cambio de hoy." onRetry={retry} retrying={quotes.isFetching || fx.isFetching} size="sm" />
            ) : (
              <div className="kz-metric-grid">
                <Stat loading={loading} size="lg" label="Valor total" value={fmtMoney(view.total)} sublabel="Posiciones más efectivo, en pesos" />
                <Stat
                  loading={loading}
                  label="Ganancia no realizada"
                  value={<Delta value={view.unrealized} kind="money" currency="MXN" />}
                  sublabel={view.unrealizedPct != null ? `${fmtPct(view.unrealizedPct, { sign: true })} sobre lo invertido` : undefined}
                  info={{ termKey: 'costo-promedio', term: 'Costo promedio' }}
                />
                <Stat
                  loading={loading}
                  label="Cambio del día"
                  value={<Delta value={view.dayChange} kind="money" currency="MXN" />}
                  sublabel={view.dayChangePct != null ? `${fmtPct(view.dayChangePct, { sign: true })} en tus posiciones` : undefined}
                />
                <Stat loading={loading} label="Efectivo" value={fmtMoney(view.cashMxn)} sublabel={view.cashUsd ? `Incluye ${fmtMoney(view.cashUsd, 'USD')} convertidos a pesos` : 'Lo que no está invertido'} />
              </div>
            )}
            {!failed && !loading && view.unrealizedExcluded > 0 && (
              <p className="kz-portfolio-hint">
                {`La ganancia no realizada deja fuera ${fmtNumber(view.unrealizedExcluded, { decimals: 0 })} ${view.unrealizedExcluded === 1 ? 'posición' : 'posiciones'} sin precio o sin tipo de cambio de compra.`}
              </p>
            )}
          </Card>

          <div className="kz-split">
            <Card title="Posiciones" padding="none" status={quotes.data?.meta} description="Precio de hoy con el retraso de la fuente. El resultado va en la moneda en que compraste cada emisora.">
              <DataTable
                caption="Posiciones a precio de hoy"
                captionHidden
                columns={COLUMNS}
                rows={view.rows}
                rowKey="symbol"
                loading={loading}
                error={failed || undefined}
                onRetry={retry}
                defaultSort={{ key: 'value', direction: 'descending' }}
                empty={{ title: 'Sin posiciones abiertas', text: 'Tu efectivo sigue aquí; registra una compra en Movimientos.' }}
              />
              {view.unquoted.length > 0 && !loading && !failed && (
                <p className="kz-portfolio-note">{`Sin cotización hoy para ${view.unquoted.join(', ')}: no entra al valor total.`}</p>
              )}
              {view.mismatched.length > 0 && (
                <p className="kz-portfolio-note">{`${view.mismatched.join(', ')} ${view.mismatched.length === 1 ? 'cotiza' : 'cotizan'} en otra moneda que la de tus compras (por ejemplo, una emisora del SIC que compraste en pesos), así que su resultado va en pesos: valor de hoy con el tipo de cambio del día contra lo que pagaste en pesos.`}</p>
              )}
            </Card>

            {loading ? (
              <Skeleton height={320} />
            ) : (
              <Suspense fallback={<Skeleton height={320} />}>
                <Donut
                  title="Asignación"
                  titleAs="h2"
                  description="Peso de cada emisora y del efectivo en el valor total, en pesos."
                  data={donutData}
                  centerLabel="Valor total"
                  status={quotes.data?.meta}
                  emptyText="Sin valores para repartir"
                />
              </Suspense>
            )}
          </div>
        </>
      )}

      <PortfolioLinks />
    </div>
  )
}
