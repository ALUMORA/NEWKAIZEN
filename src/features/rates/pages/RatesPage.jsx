// /mercados/tasas (V5TS): curvas de México y EE. UU., mercado de dinero y expectativas, cada nodo con
// su fecha. ?pais=mx|us y ?pestana=curvas|dinero|expectativas viven en la URL.
import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ApiNotes,
  Badge,
  Card,
  DataStatus,
  DataTable,
  Delta,
  Disclaimer,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Stat,
  TabPanel,
  Tabs,
} from '../../../components/ui/index.js'
import { curveSpreadsQuery, curvesQuery, expectationsQuery, moneyMarketQuery, ratesMxQuery } from '../../../lib/api/queries.js'
import { useFeature } from '../../../lib/api/useFeature.js'
import { fmtDate, fmtNumber, fmtPct } from '../../../lib/format.js'
import { PATHS } from '../../../app/paths.js'
import {
  COMPARE,
  conventionText,
  curvePoints,
  forwardLabel,
  hasMixedDates,
  moneyMarketRows,
  readParams,
  surveyValue,
  tenorLabel,
  tenorTick,
  twoDates,
  writeParams,
} from '../model.js'
import '../rates.css'

const TimeSeries = lazy(() => import('../../../components/charts/TimeSeries.jsx').then((m) => ({ default: m.TimeSeries })))
const Bars = lazy(() => import('../../../components/charts/Bars.jsx').then((m) => ({ default: m.Bars })))

/** @typedef {import('../types.js').CurvesResponse} CurvesResponse */
/** @typedef {import('../types.js').CurveSpreadsResponse} CurveSpreadsResponse */
/** @typedef {import('../types.js').MoneyMarketResponse} MoneyMarketResponse */
/** @typedef {import('../types.js').ExpectationsResponse} ExpectationsResponse */

const TAB_ITEMS = [
  { id: 'curvas', label: 'Curvas' },
  { id: 'dinero', label: 'Mercado de dinero' },
  { id: 'expectativas', label: 'Expectativas' },
]
const COUNTRY_ITEMS = [
  { value: 'mx', label: 'México' },
  { value: 'us', label: 'EE. UU.' },
]
const COUNTRY_NAME = { mx: 'México', us: 'Estados Unidos' }

/** Alto reservado mientras carga una gráfica o una tabla, para que nada salte. */
function Reserve({ height, label = 'Cargando' }) {
  return (
    <div className="rates-reserve" style={{ minHeight: height }} aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton height={height - 8} />
    </div>
  )
}

function Unavailable({ feature }) {
  if (feature.waiting) return <Reserve height={320} label="Conectando con el servidor" />
  return <EmptyState title="Sin datos por ahora" text={feature.reason} />
}

const pct = (v) => fmtPct(v)
const dateOrSd = (v) => (v ? fmtDate(v) : 's/d')

// ─── Curvas ────────────────────────────────────────────────────────────────

function CurveChart({ data, country }) {
  const nodes = data.nodes
  const isolated = country === 'mx' && hasMixedDates(nodes)
  const series = [
    { id: 'hoy', label: 'Hoy', points: curvePoints(nodes, { isolated }), color: 'var(--chart-1)' },
    data.compare['1m'] && { id: '1m', label: 'Hace 1 mes', points: curvePoints(data.compare['1m']), color: 'var(--chart-2)', dash: true },
    data.compare['1y'] && { id: '1y', label: 'Hace 1 año', points: curvePoints(data.compare['1y']), color: 'var(--chart-3)', dash: true },
  ].filter(Boolean)
  return (
    <TimeSeries
      title={`Curva de rendimiento de ${COUNTRY_NAME[country]}`}
      titleAs="h3"
      description={
        isolated
          ? 'Años al vencimiento. Hoy se dibuja con puntos sueltos porque cada plazo trae la fecha de su última subasta.'
          : 'Años al vencimiento contra rendimiento.'
      }
      series={series}
      format="pct"
      xType="number"
      xFormat={tenorTick}
      xLabel="Plazo"
      status={data.meta}
    />
  )
}

const NODE_COLUMNS = [
  { key: 'label', header: 'Plazo' },
  { key: 'instrument', header: 'Instrumento', format: (v) => ({ cetes: 'CETES', bonoM: 'Bono M', udibono: 'Udibono', ust: 'Tesoro' })[v] ?? v },
  { key: 'value', header: 'Rendimiento', numeric: true, format: pct },
  { key: 'asOf', header: 'Fecha del dato', format: (v, row) => <DataStatus asOf={v ?? undefined} source={row.source} stale={row.stale} fallback={row.fallback} /> },
  { key: 'seriesId', header: 'Serie' },
]

function CurvesPanel({ country, feature }) {
  const curves = useQuery({ ...curvesQuery({ country, compare: [...COMPARE] }), enabled: feature.enabled })
  const spreads = useQuery({ ...curveSpreadsQuery({ history: '1y' }), enabled: feature.enabled })
  if (!feature.enabled) return <Unavailable feature={feature} />
  /** @type {CurvesResponse | undefined} */
  const data = curves.data
  /** @type {CurveSpreadsResponse | undefined} */
  const sp = spreads.data
  const nodeRows = (data?.nodes ?? []).map((n) => ({ ...n, source: data?.meta.source, fallback: data?.meta.fallback, stale: false }))
  const breakeven10 = data ? data.breakeven.find((b) => b.tenorDays === 3650) ?? data.breakeven[data.breakeven.length - 1] : null
  return (
    <div className="kz-col" data-gap="6">
      <Card title="Curva" titleAs="h2" description="Rendimiento de cada plazo con la curva de hace un mes y de hace un año." status={data?.meta} info={{ termKey: 'curva-de-rendimientos', term: 'Curva de rendimientos' }}>
        {curves.isError ? <ErrorState message="No pudimos traer la curva." onRetry={() => curves.refetch()} retrying={curves.isFetching} /> : null}
        {curves.isPending ? <Reserve height={360} /> : null}
        {data ? (
          <Suspense fallback={<Reserve height={360} />}>
            <CurveChart data={data} country={country} />
          </Suspense>
        ) : null}
      </Card>

      <Card title="Nodos de la curva" titleAs="h2" description={country === 'mx' ? 'En México cada plazo cambia solo en su subasta: cada renglón trae su fecha.' : 'Rendimientos par del Tesoro, de FRED y del propio Tesoro.'} padding="none">
        <DataTable
          caption="Nodos de la curva"
          captionHidden
          columns={NODE_COLUMNS}
          rows={nodeRows}
          rowKey={(r) => `${r.instrument}-${r.tenorDays}`}
          loading={curves.isPending}
          loadingRows={9}
          error={curves.isError || undefined}
          empty={{ title: 'Sin nodos', text: 'La fuente no devolvió plazos.' }}
          stickyFirstColumn
        />
      </Card>

      <Card title="Inflación implícita" titleAs="h2" description="Bono nominal contra bono real del mismo plazo." info={{ termKey: 'inflacion-implicita', term: 'Inflación implícita' }} status={data?.meta}>
        {curves.isPending ? <Reserve height={120} /> : null}
        {data ? (
          <div className="kz-col">
            {breakeven10 ? (
              <Stat
                size="lg"
                label={`Inflación implícita a ${tenorLabel(breakeven10.tenorDays)}`}
                value={breakeven10.value == null ? 's/d' : fmtPct(breakeven10.value)}
                sublabel={breakeven10.simpleBp == null ? 'Resta simple: s/d' : `Resta simple: ${fmtNumber(breakeven10.simpleBp, { decimals: 0 })} pb. ${twoDates('Nominal', breakeven10.nominalAsOf, 'real', breakeven10.realAsOf)}`}
                info={{ termKey: 'inflacion-implicita', term: 'Inflación implícita' }}
              />
            ) : null}
            <DataTable
              caption="Inflación implícita por plazo"
              columns={[
                { key: 'tenorDays', header: 'Plazo', format: (v) => tenorLabel(v) },
                { key: 'value', header: 'Fisher', numeric: true, format: pct },
                { key: 'simpleBp', header: 'Resta simple', numeric: true, format: (v) => (v == null ? 's/d' : `${fmtNumber(v, { decimals: 0 })} pb`) },
                { key: 'nominalAsOf', header: 'Fecha nominal', format: dateOrSd },
                { key: 'realAsOf', header: 'Fecha real', format: dateOrSd },
                { key: 'dateGapDays', header: 'Días entre fechas', numeric: true, format: (v) => (v == null ? 's/d' : (v > 7 ? <Badge tone="warning">{`${v} días`}</Badge> : String(v))) },
              ]}
              rows={data.breakeven}
              rowKey={(r) => String(r.tenorDays)}
              density="compact"
              empty={{ title: 'Sin bonos reales', text: 'No hay plazos con bono nominal y real a la vez.' }}
            />
          </div>
        ) : null}
      </Card>

      <Card title="Diferencial México menos EE. UU." titleAs="h2" description="Bono M o CETES contra el Tesoro del mismo plazo, en pb." status={sp?.meta} info={{ termKey: 'puntos-base', term: 'Puntos base' }}>
        {spreads.isError ? <ErrorState message="No pudimos traer el diferencial." onRetry={() => spreads.refetch()} retrying={spreads.isFetching} /> : null}
        {spreads.isPending ? <Reserve height={260} /> : null}
        {sp ? (
          <div className="kz-col" data-gap="6">
            <Suspense fallback={<Reserve height={220} />}>
              <Bars
                title="Diferencial por plazo"
                titleAs="h3"
                data={sp.rows.map((r) => ({ label: `${r.tenorYears === 1 ? '1 año' : `${r.tenorYears} años`}${r.asOfMismatch ? ' (fechas distintas)' : ''}`, value: r.spreadBp }))}
                format="bp"
                signed
                categoryLabel="Plazo"
                valueLabel="Diferencial"
                status={sp.meta}
              />
            </Suspense>
            <DataTable
              caption="Diferencial por plazo con sus fechas"
              columns={[
                { key: 'tenorYears', header: 'Plazo', format: (v) => (v === 1 ? '1 año' : `${v} años`) },
                { key: 'mx', header: 'México', numeric: true, format: pct },
                { key: 'us', header: 'EE. UU.', numeric: true, format: pct },
                { key: 'spreadBp', header: 'Diferencial', numeric: true, format: (v) => (v == null ? 's/d' : `${fmtNumber(v, { decimals: 0 })} pb`) },
                { key: 'asOfMismatch', header: 'Fechas', format: (v, row) => (v ? <Badge tone="warning">fechas distintas</Badge> : <span>{dateOrSd(row.mxAsOf)}</span>) },
                { key: 'mxAsOf', header: 'Fecha México', format: dateOrSd },
                { key: 'usAsOf', header: 'Fecha EE. UU.', format: dateOrSd },
              ]}
              rows={sp.rows}
              rowKey={(r) => String(r.tenorYears)}
              density="compact"
            />
            <Suspense fallback={<Reserve height={280} />}>
              <TimeSeries
                title="Diferencial a 10 años en el último año"
                titleAs="h3"
                description="Un punto por subasta del Bono M a 10 años contra el Tesoro a 10 años de ese día."
                series={[{ id: 'd10', label: 'México menos EE. UU. a 10 años', points: sp.history10y.dates.map((d, i) => ({ date: d, value: sp.history10y.valuesBp[i] })), color: 'var(--chart-2)' }]}
                format="bp"
                status={sp.meta}
              />
            </Suspense>
          </div>
        ) : null}
      </Card>
      <ApiNotes meta={data?.meta} label="Avisos de la curva" />
      <ApiNotes meta={sp?.meta} label="Avisos del diferencial" />
    </div>
  )
}

// ─── Mercado de dinero ─────────────────────────────────────────────────────

const bpDelta = (v) => (v == null ? 's/d' : <Delta value={v} kind="bp" direction="neutral" decimals={2} />)

const MONEY_COLUMNS = [
  { key: 'label', header: 'Tasa' },
  { key: 'value', header: 'Valor', numeric: true, format: pct },
  { key: 'change1dBp', header: 'Día', numeric: true, format: bpDelta },
  { key: 'change1wBp', header: 'Semana', numeric: true, format: bpDelta },
  { key: 'change1mBp', header: 'Mes', numeric: true, format: bpDelta },
  { key: 'convention', header: 'Convención', format: (v) => conventionText(v), info: { termKey: 'convencion-de-tasas', term: 'Convención de tasas' } },
  { key: 'asOf', header: 'Fecha', format: dateOrSd },
  { key: 'seriesId', header: 'Serie' },
]

function MoneyPanel({ country, feature }) {
  const money = useQuery({ ...moneyMarketQuery(), enabled: feature.enabled })
  const rates = useQuery({ ...ratesMxQuery(), enabled: country === 'mx' })
  if (!feature.enabled) return <Unavailable feature={feature} />
  /** @type {MoneyMarketResponse | undefined} */
  const data = money.data
  const grouped = moneyMarketRows(rates.data, data)
  const rows = country === 'mx' ? grouped.MX : grouped.US
  const loading = money.isPending || (country === 'mx' && rates.isPending)
  return (
    <div className="kz-col" data-gap="6">
      <Card
        title={country === 'mx' ? 'Tasas de México' : 'Tasas de Estados Unidos'}
        titleAs="h2"
        description="Cambios en pb contra el dato anterior, la semana y el mes. Cada renglón dice su convención: no se comparan directo sin convertirlas."
        status={data?.meta}
        padding="none"
      >
        <DataTable
          caption={country === 'mx' ? 'Tasas de México' : 'Tasas de Estados Unidos'}
          captionHidden
          columns={MONEY_COLUMNS}
          rows={rows}
          rowKey="id"
          loading={loading}
          loadingRows={country === 'mx' ? 10 : 6}
          error={money.isError ? <span>No pudimos traer las tasas.</span> : undefined}
          onRetry={() => money.refetch()}
          empty={{ title: 'Sin tasas por ahora', text: 'La fuente no devolvió renglones.' }}
        />
      </Card>
      <ApiNotes meta={data?.meta} label="Avisos del mercado de dinero" />
      {country === 'mx' ? <ApiNotes meta={rates.data?.meta} label="Avisos de Banxico" /> : null}
    </div>
  )
}

// ─── Expectativas ──────────────────────────────────────────────────────────

function ExpectationsPanel({ country, feature }) {
  const q = useQuery({ ...expectationsQuery(), enabled: feature.enabled })
  if (!feature.enabled) return <Unavailable feature={feature} />
  /** @type {ExpectationsResponse | undefined} */
  const data = q.data
  const forwards =
    country === 'mx'
      ? (data?.impliedForwards.mx ?? []).map((f) => ({ label: forwardLabel(f.fromDays, f.toDays), value: f.vsTargetBp }))
      : (data?.impliedForwards.us ?? []).map((f) => ({ label: forwardLabel(f.fromDays, f.toDays), value: f.vsDffBp }))
  const survey = data?.survey
  return (
    <div className="kz-col" data-gap="6">
      {q.isError ? <ErrorState message="No pudimos traer las expectativas." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}
      {country === 'mx' ? (
        <Card
          title="Encuesta de especialistas de Banxico"
          titleAs="h2"
          description={survey?.surveyDate ? `Levantamiento de ${fmtDate(survey.surveyDate)}. Media y mediana de los analistas del sector privado.` : 'Media y mediana de los analistas del sector privado.'}
          info={{ termKey: 'encuesta-banxico', term: 'Encuesta de especialistas de Banxico' }}
          status={data?.meta}
        >
          {q.isPending ? <Reserve height={260} /> : null}
          {survey ? (
            <div className="rates-grid">
              {survey.items.map((item) => (
                <Stat
                  key={item.id}
                  label={`${item.label}${item.year ? ` ${item.year}` : ''}`}
                  value={surveyValue(item.median, item.unit)}
                  sublabel={`Mediana. Media: ${surveyValue(item.mean, item.unit)}${item.verified ? '' : '. Serie sin verificar'}`}
                />
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}
      {country === 'mx' ? (
        <Card title="Tasa real de CETES a 28 días" titleAs="h2" description="CETES contra la inflación observada (ex post) y contra la mediana de la encuesta para este año (ex ante)." info={{ termKey: 'tasa-real', term: 'Tasa real' }} status={data?.meta}>
          {q.isPending ? <Reserve height={120} /> : null}
          {data ? (
            <div className="rates-grid">
              <Stat label="Tasa real ex post" value={data.realRates.exPost == null ? 's/d' : fmtPct(data.realRates.exPost)} sublabel={`CETES ${fmtPct(data.realRates.cetes28)} e inflación observada ${fmtPct(data.realRates.observedInflation)}`} info={{ termKey: 'tasa-real', term: 'Tasa real' }} />
              <Stat label="Tasa real ex ante" value={data.realRates.exAnte == null ? 's/d' : fmtPct(data.realRates.exAnte)} sublabel={`CETES ${fmtPct(data.realRates.cetes28)} e inflación esperada ${fmtPct(data.realRates.expectedInflation)}`} info={{ termKey: 'tasa-real', term: 'Tasa real' }} />
            </div>
          ) : null}
        </Card>
      ) : null}
      <Card
        title="Forwards implícitos"
        titleAs="h2"
        description={country === 'mx' ? 'Tramos de la curva de CETES contra la tasa objetivo de Banxico, en pb. No son un pronóstico: incluyen primas por plazo.' : 'Tramos de la curva corta del Tesoro, pasada a act/360, contra la tasa de fondos federales efectiva, en pb.'}
        info={{ termKey: 'forward-implicito', term: 'Forward implícito' }}
        status={data?.meta}
      >
        {q.isPending ? <Reserve height={180} /> : null}
        {data ? (
          <Suspense fallback={<Reserve height={180} />}>
            <Bars
              title={country === 'mx' ? 'Forward contra la tasa objetivo' : 'Forward contra fondos federales'}
              titleAs="h3"
              data={forwards}
              format="bp"
              signed
              categoryLabel="Tramo"
              valueLabel="Diferencia"
              status={data.meta}
            />
          </Suspense>
        ) : null}
      </Card>
      <ApiNotes meta={data?.meta} label="Avisos de expectativas" />
    </div>
  )
}

// ─── Página ────────────────────────────────────────────────────────────────

export default function RatesPage() {
  const [params, setParams] = useSearchParams()
  const { country, tab } = readParams(params)
  const curvesFeature = useFeature(['curves'])
  const moneyFeature = useFeature(['moneyMarket'])
  const expectationsFeature = useFeature(['expectations'])
  const setCountry = (value) => setParams(writeParams(params, { country: value }), { replace: true })
  const setTab = (value) => setParams(writeParams(params, { tab: value }), { replace: true })
  return (
    <div className="kz-page kz-col rates-page" data-gap="6">
      <PageHeader
        title="Tasas y curvas"
        eyebrow="Mercados"
        description="Curvas de rendimiento de México y Estados Unidos, mercado de dinero, expectativas de la encuesta de Banxico y tasa real, cada nodo con su fecha."
        breadcrumbs={[{ label: 'Mercados', to: PATHS.markets }, { label: 'Tasas y curvas' }]}
      />
      <SegmentedControl label="País" items={COUNTRY_ITEMS} value={country} onChange={setCountry} name="rates-country" />
      <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} label="Secciones de tasas">
        <TabPanel id="curvas">
          <CurvesPanel country={country} feature={curvesFeature} />
        </TabPanel>
        <TabPanel id="dinero">
          <MoneyPanel country={country} feature={moneyFeature} />
        </TabPanel>
        <TabPanel id="expectativas">
          <ExpectationsPanel country={country} feature={expectationsFeature} />
        </TabPanel>
      </Tabs>
      <Disclaimer />
    </div>
  )
}
