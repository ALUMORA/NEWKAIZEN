// /mercados/economia: indicadores de México o EE. UU. con su último dato, su cambio anual, su
// historia de 5 años y la próxima publicación, más un comparador de países del Banco Mundial.
import { lazy, Suspense, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ApiNotes, Button, Card, DataTable, Delta, EmptyState, ErrorState, InfoTip, PageHeader, SegmentedControl, Skeleton, Stat } from '../../../components/ui/index.js'
import { Sparkline } from '../../../components/charts/Sparkline.jsx'
import { macroIndicatorsQuery, macroWorldQuery } from '../../../lib/api/queries.js'
import { useFeature } from '../../../lib/api/useFeature.js'
import { fmtDate } from '../../../lib/format.js'
import { PATHS } from '../../../app/paths.js'
import { chartFormat, fmtIndicator, fmtWorld, unitNote } from '../lib/model.js'
import '../economy.css'

const TimeSeries = lazy(() => import('../../../components/charts/TimeSeries.jsx').then((m) => ({ default: m.TimeSeries })))
const Bars = lazy(() => import('../../../components/charts/Bars.jsx').then((m) => ({ default: m.Bars })))

const COUNTRY_ITEMS = [
  { value: 'mx', label: 'México' },
  { value: 'us', label: 'EE. UU.' },
]
const TERMS = { inflation: 'inpc', coreInflation: 'inflacion-subyacente', pceCore: 'pce-subyacente', payrolls: 'nomina-no-agricola', remittances: 'remesas' }
const SOURCE_LABEL = { banxico: 'Banxico', fred: 'FRED', 'fred,computed': 'FRED, cálculo propio' }
const INEGI_TIP = 'Requiere un token gratuito de INEGI que el dueño de Kaizen puede sacar. Mientras no exista, el dato se muestra s/d.'
const INEGI_MISSING = [
  { id: 'igae', label: 'Actividad económica (IGAE)' },
  { id: 'imss', label: 'Empleo formal IMSS' },
  { id: 'inpc-q', label: 'Inflación quincenal' },
]
const WORLD_ITEMS = [
  { value: 'gdpUsd', label: 'PIB en dólares' },
  { value: 'gdpGrowth', label: 'Crecimiento' },
  { value: 'inflation', label: 'Inflación' },
  { value: 'debt', label: 'Deuda pública' },
]

/** @param {{ item: import('../types.js').MacroIndicator, selected: boolean, onOpen: () => void }} props */
function IndicatorTile({ item, selected, onOpen }) {
  const n = item.history.values.length
  const delta =
    item.kind === 'rate'
      ? item.changeYoYBp != null ? <Delta value={item.changeYoYBp} kind="bp" direction="neutral" hint="contra hace un año" /> : null
      : item.changeYoY != null ? <Delta value={item.changeYoY} kind="pct" direction="neutral" hint="contra hace un año" /> : null
  const term = TERMS[item.id]
  return (
    <Card padding="md">
      <div className="econ-tile">
        <Stat
          label={item.label}
          value={fmtIndicator(item.last?.value, item.unit)}
          delta={delta}
          sublabel={[unitNote(item.unit), item.last ? `dato de ${fmtDate(item.last.date)}` : 'sin dato'].filter(Boolean).join(', ')}
          info={term ? { termKey: term, term: item.label } : undefined}
          status={{ asOf: item.last?.date ?? null, source: SOURCE_LABEL[item.source] ?? item.source, delayMinutes: null, stale: item.stale, fallback: item.fallback }}
        />
        <Sparkline values={item.history.values} width={220} height={32} label={`Historia de ${item.label}: ${n} datos`} />
        <div className="econ-tile__foot">
          <span>Próxima publicación: {item.nextRelease ? fmtDate(item.nextRelease) : 's/d'}</span>
          <Button variant={selected ? 'primary' : 'ghost'} size="sm" onClick={onOpen} disabled={n < 2} aria-pressed={selected}>
            {selected ? 'Viendo historia' : 'Ver historia'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function Detail({ item }) {
  if (!item) return null
  const points = item.history.dates.map((date, i) => ({ date, value: item.history.values[i] ?? null }))
  return (
    <div className="econ-detail-slot">
      <Suspense fallback={<Skeleton height={340} />}>
        <TimeSeries
          title={`${item.label} en el tiempo`}
          titleAs="h2"
          description={`Serie ${item.seriesId}. ${unitNote(item.unit) ? `En ${unitNote(item.unit)}.` : ''}`}
          series={[{ id: item.id, label: item.label, points }]}
          format={chartFormat(item.unit)}
          currency="USD"
          status={{ asOf: item.last?.date ?? null, source: SOURCE_LABEL[item.source] ?? item.source, delayMinutes: null, stale: item.stale, fallback: item.fallback }}
          source={SOURCE_LABEL[item.source] ?? item.source}
          height={300}
        />
      </Suspense>
    </div>
  )
}

function Indicators({ country }) {
  const feature = useFeature(['macro.indicators'])
  const q = useQuery({ ...macroIndicatorsQuery({ country, years: 5 }), enabled: feature.enabled })
  const [open, setOpen] = useState(/** @type {string | null} */ (null))
  const loading = feature.waiting || (feature.enabled && q.isPending)
  const items = q.data?.indicators ?? []
  const selected = items.find((i) => i.id === open) ?? null
  return (
    <section className="kz-col" data-gap="4" aria-labelledby="econ-indicadores">
      <h2 id="econ-indicadores" className="kz-sr-only sr-only">Indicadores</h2>
      <div className="econ-grid-slot">
        {loading ? (
          <div className="econ-grid" aria-busy="true">
            <span className="sr-only">Cargando</span>
            {Array.from({ length: 6 }, (_, i) => (
              <Card key={i}><Stat label="Cargando" loading /><Skeleton height={60} /></Card>
            ))}
          </div>
        ) : null}
        {!feature.enabled && !feature.waiting ? <EmptyState title="Tablero no disponible" text={feature.reason} /> : null}
        {q.isError ? <ErrorState message="No pudimos traer los indicadores." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}
        {q.data ? (
          <div className="econ-grid">
            {items.map((item) => (
              <IndicatorTile key={item.id} item={item} selected={open === item.id} onOpen={() => setOpen(open === item.id ? null : item.id)} />
            ))}
            {country === 'mx'
              ? INEGI_MISSING.map((m) => (
                  <Card key={m.id}>
                    <Stat label={m.label} value="s/d" sublabel="INEGI sin token" info={{ term: m.label, text: INEGI_TIP }} />
                  </Card>
                ))
              : null}
          </div>
        ) : null}
      </div>
      <Detail item={selected} />
      {q.data ? <ApiNotes meta={q.data.meta} label="Avisos de los indicadores" /> : null}
    </section>
  )
}

function Compare() {
  const feature = useFeature(['macro.world'])
  const q = useQuery({ ...macroWorldQuery(), enabled: feature.enabled })
  const [indicator, setIndicator] = useState('gdpGrowth')
  const rows = q.data?.rows ?? []
  const countries = [...new Map(rows.map((r) => [r.country, r.name])).entries()]
  const table = countries.map(([code, name]) => {
    const row = { code, name }
    for (const r of rows.filter((x) => x.country === code)) row[r.indicator] = r
    return row
  })
  const chosen = rows.filter((r) => r.indicator === indicator)
  const unit = chosen[0]?.unit ?? 'fraction'
  const year = chosen.find((r) => r.year)?.year
  const columns = [
    { key: 'name', header: 'País' },
    ...WORLD_ITEMS.map((w) => ({
      key: w.value,
      header: w.label,
      align: 'right',
      format: (_v, r) => (r[w.value] ? `${fmtWorld(r[w.value].value, r[w.value].unit)}${r[w.value].year ? ` (${r[w.value].year})` : ''}` : 's/d'),
      sortValue: (r) => r[w.value]?.value ?? null,
    })),
  ]
  const loading = feature.waiting || (feature.enabled && q.isPending)
  return (
    <Card
      title="Comparar países"
      description="Datos anuales del Banco Mundial, licencia CC BY 4.0. Cada indicador usa su último año con dato; un país sin dato ese año sale s/d."
      status={q.data?.meta}
    >
      <div className="econ-compare">
        {loading ? <Skeleton height={320} /> : null}
        {!feature.enabled && !feature.waiting ? <EmptyState title="Comparador no disponible" text={feature.reason} /> : null}
        {q.isError ? <ErrorState message="No pudimos traer los datos del Banco Mundial." onRetry={() => q.refetch()} /> : null}
        {q.data ? (
          <>
            <DataTable caption="Indicadores por país" columns={columns} rows={table} rowKey="code" />
            <SegmentedControl label="Indicador de la gráfica" items={WORLD_ITEMS} value={indicator} onChange={setIndicator} />
            <Suspense fallback={<Skeleton height={140} />}>
              <Bars
                title={`${WORLD_ITEMS.find((w) => w.value === indicator)?.label ?? ''}${year ? `, ${year}` : ''}`}
                data={chosen.map((r) => ({ label: r.name, value: r.value }))}
                format={unit === 'usd' ? 'money' : 'pct'}
                currency="USD"
                categoryLabel="País"
                source="Banco Mundial (CC BY 4.0)"
              />
            </Suspense>
            <ApiNotes meta={q.data.meta} label="Avisos del Banco Mundial" />
          </>
        ) : null}
      </div>
    </Card>
  )
}

export default function EconomyPage() {
  const [params, setParams] = useSearchParams()
  const country = params.get('pais') === 'us' ? 'us' : 'mx'
  return (
    <div className="econ-page kz-container">
      <PageHeader
        eyebrow="Mercados"
        title="Economía de México y Estados Unidos"
        description="Inflación, empleo, crecimiento, remesas y reservas con su último dato, su cambio contra hace un año y la fecha de la próxima publicación."
        breadcrumbs={[{ label: 'Mercados', to: PATHS.markets }, { label: 'Economía' }]}
      />
      <SegmentedControl
        label="País"
        items={COUNTRY_ITEMS}
        value={country}
        onChange={(v) => {
          const next = new URLSearchParams(params)
          if (v === 'us') next.set('pais', 'us')
          else next.delete('pais')
          setParams(next, { replace: true })
        }}
      />
      <Indicators key={country} country={country} />
      <Compare />
      <p className="econ-range">
        Las tasas cambian en puntos base contra el mismo periodo del año anterior y los niveles en porcentaje. <InfoTip termKey="espejo-ocde" term="Espejo OCDE" /> Nada de esto es una recomendación de inversión.
      </p>
    </div>
  )
}
