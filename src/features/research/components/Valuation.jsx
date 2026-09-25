// Valuación: múltiplos contra su referencia y DCF con supuestos editables. El DCF es un rango que
// depende de supuestos, no un precio objetivo; los avisos del servidor se muestran siempre.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { valuationQuery } from '../../../lib/api/queries.js'
import { fmtMoney, fmtMultiple, fmtPct } from '../../../lib/format.js'
import { Button, Card, DataTable, ErrorState, NumberInput, Skeleton, SrOnly, Stat } from '../../../components/ui/index.js'
import { ASSUMPTION_LIMITS, dcfCurrency, validateAssumptions } from '../valuation-model.js'
import { QueryBlock } from './QueryBlock.jsx'
import { SectionNotes } from './SectionNotes.jsx'

function Multiples({ multiples, currency }) {
  if (!multiples?.applicable) {
    return <p className="kz-research-muted">{multiples?.reason ?? 'Los múltiplos no aplican a esta emisora.'}</p>
  }
  const columns = [
    { key: 'label', header: 'Múltiplo' },
    { key: 'current', header: 'Emisora', numeric: true, format: (v) => fmtMultiple(v) },
    { key: 'benchmark', header: `Referencia (${multiples.market === 'EM' ? 'emergentes' : 'EUA'})`, numeric: true, format: (v) => fmtMultiple(v) },
    { key: 'impliedPrice', header: 'Precio implícito', numeric: true, format: (v) => fmtMoney(v, currency) },
  ]
  const range = multiples.fairValueRange
  return (
    <div className="kz-col" data-gap="3">
      <DataTable columns={columns} rows={multiples.methods ?? []} rowKey="id" caption="Múltiplos contra su referencia sectorial" density="compact" />
      {range ? (
        <p>
          Con estos múltiplos, el rango implícito va de <strong className="num">{fmtMoney(range.low, currency)}</strong> a{' '}
          <strong className="num">{fmtMoney(range.high, currency)}</strong>, con punto medio en{' '}
          <span className="num">{fmtMoney(range.mid, currency)}</span>. Es una referencia, no un precio objetivo.
        </p>
      ) : null}
    </div>
  )
}

function Sensitivity({ sensitivity, currency }) {
  if (!sensitivity?.waccs?.length || !sensitivity?.growths?.length) return null
  const columns = [
    { key: 'wacc', header: 'WACC', format: (v) => fmtPct(v, { decimals: 1 }) },
    ...sensitivity.growths.map((g, j) => ({
      key: `g${j}`,
      header: `g ${fmtPct(g, { decimals: 1 })}`,
      numeric: true,
      format: (v) => fmtMoney(v, currency),
    })),
  ]
  const rows = sensitivity.waccs.map((wacc, i) => {
    /** @type {Record<string, unknown>} */
    const row = { wacc, id: String(i) }
    sensitivity.growths.forEach((_, j) => {
      row[`g${j}`] = sensitivity.grid?.[i]?.[j] ?? null
    })
    return row
  })
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey="id"
      caption={`Malla de sensibilidad: valor por acción en ${currency ?? 's/d'} según WACC (filas) y crecimiento terminal (columnas)`}
      density="compact"
    />
  )
}

function Dcf({ dcf, currency, quoteCurrency }) {
  if (!dcf?.applicable) return <p className="kz-research-muted">{dcf?.reason ?? 'El DCF no aplica a esta emisora.'}</p>
  const inputs = dcf.inputs ?? {}
  return (
    <div className="kz-col" data-gap="3">
      {currency && quoteCurrency && currency !== quoteCurrency ? (
        <p className="kz-research-muted">
          El DCF va en {currency}, la moneda en la que la empresa reporta sus flujos; el precio y los múltiplos van en {quoteCurrency}.
        </p>
      ) : null}
      {dcf.warnings?.length ? (
        <div role="note" aria-label="Avisos del DCF" className="kz-col kz-research-warning" data-gap="2">
          <strong>Antes de leer el resultado</strong>
          <ul>
            {dcf.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="kz-metric-grid">
        <Stat label="Valor por acción con estos supuestos" value={fmtMoney(dcf.perShare, currency)} info={{ termKey: 'dcf', term: 'DCF' }} />
        <Stat label="WACC" value={fmtPct(inputs.wacc, { decimals: 1 })} info={{ termKey: 'wacc', term: 'WACC' }} />
        <Stat label="Peso del valor terminal" value={fmtPct(dcf.tvShare, { decimals: 0 })} info={{ termKey: 'crecimiento-terminal', term: 'Crecimiento terminal' }} />
        <Stat label="Valor de la empresa" value={fmtMoney(dcf.enterpriseValue, currency, { compact: true })} info={{ termKey: 'valor-empresa', term: 'Valor de la empresa' }} />
      </div>
      <Sensitivity sensitivity={dcf.sensitivity} currency={currency} />
    </div>
  )
}

function Bank({ bank, currency }) {
  if (!bank) return null
  return (
    <section aria-labelledby="kz-val-bank" className="kz-col" data-gap="2">
      <h3 id="kz-val-bank">P/VL justificado</h3>
      {bank.applicable ? (
        <>
          <div className="kz-metric-grid">
            <Stat label="P/VL justificado" value={fmtMultiple(bank.justifiedPB, { decimals: 2 })} info={{ termKey: 'p-vl', term: 'P/VL' }} />
            <Stat label="Precio implícito" value={fmtMoney(bank.impliedPrice, currency)} />
            <Stat label="ROE" value={fmtPct(bank.roe, { decimals: 1 })} info={{ termKey: 'roe', term: 'ROE' }} />
            <Stat label="Costo de capital propio" value={fmtPct(bank.costOfEquity, { decimals: 1 })} />
            <Stat label="Crecimiento" value={fmtPct(bank.growth, { decimals: 1 })} />
          </div>
          <p className="kz-research-muted">P/VL justificado = (ROE − g) ÷ (costo de capital propio − g), por el valor en libros por acción. Es una referencia, no un precio objetivo.</p>
        </>
      ) : (
        <p className="kz-research-muted">Sin P/VL justificado: falta el ROE, el costo de capital propio o el crecimiento de esta emisora.</p>
      )}
    </section>
  )
}

const EMPTY_DRAFT = { erp: null, crp: null, terminalGrowth: null, growth: null, years: null }

/** @param {{ symbol: string }} props */
export function Valuation({ symbol }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}))
  const [params, setParams] = useState(/** @type {Record<string, number>} */ ({}))
  const custom = Object.keys(params).length > 0
  // La consulta base (supuestos del servidor) sostiene la tarjeta; la de supuestos propios solo el
  // DCF. Así un supuesto que el API rechace no se lleva el formulario ni los múltiplos.
  const base = useQuery(valuationQuery(symbol, {}))
  const tuned = useQuery({ ...valuationQuery(symbol, params), enabled: Boolean(symbol) && custom })
  const data = base.data
  const shown = custom ? tuned.data : data

  const apply = (event) => {
    event.preventDefault()
    const next = validateAssumptions(draft)
    setErrors(next.errors)
    if (Object.keys(next.errors).length) return
    setParams(next.params)
  }
  const reset = () => {
    setDraft(EMPTY_DRAFT)
    setErrors({})
    setParams({})
  }
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }))
  const a = shown?.assumptions ?? data?.assumptions
  const field = (key, label, extra = {}) => (
    <NumberInput
      label={label}
      suffix={key === 'years' ? undefined : '%'}
      value={draft[key]}
      onChange={set(key)}
      error={errors[key]}
      hint={`De ${String(ASSUMPTION_LIMITS[key].min).replace('-', '\u2212')} a ${ASSUMPTION_LIMITS[key].max}`}
      {...extra}
    />
  )

  return (
    <Card
      title="Valuación"
      description="Múltiplos contra el sector y un DCF con supuestos que puedes mover. El resultado es un rango que depende de esos supuestos, no un precio objetivo."
      status={(custom ? tuned.data?.meta : null) ?? data?.meta}
    >
      <QueryBlock query={base} lines={6}>
        {() => (
          <div className="kz-col" data-gap="6">
            <section aria-labelledby="kz-val-mult" className="kz-col" data-gap="2">
              <h3 id="kz-val-mult">Múltiplos</h3>
              <Multiples multiples={data.multiples} currency={data.currency} />
            </section>
            <Bank bank={(shown ?? data).bank} currency={data.currency} />
            <section aria-labelledby="kz-val-dcf" className="kz-col" data-gap="2">
              <h3 id="kz-val-dcf">Flujo descontado (DCF)</h3>
              <form onSubmit={apply} className="kz-col kz-research-form" data-gap="2" aria-label="Supuestos del DCF" noValidate>
                <p className="kz-research-muted">
                  Supuestos actuales: tasa libre de riesgo {fmtPct(a?.rf)}, prima de mercado {fmtPct(a?.erp)}, riesgo país {fmtPct(a?.crp)},
                  crecimiento terminal {fmtPct(a?.terminalGrowth)}. Escribe porcentajes, por ejemplo 5.5.
                </p>
                <div className="kz-row" data-gap="2">
                  {field('erp', 'Prima de mercado')}
                  {field('crp', 'Riesgo país')}
                  {field('growth', 'Crecimiento inicial')}
                  {field('terminalGrowth', 'Crecimiento terminal')}
                  {field('years', 'Años de proyección', { decimals: 0 })}
                </div>
                <div className="kz-research-form__actions">
                  <Button type="submit" variant="secondary">Recalcular</Button>
                  {custom ? (
                    <Button type="button" variant="ghost" onClick={reset}>
                      Volver a los supuestos del servidor
                    </Button>
                  ) : null}
                </div>
              </form>
              {custom && tuned.isPending ? (
                <div aria-busy="true">
                  <SrOnly>Recalculando</SrOnly>
                  <Skeleton lines={4} />
                </div>
              ) : null}
              {custom && tuned.isError ? (
                <ErrorState
                  size="sm"
                  message={tuned.error instanceof Error ? tuned.error.message : 'No pudimos recalcular con esos supuestos.'}
                  onRetry={() => tuned.refetch()}
                  retrying={tuned.isFetching}
                />
              ) : null}
              {shown ? <Dcf dcf={shown.dcf} currency={dcfCurrency(shown)} quoteCurrency={shown.currency} /> : null}
            </section>
            <SectionNotes notes={shown?.meta?.notes ?? data.meta?.notes} label="Avisos de la valuación" />
          </div>
        )}
      </QueryBlock>
    </Card>
  )
}
