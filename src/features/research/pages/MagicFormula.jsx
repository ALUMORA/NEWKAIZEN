// Fórmula mágica (/screener/formula-magica?universo=mx|us): el ranking de Greenblatt tal como lo
// calcula /v2/screeners/magic, con sus empates, sus exclusiones y sus notas a la vista. Es una
// lista ordenada por dos criterios públicos, no una recomendación.
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { magicScreenerQuery } from '../../../lib/api/queries.js'
import { MISSING, fmtDate, fmtInt, fmtMoney, fmtPct } from '../../../lib/format.js'
import { Badge, Card, DataTable, PageHeader, SegmentedControl, Stat } from '../../../components/ui/index.js'
import { PATHS, pathInstrument } from '../../../app/paths.js'
import { QueryBlock } from '../components/QueryBlock.jsx'
import { EXCLUSION_RULES, UNIVERSES, groupExclusions, parseUniverse, sharedValues, withPositions } from '../magicFormula.js'
import { ebitFallbackRows, readableMeta } from '../screenerNotes.js'
import '../research.css'
import '../magic-fibras.css'

const METHOD_PATH = '/aprender/metodologia/formula-magica'

const ROC_TEXT =
  'EBIT entre el capital que el negocio necesita para operar: capital de trabajo neto sin efectivo ni deuda de corto plazo, más el activo fijo neto.'

/** @param {number} value @param {Set<unknown>} shared */
function place(value, shared) {
  if (value == null) return MISSING
  return (
    <>
      {fmtInt(value)}
      {shared.has(value) ? <span className="kz-scr-tie"> (empate)</span> : null}
    </>
  )
}

/** @param {{ rows: any[], notes: string[], status: any, loading?: boolean }} props */
function Ranking({ rows, notes, status, loading = false }) {
  const ties = useMemo(
    () => ({ rank: sharedValues(rows, 'rank'), rankEY: sharedValues(rows, 'rankEY'), rankROC: sharedValues(rows, 'rankROC') }),
    [rows],
  )
  const fallback = useMemo(() => ebitFallbackRows(rows, notes), [rows, notes])
  const tiedRows = rows.filter((r) => ties.rank.has(r.rank)).length
  const columns = [
    {
      key: 'symbol',
      header: 'Emisora',
      minWidth: 200,
      format: (v, row) => (
        <span className="kz-scr-symbol">
          <span className="kz-scr-symbol__pos" title="Lugar en el ranking">
            {row.position}
          </span>
          <span className="kz-scr-symbol__body">
            <Link to={pathInstrument(v)}>{v}</Link>
            <span className="kz-scr-symbol__name">{row.name || MISSING}</span>
            {fallback.has(v) ? (
              <span className="kz-scr-symbol__tags">
                <Badge tone="warning">EBIT de respaldo</Badge>
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      key: 'rank',
      header: 'Suma de lugares',
      numeric: true,
      sortable: true,
      sortValue: (row) => row.position,
      format: (v) => place(v, ties.rank),
    },
    {
      key: 'earningsYield',
      header: 'Rendimiento de utilidades',
      numeric: true,
      sortable: true,
      info: { termKey: 'earnings-yield', term: 'Rendimiento de utilidades' },
      format: (v, row) => (
        <>
          {fmtPct(v, { decimals: 1 })}
          <span className="kz-scr-sub">lugar {place(row.rankEY, ties.rankEY)}</span>
        </>
      ),
    },
    {
      key: 'returnOnCapital',
      header: 'Rendimiento sobre capital',
      numeric: true,
      sortable: true,
      info: { term: 'Rendimiento sobre capital', text: ROC_TEXT },
      format: (v, row) => (
        <>
          {fmtPct(v, { decimals: 1 })}
          <span className="kz-scr-sub">lugar {place(row.rankROC, ties.rankROC)}</span>
        </>
      ),
    },
    {
      key: 'ebit',
      header: 'Utilidad de operación',
      numeric: true,
      sortable: true,
      format: (v, row) => (
        <>
          {fmtMoney(v, row.currency, { compact: true })}
          <span className="kz-scr-sub">cierre {fmtDate(row.fiscalPeriodEnd)}</span>
        </>
      ),
    },
    {
      key: 'enterpriseValue',
      header: 'Valor de empresa',
      numeric: true,
      sortable: true,
      info: { termKey: 'valor-empresa', term: 'Valor de empresa' },
      format: (v, row) => fmtMoney(v, row.currency, { compact: true }),
    },
    { key: 'sector', header: 'Sector', sortable: true, format: (v) => v || MISSING },
  ]
  return (
    <Card
      title="Ranking"
      info={{ termKey: 'formula-magica', term: 'Fórmula mágica' }}
      description="Cada emisora recibe un lugar por rendimiento de utilidades y otro por rendimiento sobre capital; se ordenan por la suma. Un mismo valor comparte lugar (1, 2, 2, 4). Si la suma empata, va primero el mejor lugar en rendimiento de utilidades y luego la clave en orden alfabético."
      status={status}
      padding="none"
      footer={
        loading ? undefined : (
          <p className="kz-research-muted">
            {tiedRows
              ? `${tiedRows} emisoras comparten su suma de lugares con otra; el orden entre ellas sigue la regla de desempate.`
              : 'Ninguna suma de lugares empata en este universo.'}
            {fallback.size ? ' Las marcadas con EBIT de respaldo usan el renglón EBIT de la fuente, que puede traer partidas no operativas.' : ''}
          </p>
        )
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey="symbol"
        caption="Ranking de la fórmula mágica"
        captionHidden
        className="kz-scr-table"
        defaultSort={{ key: 'rank', direction: 'ascending' }}
        loading={loading}
        density="compact"
        empty={{ title: 'Ninguna emisora pasó los filtros', text: 'Revisa abajo por qué quedó fuera cada una.' }}
      />
    </Card>
  )
}

/** @param {{ excluded: { symbol: string, reason: string }[] }} props */
function Exclusions({ excluded }) {
  const groups = groupExclusions(excluded)
  return (
    <Card title="Fuera del ranking" description="Las reglas son las del método y se aplican antes de ordenar. Cada emisora que quedó fuera lleva su motivo.">
      <div className="kz-col" data-gap="5">
        <section className="kz-col" data-gap="2" aria-labelledby="mf-rules">
          <h3 className="kz-scr-h3" id="mf-rules">Qué se excluye</h3>
          <ul className="kz-scr-list">
            {EXCLUSION_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </section>
        <section className="kz-col" data-gap="2" aria-labelledby="mf-excluded">
          <h3 className="kz-scr-h3" id="mf-excluded">
            Emisoras que quedaron fuera ({fmtInt(excluded.length)})
          </h3>
          {groups.length ? (
            <ul className="kz-scr-groups">
              {groups.map((g) => (
                <li key={g.reason}>
                  <p>{g.reason}</p>
                  <p className="kz-scr-symbols">{g.symbols.join(', ')}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="kz-research-muted">Ninguna emisora del universo quedó fuera.</p>
          )}
        </section>
      </div>
    </Card>
  )
}

/** @param {{ notes: string[] }} props */
function Notes({ notes }) {
  return (
    <Card
      title="Notas del cálculo"
      description="Lo que el servidor avisa sobre estos datos: cobertura, fechas y renglones de respaldo."
      footer={
        <Link className="kz-scr-link" to={METHOD_PATH}>
          Metodología completa de la fórmula mágica
        </Link>
      }
    >
      {notes.length ? (
        <ul className="kz-scr-list">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : (
        <p className="kz-research-muted">El servidor no dejó avisos para este universo.</p>
      )}
    </Card>
  )
}

export default function MagicFormula() {
  const [params, setParams] = useSearchParams()
  const universe = parseUniverse(params.get('universo'))
  const query = useQuery(magicScreenerQuery(universe))
  const data = query.data
  const rows = useMemo(() => withPositions(data?.rows ?? []), [data])
  const excluded = data?.excluded ?? []
  const notes = data?.meta?.notes ?? []

  const changeUniverse = (value) => {
    const next = new URLSearchParams(params)
    next.set('universo', value)
    setParams(next, { replace: true })
  }

  return (
    <div className="kz-container kz-col kz-research-page" data-gap="6">
      <PageHeader
        eyebrow="Screener"
        title="Fórmula mágica"
        description="Ordena emisoras por rendimiento de utilidades y rendimiento sobre capital, como propone Joel Greenblatt. Es una lista ordenada por dos criterios públicos, no una recomendación de inversión."
        breadcrumbs={[{ label: 'Investigar', to: PATHS.research }, { label: 'Fórmula mágica' }]}
        actions={
          <Link className="kz-button" data-variant="secondary" data-size="sm" to={METHOD_PATH}>
            Cómo se calcula
          </Link>
        }
      />
      <Card title="Universo" status={readableMeta(data?.meta)}>
        <div className="kz-col" data-gap="4">
          <div className="kz-scr-toolbar">
            <SegmentedControl label="Universo" hideLabel items={[...UNIVERSES]} value={universe} onChange={changeUniverse} />
          </div>
          <QueryBlock query={query} lines={3}>
            {() => (
              <div className="kz-col" data-gap="4">
                <p className="kz-scr-lead">
                  <strong>{data.universe.name}.</strong> {data.universe.description}
                </p>
                <div className="kz-research-stats">
                  <Stat label="Emisoras en el universo" value={fmtInt(data.universe.size)} />
                  <Stat label="En el ranking" value={fmtInt(rows.length)} />
                  <Stat label="Fuera del ranking" value={fmtInt(excluded.length)} sublabel="Con su motivo, más abajo" />
                </div>
                {data.partial ? (
                  <div role="note" aria-label="Tabla incompleta" className="kz-research-warning">
                    <strong>Tabla incompleta.</strong> El proveedor no respondió para algunas emisoras, así que el
                    ranking no cubre todo el universo y los lugares pueden cambiar cuando lleguen sus datos.
                  </div>
                ) : null}
              </div>
            )}
          </QueryBlock>
        </div>
      </Card>
      {query.isPending ? <Ranking rows={[]} notes={[]} status={undefined} loading /> : null}
      {data ? (
        <>
          <Ranking rows={rows} notes={notes} status={readableMeta(data.meta)} />
          <div className="kz-research-grid" data-cols="2">
            <Exclusions excluded={excluded} />
            <Notes notes={notes} />
          </div>
        </>
      ) : null}
    </div>
  )
}
