// Estado de la BMV y la NYSE y resumen factual del día, los dos de /v2/markets/overview.
import { useQuery } from '@tanstack/react-query'
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '../../../components/ui/index.js'
import { marketsOverviewQuery } from '../../../lib/api/queries.js'
import { EXCHANGES, dailySummary, dedupeMarkets, exchangeTiming, latestAsOf } from '../pages/overview-model.js'
import { ApiNotes } from '../pages/ApiNotes.jsx'
import { useFeature } from './useFeature.js'

function ExchangeTile({ exchange, status, groups, delayMinutes }) {
  const group = groups.find((g) => g.id === exchange.group)
  const t = exchangeTiming(status, { lastAsOf: latestAsOf(group?.items), delayMinutes, tz: exchange.tz })
  return (
    <div className="markets-exchange">
      <div className="markets-exchange__head">
        <div>
          <h3 className="markets-exchange__name">{exchange.name}</h3>
          <p className="markets-exchange__long">{exchange.long}</p>
        </div>
        <Badge tone={t.open ? 'info' : 'neutral'} dot>
          {t.state}
        </Badge>
      </div>
      <p className="markets-exchange__timing">{t.timing}</p>
      {t.detail ? <p className="markets-exchange__detail">{t.detail}</p> : null}
    </div>
  )
}

export function ExchangesCard() {
  const feature = useFeature(['markets.overview'])
  const q = useQuery({ ...marketsOverviewQuery(), enabled: feature.enabled })
  const loading = feature.waiting || (feature.enabled && q.isPending)
  const groups = q.data ? dedupeMarkets({ overview: q.data }).groups : []
  return (
    <Card title="Estado de las bolsas" description="Con la bolsa abierta los precios llegan con retraso; cerrada, son los del último cierre." status={q.data?.meta}>
      {loading ? (
        <div className="kz-col" aria-busy="true">
          <span className="sr-only">Cargando</span>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      ) : null}
      {!loading && !feature.enabled ? <EmptyState size="sm" title="Sin estado de las bolsas" text={feature.reason} /> : null}
      {q.isError ? <ErrorState size="sm" message="No pudimos traer el estado de las bolsas." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}
      {q.data ? (
        <div className="markets-exchanges">
          {Object.values(EXCHANGES).map((ex) => (
            <ExchangeTile key={ex.id} exchange={ex} status={q.data.marketStatus?.[ex.id]} groups={groups} delayMinutes={q.data.meta?.delayMinutes ?? null} />
          ))}
        </div>
      ) : null}
    </Card>
  )
}

export function SummaryCard() {
  const feature = useFeature(['markets.overview'])
  const q = useQuery({ ...marketsOverviewQuery(), enabled: feature.enabled })
  const loading = feature.waiting || (feature.enabled && q.isPending)
  const lines = q.data ? dailySummary({ groups: dedupeMarkets({ overview: q.data }).groups, marketStatus: q.data.marketStatus }) : []
  return (
    <Card
      title="Resumen del día"
      description="Qué subió, qué bajó y cuánto, contra el cierre anterior. Solo cifras: sin opiniones ni causas."
      status={q.data?.meta}
    >
      {loading ? (
        <div aria-busy="true">
          <span className="sr-only">Cargando</span>
          <Skeleton lines={4} />
        </div>
      ) : null}
      {!loading && !feature.enabled ? <EmptyState size="sm" title="Sin resumen por ahora" text={feature.reason} /> : null}
      {q.isError ? <ErrorState size="sm" message="No pudimos traer las cifras del día." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}
      {q.data && !lines.length ? <EmptyState size="sm" title="Sin cifras para resumir" text="El servidor no trajo precios en esta actualización." /> : null}
      {lines.length ? (
        <ul className="markets-summary">
          {lines.map((l) => (
            <li key={l.id}>{l.text}</li>
          ))}
        </ul>
      ) : null}
      {q.data ? <ApiNotes meta={q.data.meta} label="Avisos del panorama" /> : null}
    </Card>
  )
}
