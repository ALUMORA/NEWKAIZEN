// VIX con su percentil de cinco años: reemplaza al "Miedo y codicia" del legado. El nivel sale del
// panorama (o de /v2/macro/us si el panorama no lo trae) y la historia de /v2/history/^VIX.
import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, Delta, EmptyState, ErrorState, Skeleton, Stat } from '../../../components/ui/index.js'
import { historyQuery, macroUsQuery, marketsOverviewQuery } from '../../../lib/api/queries.js'
import { fmtDate, fmtInt, fmtNumber, fmtPct } from '../../../lib/format.js'
import { VIX_SYMBOL, pickVix } from '../pages/overview-model.js'
import { VIX_WINDOW, percentileNumber, quartileText, vixContext } from '../pages/vix-percentile.js'
import { ApiNotes } from '../pages/ApiNotes.jsx'
import { useFeature } from './useFeature.js'

const TimeSeries = lazy(() => import('../../../components/charts/TimeSeries.jsx').then((m) => ({ default: m.TimeSeries })))

/** Barra de 0 a 100 con el percentil marcado. Decorativa: el texto de al lado dice lo mismo. */
function Gauge({ rank }) {
  const pos = `${Math.min(100, Math.max(0, rank * 100))}%`
  return (
    <div className="markets-gauge" aria-hidden="true">
      <div className="markets-gauge__track">
        <div className="markets-gauge__fill" style={{ width: pos }} />
        {[25, 50, 75].map((t) => (
          <span key={t} className="markets-gauge__tick" style={{ left: `${t}%` }} />
        ))}
        <span className="markets-gauge__marker" style={{ left: pos }} />
      </div>
      <div className="markets-gauge__scale">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
    </div>
  )
}

function Percentile({ ctx, history }) {
  const pctl = percentileNumber(ctx.rank)
  const band = history.dates.map((date) => ({ date, lower: ctx.p25, upper: ctx.p75 }))
  const points = history.dates.map((date, i) => ({ date, value: history.close[i] ?? null }))
  return (
    <div className="kz-col">
      <div className="markets-vix__pctl">
        <p className="markets-vix__big">
          Percentil <span className="num">{fmtInt(pctl)}</span>
        </p>
        <p>
          El {fmtPct(ctx.rank, { decimals: 0 })} de los cierres diarios de los últimos {VIX_WINDOW.years} años quedó en este nivel o más abajo. Está{' '}
          {quartileText(ctx.rank)}.
        </p>
      </div>
      <Gauge rank={ctx.rank} />
      <dl className="markets-vix__stats">
        <div>
          <dt>Mínimo</dt>
          <dd className="num">{fmtNumber(ctx.min, { decimals: 2 })}</dd>
        </div>
        <div>
          <dt>Percentil 25</dt>
          <dd className="num">{fmtNumber(ctx.p25, { decimals: 2 })}</dd>
        </div>
        <div>
          <dt>Mediana</dt>
          <dd className="num">{fmtNumber(ctx.p50, { decimals: 2 })}</dd>
        </div>
        <div>
          <dt>Percentil 75</dt>
          <dd className="num">{fmtNumber(ctx.p75, { decimals: 2 })}</dd>
        </div>
        <div>
          <dt>Máximo</dt>
          <dd className="num">{fmtNumber(ctx.max, { decimals: 2 })}</dd>
        </div>
      </dl>
      <Suspense fallback={<Skeleton height={220} />}>
        <TimeSeries
          title="VIX, cierres diarios de cinco años"
          titleAs="h3"
          description="La franja marca la mitad central de la historia, del percentil 25 al 75."
          series={[{ id: 'vix', label: 'VIX', points }]}
          bands={[{ id: 'iqr', label: 'Percentil 25 a 75', points: band }]}
          height={220}
          status={history.meta}
          source="Yahoo Finance, símbolo ^VIX"
        />
      </Suspense>
      <p className="markets-formula">
        Cómo se calcula: contamos cuántos de los {fmtInt(ctx.n)} cierres diarios del {fmtDate(ctx.from)} al {fmtDate(ctx.to)} quedaron en el nivel de hoy o
        por debajo, y lo dividimos entre el total. No es un pronóstico ni una recomendación: solo dice dónde queda el VIX de hoy contra su propia historia.
      </p>
    </div>
  )
}

export function VixCard() {
  const overviewFeature = useFeature(['markets.overview'])
  const macroFeature = useFeature(['macro.us'])
  const historyFeature = useFeature(['history', 'history.dates'])
  const overview = useQuery({ ...marketsOverviewQuery(), enabled: overviewFeature.enabled })
  const macro = useQuery({ ...macroUsQuery(), enabled: macroFeature.enabled })
  const vix = pickVix(overview.data, macro.data)
  // La historia solo se pide cuando hay un nivel de hoy que comparar.
  const history = useQuery({ ...historyQuery(VIX_SYMBOL, { range: VIX_WINDOW.range, interval: VIX_WINDOW.interval }), enabled: historyFeature.enabled && vix !== null })
  const levelPending =
    !vix && (overviewFeature.waiting || macroFeature.waiting || (overviewFeature.enabled && overview.isPending) || (macroFeature.enabled && macro.isPending))
  const ctx = vix && history.data ? vixContext(history.data, vix.value) : null
  const status = vix ? { asOf: vix.asOf, source: vix.source, delayMinutes: vix.delayMinutes, stale: vix.stale, fallback: vix.fallback } : undefined
  return (
    <Card
      title="VIX y su percentil"
      info={{ termKey: 'vix', term: 'VIX' }}
      description="La volatilidad que esperan las opciones del S&P 500, comparada con sus propios cierres de cinco años."
      status={status}
    >
      {levelPending ? (
        <div aria-busy="true">
          <span className="sr-only">Cargando</span>
          <Skeleton height={96} />
        </div>
      ) : null}
      {!levelPending && !vix ? <EmptyState size="sm" title="Sin valor del VIX por ahora" text="Ni el panorama ni las tasas de EE. UU. trajeron el VIX en esta actualización." /> : null}
      {vix ? (
        <div className="kz-col">
          <Stat
            size="lg"
            label="VIX"
            value={fmtNumber(vix.value, { decimals: 2 })}
            delta={vix.change != null ? <Delta value={vix.change} kind="number" direction="neutral" hint="puntos contra el cierre anterior" /> : null}
            sublabel={vix.from === 'overview' ? 'Nivel más reciente del panorama.' : 'Último cierre publicado por la fuente de tasas de EE. UU.'}
          />
          {!historyFeature.enabled && !historyFeature.waiting ? <EmptyState size="sm" title="Sin percentil por ahora" text={historyFeature.reason} /> : null}
          {historyFeature.waiting || (historyFeature.enabled && history.isPending) ? (
            <div aria-busy="true">
              <span className="sr-only">Cargando la historia del VIX</span>
              <Skeleton height={120} />
            </div>
          ) : null}
          {history.isError ? (
            <ErrorState size="sm" message="No pudimos traer la historia del VIX para calcular su percentil." onRetry={() => history.refetch()} retrying={history.isFetching} />
          ) : null}
          {history.data && !ctx ? <EmptyState size="sm" title="Sin percentil por ahora" text="La historia del VIX no trae cierres suficientes para compararlo." /> : null}
          {ctx && history.data ? <Percentile ctx={ctx} history={history.data} /> : null}
          {history.data ? <ApiNotes meta={history.data.meta} label="Avisos de la historia del VIX" /> : null}
        </div>
      ) : null}
    </Card>
  )
}
