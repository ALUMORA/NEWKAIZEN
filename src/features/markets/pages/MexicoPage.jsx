// /mercados/mexico: tasas de México y de EE. UU. en vivo, cada dato con su fuente y su fecha.
import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, Delta, EmptyState, ErrorState, PageHeader, Skeleton, Stat } from '../../../components/ui/index.js'
import { fxQuery, macroUsQuery, ratesMxQuery, riskFreeQuery } from '../../../lib/api/queries.js'
import { fmtNumber } from '../../../lib/format.js'
import { fmtByUnit, itemStatus, termFor } from './shared.js'
import { ApiNotes } from './ApiNotes.jsx'
import '../markets.css'

const TimeSeries = lazy(() => import('../../../components/charts/TimeSeries.jsx').then((m) => ({ default: m.TimeSeries })))

function LoadingGrid({ count = 6 }) {
  return (
    <div className="markets-grid" aria-busy="true">
      <span className="sr-only">Cargando</span>
      {Array.from({ length: count }, (_, i) => (
        <Stat key={i} label="Cargando" loading />
      ))}
    </div>
  )
}

function rateDelta(item) {
  if (item.changeBp == null) return null
  return <Delta value={item.changeBp} kind="bp" direction="neutral" hint="contra el dato anterior" />
}

function MexicoRates() {
  const rates = useQuery(ratesMxQuery())
  const fx = useQuery(fxQuery('USDMXN'))
  const meta = rates.data?.meta
  return (
    <Card title="México" description="Tasa objetivo de Banxico, TIIE, CETES, inflación, UDI y tipo de cambio FIX." status={meta}>
      {rates.isPending ? <LoadingGrid /> : null}
      {rates.isError ? <ErrorState message="No pudimos traer las tasas de Banxico." onRetry={() => rates.refetch()} retrying={rates.isFetching} /> : null}
      {rates.data ? (
        rates.data.items.length ? (
          <div className="kz-col" data-gap="md">
            <div className="markets-grid">
              {rates.data.items.map((item) => (
                <Stat
                  key={item.id}
                  label={item.label}
                  value={fmtByUnit(item.value, item.unit)}
                  delta={item.unit === 'fraction' ? rateDelta(item) : null}
                  info={termFor(item.id) ? { termKey: termFor(item.id), term: item.label } : undefined}
                  status={itemStatus(item, meta)}
                  sublabel={item.seriesId ? `Serie ${item.seriesId}` : undefined}
                />
              ))}
              {fx.isPending ? <Stat label="Dólar FIX" loading /> : null}
              {fx.data ? (
                <Stat
                  label="Dólar FIX"
                  value={fmtNumber(fx.data.rate, { decimals: 4 })}
                  sublabel="Pesos por dólar. Si sube, el peso está más débil."
                  info={{ termKey: 'tipo-de-cambio-fix', term: 'Dólar FIX' }}
                  status={{ ...itemStatus(fx.data, fx.data.meta), stale: Boolean(fx.data.stale || fx.data.meta?.stale) }}
                />
              ) : null}
            </div>
            {fx.isError ? <ErrorState size="sm" message="No pudimos traer el tipo de cambio." onRetry={() => fx.refetch()} /> : null}
            <ApiNotes meta={meta} label="Avisos de Banxico" />
            {fx.data ? <ApiNotes meta={fx.data.meta} label="Avisos del tipo de cambio" /> : null}
          </div>
        ) : (
          <EmptyState title="Sin tasas por ahora" text="Banxico no devolvió series. Intenta más tarde." />
        )
      ) : null}
    </Card>
  )
}

function UsRates() {
  const q = useQuery(macroUsQuery())
  const meta = q.data?.meta
  return (
    <Card title="Estados Unidos" description="Bonos del Tesoro, diferenciales, VIX y dólar global. Los cambios de tasas van en puntos base." status={meta}>
      {q.isPending ? <LoadingGrid count={4} /> : null}
      {q.isError ? <ErrorState message="No pudimos traer las tasas de EE. UU." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}
      {q.data ? (
        q.data.items.length ? (
          <div className="kz-col" data-gap="md">
            <div className="markets-grid">
              {q.data.items.map((item) => (
                <Stat
                  key={item.id}
                  label={item.label}
                  value={fmtByUnit(item.value, item.unit)}
                  delta={
                    item.changeBp != null ? (
                      <Delta value={item.changeBp} kind="bp" direction="neutral" hint="contra el dato anterior" />
                    ) : item.change != null ? (
                      <Delta value={item.change} kind="number" direction="neutral" hint="contra el dato anterior" />
                    ) : null
                  }
                  info={termFor(item.id) ? { termKey: termFor(item.id), term: item.label } : undefined}
                  status={itemStatus(item, meta)}
                />
              ))}
            </div>
            <ApiNotes meta={meta} label="Avisos de la fuente" />
          </div>
        ) : (
          <EmptyState title="Sin datos de EE. UU. por ahora" />
        )
      ) : null}
    </Card>
  )
}

function RiskFreeChart() {
  const q = useQuery(riskFreeQuery({ tenorDays: 28 }))
  if (q.isPending) return <Card title="CETES 28 días en el tiempo"><Skeleton height={280} /><span className="sr-only">Cargando</span></Card>
  if (q.isError) return <Card title="CETES 28 días en el tiempo"><ErrorState message="No pudimos traer la serie de CETES." onRetry={() => q.refetch()} /></Card>
  const d = q.data
  const points = d.dates.map((date, i) => ({ date, value: d.values[i] ?? null }))
  if (points.length < 2) return <Card title="CETES 28 días en el tiempo"><EmptyState title="Todavía no hay historia suficiente" /></Card>
  return (
    <div className="kz-col" data-gap="sm">
      <Suspense fallback={<Skeleton height={280} />}>
        <TimeSeries
          title="CETES 28 días en el tiempo"
          titleAs="h2"
          description="Rendimiento anual simple de la subasta, la tasa libre de riesgo para quien invierte en pesos."
          series={[{ id: 'rf', label: 'CETES 28 días', points }]}
          format="pct"
          status={{ ...d.meta, fallback: Boolean(d.fallback || d.meta?.fallback) }}
          source={d.source}
        />
      </Suspense>
      {d.fallback ? <ApiNotes meta={{ ...d.meta, fallback: true, source: d.source }} label="Avisos de la serie" /> : <ApiNotes meta={d.meta} label="Avisos de la serie" />}
    </div>
  )
}

export default function MexicoPage() {
  return (
    <div className="markets-page">
      <PageHeader
        eyebrow="Mercados"
        title="México: tasas, CETES e inflación"
        description="Datos oficiales con su fuente y su fecha. Si alguno viene de respaldo o está viejo, lo verás marcado."
        breadcrumbs={[{ label: 'Mercados', to: '/mercados' }, { label: 'México' }]}
      />
      <MexicoRates />
      <RiskFreeChart />
      <UsRates />
      <p className="markets-formula">
        Esta página informa, no recomienda comprar ni vender nada.
      </p>
    </div>
  )
}
