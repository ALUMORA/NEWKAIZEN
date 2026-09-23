// Valuación: múltiplos contra su referencia y DCF con supuestos editables. El DCF es un rango que
// depende de supuestos, no un precio objetivo; los avisos del servidor se muestran siempre.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { valuationQuery } from '../../../lib/api/queries.js'
import { fmtMoney, fmtMultiple, fmtPct } from '../../../lib/format.js'
import { Button, Card, DataTable, NumberInput, Stat } from '../../../components/ui/index.js'
import { QueryBlock } from './QueryBlock.jsx'

/** Porcentaje escrito por la persona (7.5) → fracción para el API (0.075). */
const toFraction = (pct) => (pct === null || pct === undefined ? undefined : pct / 100)

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
      caption="Malla de sensibilidad: valor por acción según WACC (filas) y crecimiento terminal (columnas)"
      density="compact"
    />
  )
}

function Dcf({ dcf, currency }) {
  if (!dcf?.applicable) return <p className="kz-research-muted">{dcf?.reason ?? 'El DCF no aplica a esta emisora.'}</p>
  const inputs = dcf.inputs ?? {}
  return (
    <div className="kz-col" data-gap="3">
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

/** @param {{ symbol: string }} props */
export function Valuation({ symbol }) {
  const [draft, setDraft] = useState({ erp: null, crp: null, terminalGrowth: null, growth: null, years: null })
  const [params, setParams] = useState({})
  const query = useQuery(valuationQuery(symbol, params))
  const data = query.data

  const apply = (event) => {
    event.preventDefault()
    /** @type {Record<string, number>} */
    const next = {}
    for (const key of ['erp', 'crp', 'terminalGrowth', 'growth']) {
      const v = toFraction(draft[key])
      if (v !== undefined) next[key] = v
    }
    if (draft.years !== null) next.years = Math.round(draft.years)
    setParams(next)
  }
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }))
  const a = data?.assumptions

  return (
    <Card
      title="Valuación"
      description="Múltiplos contra el sector y un DCF con supuestos que puedes mover. El resultado es un rango que depende de esos supuestos, no un precio objetivo."
      status={data?.meta}
    >
      <QueryBlock query={query} lines={6}>
        {() => (
          <div className="kz-col" data-gap="6">
            <section aria-labelledby="kz-val-mult" className="kz-col" data-gap="2">
              <h3 id="kz-val-mult">Múltiplos</h3>
              <Multiples multiples={data.multiples} currency={data.currency} />
            </section>
            <section aria-labelledby="kz-val-dcf" className="kz-col" data-gap="2">
              <h3 id="kz-val-dcf">Flujo descontado (DCF)</h3>
              <form onSubmit={apply} className="kz-col kz-research-form" data-gap="2" aria-label="Supuestos del DCF">
                <p className="kz-research-muted">
                  Supuestos actuales: tasa libre de riesgo {fmtPct(a?.rf)}, prima de mercado {fmtPct(a?.erp)}, riesgo país {fmtPct(a?.crp)},
                  crecimiento terminal {fmtPct(a?.terminalGrowth)}. Escribe porcentajes, por ejemplo 5.5.
                </p>
                <div className="kz-row" data-gap="2">
                  <NumberInput label="Prima de mercado" suffix="%" value={draft.erp} onChange={set('erp')} />
                  <NumberInput label="Riesgo país" suffix="%" value={draft.crp} onChange={set('crp')} />
                  <NumberInput label="Crecimiento inicial" suffix="%" value={draft.growth} onChange={set('growth')} />
                  <NumberInput label="Crecimiento terminal" suffix="%" value={draft.terminalGrowth} onChange={set('terminalGrowth')} />
                  <NumberInput label="Años de proyección" value={draft.years} onChange={set('years')} decimals={0} />
                </div>
                <div>
                  <Button type="submit" variant="secondary">Recalcular</Button>
                </div>
              </form>
              <Dcf dcf={data.dcf} currency={data.currency} />
            </section>
          </div>
        )}
      </QueryBlock>
    </Card>
  )
}
