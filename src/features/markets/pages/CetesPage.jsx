// /mercados/cetes: tabla de CETES por plazo y calculadora con retención de ISR.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, DataStatus, DataTable, Delta, NumberInput, PageHeader, Select, Stat } from '../../../components/ui/index.js'
import { ratesMxQuery } from '../../../lib/api/queries.js'
import { cetesEffectiveAnnual } from '../../../lib/finance/index.js'
import { fmtMoney, fmtPct } from '../../../lib/format.js'
import { ApiNotes } from './ApiNotes.jsx'
import { ISR_RETENTION_2026, cetesResult, tenorOf } from './cetes-calc.js'
import { itemStatus } from './shared.js'
import '../markets.css'

const DEFAULT_TENORS = [28, 91, 182, 364]

function useCetesRows() {
  const q = useQuery(ratesMxQuery())
  const rows = useMemo(
    () =>
      (q.data?.items ?? [])
        .filter((it) => /cetes/i.test(`${it.id} ${it.label}`) && it.unit === 'fraction')
        .map((it) => ({ ...it, tenorDays: tenorOf(it) }))
        .filter((it) => it.tenorDays != null)
        .sort((a, b) => a.tenorDays - b.tenorDays),
    [q.data],
  )
  return { q, rows }
}

function CetesTable({ q, rows }) {
  const meta = q.data?.meta
  const columns = [
    { key: 'tenorDays', header: 'Plazo', format: (v) => `${v} días` },
    { key: 'value', header: 'Tasa anual', numeric: true, format: (v) => fmtPct(v) },
    { key: 'changeBp', header: 'Cambio', numeric: true, format: (v) => (v == null ? <span className="kz-missing">s/d</span> : <Delta value={v} kind="bp" direction="neutral" />) },
    {
      key: 'effective',
      header: 'Efectiva anual',
      numeric: true,
      sortValue: (row) => cetesEffectiveAnnual(row.value, row.tenorDays),
      format: (_, row) => fmtPct(cetesEffectiveAnnual(row.value, row.tenorDays)),
      info: { termKey: 'interes-compuesto', term: 'Efectiva anual' },
    },
    { key: 'asOf', header: 'Dato', format: (_, row) => <DataStatus {...itemStatus(row, meta)} /> },
  ]
  return (
    <Card title="CETES por plazo" description="Tasa de la última subasta primaria de Banxico." status={meta} padding="none" info={{ termKey: 'cetes', term: 'CETES' }}>
      <DataTable
        caption="CETES por plazo"
        captionHidden
        rowKey="id"
        columns={columns}
        rows={rows}
        loading={q.isPending}
        loadingRows={4}
        error={q.isError ? 'No pudimos traer las tasas de CETES.' : undefined}
        onRetry={() => q.refetch()}
        empty={{ title: 'Sin tasas de CETES por ahora', text: 'Puedes escribir la tasa a mano en la calculadora.' }}
      />
      <ApiNotes meta={meta} label="Avisos de Banxico" />
    </Card>
  )
}

function Calculator({ rows }) {
  const [amount, setAmount] = useState(/** @type {number | null} */ (10000))
  const [tenor, setTenor] = useState(28)
  const [ratePct, setRatePct] = useState(/** @type {number | null | undefined} */ (undefined))
  const [retentionPct, setRetentionPct] = useState(/** @type {number | null} */ (ISR_RETENTION_2026 * 100))

  const apiRow = rows.find((r) => r.tenorDays === tenor)
  const apiPct = apiRow?.value != null ? Math.round(apiRow.value * 1e6) / 1e4 : null
  const shownRate = ratePct === undefined ? apiPct : ratePct
  const tenors = rows.length ? rows.map((r) => r.tenorDays) : DEFAULT_TENORS

  const result = cetesResult({
    amount,
    tenorDays: tenor,
    annualYield: shownRate == null ? null : shownRate / 100,
    retentionRate: retentionPct == null ? null : retentionPct / 100,
  })

  return (
    <Card title="Calculadora de CETES" description="Estima cuánto rinde un plazo. La tasa viene de la última subasta y la puedes cambiar.">
      <div className="kz-col">
        <div className="markets-calc">
          <NumberInput label="Monto a invertir" prefix="$" suffix="MXN" value={amount} onChange={setAmount} decimals={2} />
          <Select
            label="Plazo"
            value={String(tenor)}
            onChange={(e) => {
              setTenor(Number(e.target.value))
              setRatePct(undefined)
            }}
            options={tenors.map((t) => ({ value: String(t), label: `${t} días` }))}
          />
          <NumberInput
            label="Tasa anual"
            suffix="%"
            value={shownRate ?? null}
            onChange={setRatePct}
            decimals={2}
            hint={apiRow ? 'Prellenada con la última subasta.' : 'Escríbela a mano: no hay dato del API para este plazo.'}
          />
          <NumberInput label="Retención anual de ISR" suffix="%" value={retentionPct} onChange={setRetentionPct} decimals={2} hint="0.90 % en 2026, según la Ley de Ingresos de la Federación." />
        </div>
        {apiRow ? (
          <div>
            <DataStatus {...itemStatus(apiRow, null)} />
          </div>
        ) : null}
        <div className="markets-grid" aria-live="polite">
          <Stat label="Intereses brutos" value={result ? fmtMoney(result.gross) : null} sublabel={result ? `${fmtPct(result.periodYield, { decimals: 4 })} en el plazo` : undefined} />
          <Stat label="Retención de ISR" value={result ? fmtMoney(-result.retention) : null} />
          <Stat label="Intereses netos" value={result ? fmtMoney(result.net) : null} size="lg" />
          <Stat label="Efectiva anual" value={result ? fmtPct(result.effectiveAnnual, { decimals: 2 }) : null} sublabel="Si reinviertes cada plazo durante un año" info={{ termKey: 'interes-compuesto', term: 'Efectiva anual' }} />
        </div>
        <div className="markets-formula">
          <p>
            Cómo se calcula: los CETES se cotizan con base de 360 días. Los intereses brutos son monto × tasa × plazo ÷ 360. La retención de ISR se
            calcula sobre el capital, no sobre los intereses: monto × tasa de retención × plazo ÷ 365.
          </p>
          <p>
            La tasa efectiva anual reinvierte el plazo durante 365 días: (1 + tasa × plazo ÷ 360)^(365 ÷ plazo) − 1. Con 11 % a 28 días da 11.75 %, no
            11 %: la diferencia es el interés compuesto.
          </p>
          <p>La retención es un pago provisional; el impuesto final se ajusta en tu declaración anual. Esto es una estimación educativa, no una recomendación.</p>
        </div>
      </div>
    </Card>
  )
}

export default function CetesPage() {
  const { q, rows } = useCetesRows()
  return (
    <div className="markets-page kz-container">
      <PageHeader
        eyebrow="Mercados"
        title="Calculadora de CETES"
        description="Cuánto rinde una inversión en CETES según el plazo y la tasa de la última subasta."
        breadcrumbs={[{ label: 'Mercados', to: '/mercados' }, { label: 'CETES' }]}
      />
      <Calculator rows={rows} />
      <CetesTable q={q} rows={rows} />
    </div>
  )
}
