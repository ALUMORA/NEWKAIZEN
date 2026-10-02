// Monitor del peso (V5FX): FIX con su cambio en centavos, rango de 52 semanas, volatilidad, historia
// por horizonte, histograma de movimientos diarios, cruces, promedios mensuales y posicionamiento
// CFTC. Cada bloque pide su endpoint solo si /health anuncia la capacidad.
import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ApiNotes, Badge, Card, DataTable, Delta, EmptyState, ErrorState, PageHeader, SegmentedControl, Skeleton, Stat,
} from '../../../components/ui/index.js'
import { TimeSeries } from '../../../components/charts/TimeSeries.jsx'
import { Bars } from '../../../components/charts/Bars.jsx'
import { fxCrossesQuery, fxMonitorQuery } from '../../../lib/api/queries.js'
import { useFeature } from '../../../lib/api/useFeature.js'
import { PATHS } from '../../../app/paths.js'
import { fmtDate, fmtInt, fmtNumber, fmtPct } from '../../../lib/format.js'
import { PAIR_LABEL, PROVIDER_LABEL, fmtCents, fmtContracts, fmtMonth, fmtRate, pesoHint } from '../lib/labels.js'
import '../fx.css'

const YEARS = [
  { value: '1', label: '1 año' },
  { value: '3', label: '3 años' },
  { value: '5', label: '5 años' },
  { value: '10', label: '10 años' },
]

const PERIODS = [
  { key: 'd1', label: 'Un día' },
  { key: 'w1', label: 'Una semana' },
  { key: 'm1', label: 'Un mes' },
  { key: 'ytd', label: 'En el año' },
  { key: 'y1', label: '12 meses' },
]

/** @typedef {import('../types.js').FxMonitorResponse} FxMonitorResponse */
/** @typedef {import('../types.js').FxCrossesResponse} FxCrossesResponse */

function Unavailable({ feature, title }) {
  return <EmptyState size="sm" title={title} text={feature.reason} />
}

export default function FxMonitorPage() {
  const feature = useFeature(['fxdesk'])
  const crossesFeature = useFeature(['fxdesk.crosses'])
  const [years, setYears] = useState('1')
  const q = useQuery({ ...fxMonitorQuery({ years: /** @type {1 | 3 | 5 | 10} */ (Number(years)) }), enabled: feature.enabled, placeholderData: keepPreviousData })
  const crosses = useQuery({ ...fxCrossesQuery(), enabled: crossesFeature.enabled })
  /** @type {FxMonitorResponse | undefined} */
  const data = q.data
  /** @type {FxCrossesResponse | undefined} */
  const crossData = crosses.data
  const loading = feature.waiting || (feature.enabled && q.isPending)
  const meta = data?.meta

  return (
    <div className="kz-page kz-col fx-page" data-gap="6">
      <PageHeader
        eyebrow="Mercados"
        title="Tipo de cambio"
        description="El peso frente al dólar con el FIX de Banxico: rango de 52 semanas, volatilidad, promedios mensuales y cruces con otras monedas."
        breadcrumbs={[{ label: 'Mercados', to: PATHS.markets }, { label: 'Tipo de cambio' }]}
      />

      {!loading && !feature.enabled ? <Unavailable feature={feature} title="El monitor del peso no está disponible" /> : null}
      {q.isError && !data ? <ErrorState message="No pudimos traer el tipo de cambio." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}

      {loading || data ? <Headline data={data} loading={loading} /> : null}

      {loading || data ? (
        <Card title="Historia del FIX" description="Pesos por dólar, FIX diario de Banxico." status={meta}>
          <div className="kz-col" data-gap="4">
            <SegmentedControl label="Horizonte" items={YEARS} value={years} onChange={setYears} />
            <div className="fx-chart-slot" aria-busy={loading || (q.isFetching && q.isPlaceholderData) || undefined}>
              {data ? (
                <TimeSeries
                  title={`FIX de los últimos ${years === '1' ? '12 meses' : `${years} años`}`}
                  titleAs="h3"
                  format="money"
                  decimals={4}
                  series={[{ id: 'fix', label: 'FIX', points: data.series.dates.map((date, i) => ({ date, value: data.series.values[i] })) }]}
                  source="Banxico, serie SF43718"
                />
              ) : (
                <Skeleton height={340} />
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {loading || data ? (
        <div className="fx-grid-2">
          <Card title="Cambios por periodo" padding="none">
            {data ? (
              <DataTable
                caption="Cambios del dólar frente al peso"
                captionHidden
                rowKey="key"
                rows={PERIODS.map((p) => ({ key: p.key, label: p.label, pct: data.changes[p.key], cents: data.changesCents[p.key] }))}
                columns={[
                  { key: 'label', header: 'Periodo' },
                  { key: 'pct', header: 'Cambio', numeric: true, format: (v) => fmtPct(v, { sign: true }) },
                  { key: 'cents', header: 'En centavos', numeric: true, format: (v) => fmtCents(v) },
                ]}
              />
            ) : (
              <div className="fx-table-slot"><DataTable caption="Cambios del dólar frente al peso" captionHidden rowKey="key" rows={[]} columns={[{ key: 'label', header: 'Periodo' }]} loading /></div>
            )}
          </Card>
          <Card title="Volatilidad realizada" description="Desviación de los rendimientos diarios, anualizada con raíz de 252 días.">
            <div className="kz-metric-grid">
              <Stat label="20 días" value={data ? fmtPct(data.realizedVol.d20) : undefined} loading={!data} />
              <Stat label="60 días" value={data ? fmtPct(data.realizedVol.d60) : undefined} loading={!data} />
              <Stat label="250 días" value={data ? fmtPct(data.realizedVol.d250) : undefined} loading={!data} />
            </div>
          </Card>
        </div>
      ) : null}

      {loading || data ? (
        <Card title="Movimientos diarios" description="Cuántos días el FIX se movió dentro de cada rango, en el horizonte elegido.">
          <div className="fx-chart-slot fx-chart-slot--bars">
            {data ? (
              <Bars
                title="Histograma de movimientos diarios"
                titleAs="h3"
                orientation="vertical"
                data={data.histogram.map((b) => ({ label: `${fmtPct(b.low, { decimals: 1 })} a ${fmtPct(b.high, { decimals: 1 })}`, value: b.count }))}
                format="number"
                decimals={0}
                categoryLabel="Movimiento diario"
                valueLabel="Días"
              />
            ) : (
              <Skeleton height={300} />
            )}
          </div>
        </Card>
      ) : null}

      <CrossesCard feature={crossesFeature} query={crosses} data={crossData} />

      {loading || data ? (
        <div className="fx-grid-2">
          <Card title="Promedios mensuales" description="FIX promedio, mínimo, máximo y último de cada mes." padding="none">
            <DataTable
              caption="Promedios mensuales del FIX"
              captionHidden
              rowKey="month"
              loading={!data}
              maxHeight={420}
              defaultSort={{ key: 'month', direction: 'descending' }}
              rows={data?.monthly ?? []}
              columns={[
                { key: 'month', header: 'Mes', format: (v) => fmtMonth(v), sortable: true },
                { key: 'average', header: 'Promedio', numeric: true, format: (v) => fmtRate(v) },
                { key: 'min', header: 'Mínimo', numeric: true, format: (v) => fmtRate(v) },
                { key: 'max', header: 'Máximo', numeric: true, format: (v) => fmtRate(v) },
                { key: 'last', header: 'Último', numeric: true, format: (v) => fmtRate(v) },
              ]}
              empty={{ title: 'Sin promedios mensuales', text: 'La fuente no devolvió meses para este horizonte.' }}
            />
          </Card>
          <CotCard data={data} />
        </div>
      ) : null}

      {data ? <ApiNotes meta={meta} label="Avisos del tipo de cambio" /> : null}
    </div>
  )
}

/** @param {{ data: FxMonitorResponse | undefined, loading: boolean }} props */
function Headline({ data, loading }) {
  const spotStatus = data ? { ...data.meta, asOf: data.spot.asOf } : undefined
  const cents = data?.changesCents.d1
  return (
    <section aria-label="Resumen del FIX" className="kz-metric-grid fx-headline">
      <Stat
        size="lg"
        label="FIX, pesos por dólar"
        value={data ? fmtRate(data.spot.value) : undefined}
        loading={loading && !data}
        status={spotStatus}
        delta={data ? <Delta value={cents} kind="number" decimals={2} direction="neutral" hint={`centavos, ${pesoHint(cents)}`} /> : undefined}
        sublabel={data ? `Banxico, ${fmtDate(data.spot.asOf)}` : undefined}
      />
      <Stat
        label="Rango de 52 semanas"
        value={data ? `${fmtRate(data.range52w.low)} a ${fmtRate(data.range52w.high)}` : undefined}
        loading={loading && !data}
        sublabel={data ? `Percentil ${fmtPct(data.range52w.percentile, { decimals: 0 })}: días en o por debajo del FIX de hoy` : undefined}
        info={{ text: 'El percentil es la fracción de los días de las últimas 52 semanas en que el FIX cerró en el nivel de hoy o por debajo.', term: 'Percentil de 52 semanas' }}
      />
      <Stat
        label="Cambio en 12 meses"
        value={data ? fmtPct(data.changes.y1, { sign: true }) : undefined}
        loading={loading && !data}
        sublabel={data ? fmtCents(data.changesCents.y1) : undefined}
      />
    </section>
  )
}

function CrossesCard({ feature, query, data }) {
  const loading = feature.waiting || (feature.enabled && query.isPending)
  const anyFallback = data?.rows.some((r) => r.fallback)
  return (
    <Card
      title="Cruces contra el peso"
      description="Pesos por unidad de cada moneda: la canasta del SIE de Banxico y monedas latinoamericanas."
      status={data?.meta}
      padding="none"
    >
      {!loading && !feature.enabled ? <div className="kz-col fx-pad"><Unavailable feature={feature} title="Sin cruces por ahora" /></div> : null}
      {query.isError ? <ErrorState size="sm" message="No pudimos traer los cruces." onRetry={() => query.refetch()} retrying={query.isFetching} /> : null}
      {loading || data ? (
        <DataTable
          caption="Cruces contra el peso"
          captionHidden
          rowKey="pair"
          loading={loading}
          loadingRows={10}
          rows={data?.rows ?? []}
          columns={[
            { key: 'pair', header: 'Moneda', format: (v) => <span><span>{PAIR_LABEL[v] ?? v}</span> <span className="kz-missing">{v}</span></span> },
            { key: 'value', header: 'Pesos por unidad', numeric: true, format: (v) => fmtNumber(v, { decimals: v != null && v < 0.1 ? 6 : 4 }) },
            { key: 'change1d', header: 'Un día', numeric: true, format: (v) => fmtPct(v, { sign: true }) },
            { key: 'change1y', header: '12 meses', numeric: true, format: (v) => fmtPct(v, { sign: true }) },
            { key: 'asOf', header: 'Fecha', format: (v) => fmtDate(v) },
            {
              key: 'provider',
              header: 'Fuente',
              format: (v, row) => (
                <span className="fx-cell-source">
                  <span>{PROVIDER_LABEL[v] ?? v}</span>
                  {row.fallback ? <Badge tone="warning">respaldo</Badge> : null}
                </span>
              ),
            },
          ]}
          empty={{ title: 'Sin cruces', text: 'La fuente no devolvió monedas en esta actualización.' }}
        />
      ) : null}
      {data ? (
        <div className="kz-col fx-pad" data-gap="2">
          {anyFallback ? <p className="fx-note">Los renglones con la marca respaldo no vienen del SIE de Banxico: son la referencia de otra fuente y no el dato oficial.</p> : null}
          <p className="fx-note">El BCE y la mezcla de bancos centrales publican referencias distintas del FIX; cada renglón dice de dónde viene.</p>
          <ApiNotes meta={data.meta} label="Avisos de los cruces" />
        </div>
      ) : null}
    </Card>
  )
}

/** @param {{ data: FxMonitorResponse | undefined }} props */
function CotCard({ data }) {
  const cot = data?.cot
  const bars = useMemo(
    () =>
      cot
        ? [
            { label: 'No comerciales', value: cot.nonCommercialNet },
            { label: 'Fondos apalancados', value: cot.leveragedNet },
            { label: 'Administradores de activos', value: cot.assetManagerNet },
          ]
        : [],
    [cot],
  )
  return (
    <Card
      title="Posicionamiento CFTC"
      description="Contratos netos del peso en CME (contrato 095741). Positivo: más contratos largos que cortos en el peso."
      info={{ text: 'El reporte Commitments of Traders de la CFTC cuenta las posiciones abiertas en futuros del peso cada martes y se publica el viernes.', term: 'Posicionamiento CFTC' }}
    >
      {!data ? <Skeleton height={260} /> : null}
      {data && !cot ? <EmptyState size="sm" title="s/d" text="La CFTC no devolvió el reporte del peso en esta actualización." /> : null}
      {cot ? (
        <div className="kz-col" data-gap="4">
          <div className="kz-metric-grid">
            <Stat label="Netos no comerciales" value={fmtContracts(cot.nonCommercialNet)} sublabel={`Cambio en la semana: ${fmtContracts(cot.nonCommercialNetChange)}`} />
            <Stat label="Interés abierto" value={fmtInt(cot.openInterest)} sublabel={`Reporte del ${fmtDate(cot.reportDate)}`} />
          </div>
          <Bars title="Contratos netos por tipo de participante" titleAs="h3" data={bars} signed decimals={0} categoryLabel="Participante" valueLabel="Contratos netos" source="CFTC" />
        </div>
      ) : null}
    </Card>
  )
}
