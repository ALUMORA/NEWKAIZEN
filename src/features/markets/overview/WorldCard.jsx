// Variación por país con el ETF de cada uno en dólares (/v2/markets/world). El método viene del API
// y se muestra tal cual, porque incluye el movimiento de la moneda local frente al dólar.
import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, EmptyState, ErrorState, Skeleton } from '../../../components/ui/index.js'
import { marketsOverviewQuery, marketsWorldQuery } from '../../../lib/api/queries.js'
import { dedupeMarkets } from '../pages/overview-model.js'
import { ApiNotes } from '../pages/ApiNotes.jsx'
import { useFeature } from './useFeature.js'

const Bars = lazy(() => import('../../../components/charts/Bars.jsx').then((m) => ({ default: m.Bars })))

export function WorldCard() {
  const feature = useFeature(['markets.world'])
  const overviewFeature = useFeature(['markets.overview'])
  const q = useQuery({ ...marketsWorldQuery(), enabled: feature.enabled })
  const overview = useQuery({ ...marketsOverviewQuery(), enabled: overviewFeature.enabled })
  const loading = feature.waiting || (feature.enabled && q.isPending)
  const items = q.data ? dedupeMarkets({ overview: overview.data, world: q.data }).world : []
  const withData = items.filter((it) => typeof it.changePct === 'number')
  const withoutData = items.filter((it) => typeof it.changePct !== 'number').map((it) => it.label)
  const data = [...withData].sort((a, b) => b.changePct - a.changePct).map((it) => ({ label: it.label, value: it.changePct }))
  return (
    <Card title="El mundo en dólares" description="Cambio del día por país, medido con un fondo cotizado (ETF) de cada uno." status={q.data?.meta}>
      {loading ? (
        <div aria-busy="true">
          <span className="sr-only">Cargando</span>
          <Skeleton height={240} />
        </div>
      ) : null}
      {!loading && !feature.enabled ? <EmptyState size="sm" title="Sin datos por país" text={feature.reason} /> : null}
      {q.isError ? <ErrorState size="sm" message="No pudimos traer los datos por país." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}
      {q.data && !data.length ? <EmptyState size="sm" title="Sin datos por país por ahora" text="El servidor no trajo cambios por país en esta actualización." /> : null}
      {data.length ? (
        <div className="kz-col">
          <Suspense fallback={<Skeleton height={240} />}>
            <Bars
              title="Cambio del día por país, en dólares"
              titleAs="h3"
              data={data}
              signed
              format="pct"
              decimals={2}
              categoryLabel="País"
              valueLabel="Cambio en dólares"
              status={q.data?.meta}
              source="Yahoo Finance, ETF por país"
            />
          </Suspense>
          {q.data?.method ? <p className="markets-formula">Método: {q.data.method}</p> : null}
          {withoutData.length ? <p className="markets-formula">Sin dato en esta actualización: {withoutData.join(', ')}.</p> : null}
        </div>
      ) : null}
      {q.data ? <ApiNotes meta={q.data.meta} label="Avisos de los datos por país" /> : null}
    </Card>
  )
}
