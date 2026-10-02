// Forward teórico y presupuesto en dólares (V5FX): forward por paridad de tasas por plazo, con la
// referencia de tasa elegida y su convención, y un presupuesto calculado en el navegador
// (lib/budget.js). Todo es descriptivo: precio teórico, no cotización ni sugerencia de cubrirse.
import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ApiNotes, Card, DataTable, Disclaimer, EmptyState, ErrorState, NumberInput, PageHeader, SegmentedControl, Skeleton, Stat,
} from '../../../components/ui/index.js'
import { TimeSeries } from '../../../components/charts/TimeSeries.jsx'
import { Bars } from '../../../components/charts/Bars.jsx'
import { expectationsQuery, fxForwardQuery, fxMonitorQuery } from '../../../lib/api/queries.js'
import { useFeature } from '../../../lib/api/useFeature.js'
import { PATHS } from '../../../app/paths.js'
import { fmtDate, fmtMoney, fmtNumber, fmtPct } from '../../../lib/format.js'
import { impactBars, percentileOf, projectBudget } from '../lib/budget.js'
import { fmtMonth, fmtRate } from '../lib/labels.js'
import '../fx.css'

/** @typedef {import('../types.js').FxForwardResponse} FxForwardResponse */
/** @typedef {import('../types.js').FxMonitorResponse} FxMonitorResponse */
/** @typedef {import('../types.js').ExpectationsResponse} ExpectationsResponse */

const MXN_REFS = [
  { value: 'tiie', label: 'TIIE' },
  { value: 'cetes', label: 'CETES' },
  { value: 'fondeo', label: 'Fondeo' },
]
const USD_REFS = [
  { value: 'ust', label: 'Tesoro de EE. UU.' },
  { value: 'sofr', label: 'SOFR' },
]
const MONTHS = [
  { value: '3', label: '3 meses' },
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
]
const DISCLAIMER = 'El forward de esta página es un precio teórico por paridad de tasas, sin margen bancario. No es cotización ni sugerencia de cubrirse.'

export default function HedgePage() {
  const feature = useFeature(['fxdesk.forward'])
  const monitorFeature = useFeature(['fxdesk'])
  const expectationsFeature = useFeature(['expectations'])
  const [mxn, setMxn] = useState(/** @type {'tiie' | 'cetes' | 'fondeo'} */ ('tiie'))
  const [usd, setUsd] = useState(/** @type {'ust' | 'sofr'} */ ('ust'))
  const q = useQuery({ ...fxForwardQuery({ mxn, usd }), enabled: feature.enabled, placeholderData: keepPreviousData })
  const history = useQuery({ ...fxMonitorQuery({ years: 10 }), enabled: monitorFeature.enabled })
  const survey = useQuery({ ...expectationsQuery(), enabled: expectationsFeature.enabled })
  /** @type {FxForwardResponse | undefined} */
  const data = q.data
  const loading = feature.waiting || (feature.enabled && q.isPending)
  const conventions = data?.rows.length ? data.rows[0] : null

  return (
    <div className="kz-page kz-col fx-page" data-gap="6">
      <PageHeader
        eyebrow="Empresas"
        title="Forward y presupuesto en dólares"
        description="Forward teórico del dólar por paridad de tasas y el impacto en pesos de tu presupuesto en dólares. No es cotización."
        breadcrumbs={[{ label: 'Empresas', to: PATHS.business }, { label: 'Forward y presupuesto en dólares' }]}
      />
      <Disclaimer>{DISCLAIMER}</Disclaimer>

      {!feature.waiting && !feature.enabled ? <EmptyState title="El forward no está disponible" text={feature.reason} /> : null}
      {q.isError && !data ? <ErrorState message="No pudimos calcular el forward." onRetry={() => q.refetch()} retrying={q.isFetching} /> : null}

      <Card title="Forward teórico por plazo" status={data?.meta}>
        <div className="kz-col" data-gap="5">
          <div className="fx-controls">
            <SegmentedControl label="Tasa en pesos" items={MXN_REFS} value={mxn} onChange={(v) => setMxn(/** @type {any} */ (v))} />
            <SegmentedControl label="Tasa en dólares" items={USD_REFS} value={usd} onChange={(v) => setUsd(/** @type {any} */ (v))} />
          </div>
          <p className="fx-note" aria-live="polite">
            {conventions
              ? `Convención en pesos: ${conventions.iMxnConvention} (${conventions.iMxnSeries}). En dólares: ${conventions.iUsdConvention} (${conventions.iUsdSeries}).`
              : 'Convenciones: s/d'}
          </p>
          <div className="kz-metric-grid">
            <Stat
              label="Spot, FIX de Banxico"
              value={data ? `${fmtRate(data.spot.value)} pesos por dólar` : undefined}
              loading={loading}
              status={data ? { ...data.meta, asOf: data.spot.asOf } : undefined}
              sublabel={data ? fmtDate(data.spot.asOf) : undefined}
            />
          </div>
          <DataTable
            caption="Forward teórico por plazo"
            rowKey="days"
            loading={loading}
            loadingRows={4}
            rows={data?.rows ?? []}
            columns={[
              { key: 'days', header: 'Plazo', format: (v) => `${v} días` },
              { key: 'date', header: 'Vence', format: (v) => fmtDate(v) },
              { key: 'iMxn', header: 'Tasa en pesos', numeric: true, format: (v) => fmtPct(v) },
              { key: 'iUsd', header: 'Tasa en dólares', numeric: true, format: (v) => fmtPct(v) },
              { key: 'forward', header: 'Forward', numeric: true, format: (v) => fmtRate(v) },
              { key: 'pointsPips', header: 'Puntos', numeric: true, format: (v) => fmtNumber(v, { decimals: 2 }) },
              { key: 'carryAnnual', header: 'Costo anualizado', numeric: true, format: (v) => fmtPct(v) },
            ]}
            empty={{ title: 'Sin plazos', text: 'La fuente no devolvió tasas para estos plazos.' }}
          />
          {data ? <ApiNotes meta={data.meta} label="Avisos del forward" /> : null}
        </div>
      </Card>

      <BudgetSection data={data} loading={loading} history={history} monitorFeature={monitorFeature} />

      <SurveyCard feature={expectationsFeature} query={survey} />
    </div>
  )
}

function BudgetSection({ data, loading, history, monitorFeature }) {
  const [budgetRate, setBudgetRate] = useState(/** @type {number | null} */ (19))
  const [flow, setFlow] = useState(/** @type {number | null} */ (100_000))
  const [months, setMonths] = useState('12')
  const rate = budgetRate ?? NaN
  const monthly = flow ?? 0
  const projection = useMemo(
    () => (data ? projectBudget({ spot: data.spot.value, asOf: data.spot.asOf, rows: data.rows, budgetRate: rate, flowUsd: monthly, months: Number(months) }) : []),
    [data, rate, monthly, months],
  )
  /** @type {FxMonitorResponse | undefined} */
  const hist = history.data
  const percentile = hist ? percentileOf(budgetRate, hist.series.values) : null
  const totalUsd = monthly * Number(months)
  const bars = impactBars(totalUsd).map((b) => ({ label: b.label, value: b.value }))
  const historyLoading = monitorFeature.waiting || (monitorFeature.enabled && history.isPending)

  return (
    <Card title="Tu presupuesto en dólares" description="Cálculo en tu navegador con el forward de arriba. Nada de esto se guarda ni se envía.">
      <div className="kz-col" data-gap="5">
        <div className="fx-controls">
          <NumberInput label="Tipo de cambio presupuestal" suffix="MXN" decimals={4} value={budgetRate} onChange={setBudgetRate} />
          <NumberInput label="Flujo por mes" suffix="USD" decimals={2} value={flow} onChange={setFlow} />
          <SegmentedControl label="Meses" items={MONTHS} value={months} onChange={setMonths} />
        </div>
        <div className="kz-metric-grid">
          <Stat
            label="Percentil histórico del presupuesto"
            value={hist ? fmtPct(percentile, { decimals: 0 }) : historyLoading ? undefined : 's/d'}
            loading={historyLoading}
            sublabel={hist ? 'Días de los últimos 10 años en que el FIX cerró en ese nivel o por debajo' : monitorFeature.reason || undefined}
            status={hist?.meta}
          />
          <Stat label="Flujo total" value={fmtMoney(totalUsd, 'USD', { decimals: 0 })} sublabel={`${months} meses de ${fmtMoney(monthly, 'USD', { decimals: 0 })}`} />
        </div>
        <div className="fx-chart-slot">
          {data && projection.length ? (
            <TimeSeries
              title="Forward teórico contra el presupuesto"
              titleAs="h3"
              format="money"
              decimals={4}
              series={[
                { id: 'forward', label: 'Forward teórico', points: projection.map((p) => ({ date: p.date, value: p.forward })) },
                { id: 'budget', label: 'Presupuesto', dash: true, points: projection.map((p) => ({ date: p.date, value: p.budget })) },
              ]}
              description="Forward al cierre de cada mes, interpolado entre los plazos de la tabla."
            />
          ) : loading ? (
            <Skeleton height={340} />
          ) : (
            <EmptyState size="sm" title="Sin proyección" text="Escribe un tipo de cambio presupuestal y espera el forward." />
          )}
        </div>
        {projection.length ? (
          <DataTable
            caption="Diferencia contra el presupuesto por mes"
            rowKey="month"
            density="compact"
            rows={projection}
            columns={[
              { key: 'month', header: 'Mes', format: (v) => fmtMonth(v) },
              { key: 'forward', header: 'Forward teórico', numeric: true, format: (v) => fmtRate(v) },
              { key: 'diffPerUsd', header: 'Contra presupuesto, por dólar', numeric: true, format: (v) => fmtNumber(v, { decimals: 4, sign: true }) },
              { key: 'diffMxn', header: 'Diferencia del flujo', numeric: true, format: (v) => fmtMoney(v, 'MXN', { decimals: 0, sign: true }) },
            ]}
          />
        ) : null}
        <div className="fx-chart-slot fx-chart-slot--bars">
          <Bars
            title="Impacto en pesos del flujo total"
            titleAs="h3"
            description="Cuánto cambia en pesos el flujo total si el tipo de cambio se mueve 50 centavos o 1 peso."
            data={bars}
            signed
            format="money"
            decimals={0}
            categoryLabel="Movimiento del tipo de cambio"
            valueLabel="Cambio en pesos"
          />
        </div>
      </div>
    </Card>
  )
}

function SurveyCard({ feature, query }) {
  /** @type {ExpectationsResponse | undefined} */
  const data = query.data
  const items = (data?.survey.items ?? []).filter((i) => i.id === 'fxT' || i.id === 'fxT1')
  const loading = feature.waiting || (feature.enabled && query.isPending)
  return (
    <Card
      title="Encuesta de Banxico"
      description="Mediana de los especialistas para el tipo de cambio al cierre de año."
      status={data?.meta}
    >
      {loading ? (
        <div className="kz-metric-grid">
          <Stat label="Cargando" loading />
          <Stat label="Cargando" loading />
        </div>
      ) : null}
      {!loading && !feature.enabled ? (
        <div className="kz-metric-grid">
          <Stat label="Tipo de cambio al cierre de año" value="s/d" sublabel="La encuesta de Banxico todavía no está disponible en este servidor." />
        </div>
      ) : null}
      {query.isError ? <ErrorState size="sm" message="No pudimos traer la encuesta." onRetry={() => query.refetch()} retrying={query.isFetching} /> : null}
      {data ? (
        <div className="kz-col" data-gap="3">
          <div className="kz-metric-grid">
            {items.length ? (
              items.map((i) => (
                <Stat
                  key={i.id}
                  label={`Cierre de ${i.year ?? 's/d'}`}
                  value={i.median == null ? 's/d' : `${fmtRate(i.median)} pesos por dólar`}
                  sublabel={i.verified ? 'Mediana de la encuesta' : 'Serie sin verificar'}
                />
              ))
            ) : (
              <Stat label="Tipo de cambio al cierre de año" value="s/d" />
            )}
          </div>
          <ApiNotes meta={data.meta} label="Avisos de la encuesta" />
        </div>
      ) : null}
    </Card>
  )
}
