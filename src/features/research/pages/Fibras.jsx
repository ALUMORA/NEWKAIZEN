// FIBRAs (/screener/fibras?extra=A,B): apalancamiento, cap rate implícito, flujo, distribución
// pagada, P/NAV y diferencial contra la tasa de referencia, como los calcula /v2/screeners/fibras.
// Lo que falta sale como s/d con su motivo, y si la tasa es sustituta la pantalla lo dice.
import { Suspense, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { fibrasScreenerQuery } from '../../../lib/api/queries.js'
import { MISSING, fmtDate, fmtMoney, fmtMultiple, fmtPct, fmtPp } from '../../../lib/format.js'
import { Button, Card, DataTable, InfoTip, Input, PageHeader, Skeleton, Stat } from '../../../components/ui/index.js'
import { PATHS, pathInstrument } from '../../../app/paths.js'
import { QueryBlock } from '../components/QueryBlock.jsx'
import { Bars } from '../components/screenerCharts.js'
import {
  BASIS_LABEL,
  MAX_EXTRA,
  SIGNAL_LABEL,
  TYPE_LABEL,
  describeRate,
  missingFields,
  parseExtra,
  rateDate,
  splitRateNotes,
  spreadBars,
} from '../fibras.js'
import { generalNotes, notesFor, readableMeta } from '../screenerNotes.js'
import '../research.css'
import '../magic-fibras.css'

const METHOD_PATH = '/aprender/metodologia/fibras'

/** @param {string} symbol */
const reasonId = (symbol) => `fibra-sd-${symbol.replace(/[^A-Za-z0-9]/g, '-')}`

/** @param {{ rows: any[], notes: string[], against: string, status: any, loading?: boolean }} props */
function Table({ rows, notes, against, status, loading = false }) {
  const columns = [
    {
      key: 'symbol',
      header: 'FIBRA',
      minWidth: 170,
      format: (v, row) => {
        const own = notesFor(v, notes)
        return (
          <span className="kz-scr-symbol">
            <span className="kz-scr-symbol__body">
              <span className="kz-row" data-gap="1" data-align="center">
                <Link to={pathInstrument(v)}>{v}</Link>
                {own.length ? (
                  <InfoTip
                    term={`${v}: por qué hay s/d`}
                    label={`Por qué hay s/d en ${v}`}
                    text={own.join(' ')}
                  />
                ) : null}
              </span>
              <span className="kz-scr-symbol__name">{row.name || MISSING}</span>
              <span className="kz-scr-symbol__name">{TYPE_LABEL[row.type] ?? TYPE_LABEL.otro}</span>
            </span>
          </span>
        )
      },
    },
    { key: 'price', header: 'Precio', numeric: true, sortable: true, format: (v, row) => fmtMoney(v, row.currency) },
    {
      key: 'pNav',
      header: 'P/NAV',
      numeric: true,
      sortable: true,
      info: { termKey: 'nav-p-nav', term: 'P/NAV' },
      format: (v, row) => (
        <>
          {fmtMultiple(v, { decimals: 2 })}
          <span className="kz-scr-sub">{SIGNAL_LABEL[row.signal] ?? SIGNAL_LABEL.sin_datos}</span>
        </>
      ),
    },
    {
      key: 'navPerCbfi',
      header: 'NAV por CBFI',
      numeric: true,
      sortable: true,
      info: { term: 'NAV por CBFI', text: 'Valor en libros por certificado que reporta la FIBRA. No es un avalúo independiente.' },
      format: (v, row) => fmtMoney(v, row.currency),
    },
    {
      key: 'distributionYield',
      header: 'Distribución pagada 12 m',
      numeric: true,
      sortable: true,
      info: { termKey: 'rendimiento-por-distribucion', term: 'Rendimiento por distribución' },
      format: (v) => fmtPct(v),
    },
    {
      key: 'spreadVsCetes',
      header: 'Diferencial vs tasa',
      numeric: true,
      sortable: true,
      info: {
        term: 'Diferencial contra la tasa',
        text: `Distribución pagada en 12 meses menos ${against}. Describe cuánto paga la FIBRA por encima de la tasa de corto plazo; no es una recomendación.`,
      },
      format: (v) => fmtPp(v),
    },
    { key: 'ltv', header: 'LTV', numeric: true, sortable: true, info: { termKey: 'ltv', term: 'LTV' }, format: (v) => fmtPct(v, { decimals: 1 }) },
    {
      key: 'debtToMarketCap',
      header: 'Deuda / capitalización',
      numeric: true,
      sortable: true,
      info: {
        term: 'Deuda entre capitalización',
        text: 'Deuda total entre el valor de mercado de los certificados. Se mueve con el precio; el LTV, que es sobre activos, no.',
      },
      format: (v) => fmtMultiple(v, { decimals: 2 }),
    },
    {
      key: 'capRate',
      header: 'Cap rate implícito',
      numeric: true,
      sortable: true,
      info: { termKey: 'cap-rate', term: 'Cap rate' },
      format: (v) => fmtPct(v, { decimals: 1 }),
    },
    {
      key: 'cashFlowYield',
      header: 'Rendimiento de flujo',
      numeric: true,
      sortable: true,
      info: {
        term: 'Rendimiento de flujo',
        text: 'Flujo de operación entre capitalización, o flujo libre si no hay de operación. No es FFO: la fuente pública no permite calcularlo.',
      },
      format: (v, row) => (
        <>
          {fmtPct(v, { decimals: 1 })}
          {row.cashFlowBasis ? <span className="kz-scr-sub">{BASIS_LABEL[row.cashFlowBasis] ?? row.cashFlowBasis}</span> : null}
        </>
      ),
    },
    { key: 'marketCap', header: 'Capitalización', numeric: true, sortable: true, format: (v, row) => fmtMoney(v, row.currency, { compact: true }) },
  ]
  return (
    <Card
      title="FIBRAs ordenadas por P/NAV"
      info={{ termKey: 'fibra', term: 'FIBRA' }}
      description="De menor a mayor precio contra valor en libros; las que no tienen NAV van al final. La etiqueta describe el precio contra libros (descuento abajo de 0.90, prima arriba de 1.10) y no es una recomendación."
      status={status}
      padding="none"
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey="symbol"
        caption="FIBRAs ordenadas por P/NAV"
        captionHidden
        className="kz-scr-table"
        defaultSort={{ key: 'pNav', direction: 'ascending' }}
        loading={loading}
        density="compact"
        empty={{ title: 'Sin FIBRAs para mostrar' }}
      />
    </Card>
  )
}

/** @param {{ rate: ReturnType<typeof describeRate>, value: number | null, date: string | null, notes: string[] }} props */
function RateBody({ rate, value, date, notes }) {
  return (
    <div className="kz-col" data-gap="3">
      <Stat
        label={rate.label}
        value={value == null ? MISSING : fmtPct(value)}
        sublabel={`Fuente: ${rate.sourceLabel}${date ? `, dato del ${fmtDate(date)}` : ''}`}
        size="lg"
      />
      {rate.missing ? (
        <div role="note" aria-label="Sin tasa de referencia" className="kz-research-warning">
          El servidor no tiene tasa de referencia en este momento, así que el diferencial sale como s/d.
        </div>
      ) : rate.substitute ? (
        <div role="note" aria-label="Tasa sustituta" className="kz-col kz-research-warning" data-gap="2">
          <p className="kz-research-about">
            <strong>No son CETES de 28 días.</strong> Mientras el servidor no tenga CETES de Banxico, el diferencial se
            mide contra una tasa sustituta de corto plazo. Sirve como referencia, pero no es la misma tasa.
          </p>
          {notes.length ? (
            <ul className="kz-scr-list">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="kz-research-muted">CETES a 28 días de Banxico, publicados por el servidor con su fecha.</p>
      )}
    </div>
  )
}

/** @param {{ extra: string[], onApply: (list: string[]) => void }} props */
function ExtraForm({ extra, onApply }) {
  const [text, setText] = useState(extra.join(', '))
  const [error, setError] = useState('')
  const submit = (event) => {
    event.preventDefault()
    const list = parseExtra(text)
    const typed = String(text).split(/[,\s]+/).filter(Boolean).length
    if (typed > MAX_EXTRA) {
      setError(`Caben hasta ${MAX_EXTRA} FIBRAs adicionales.`)
      return
    }
    if (text.trim() && !list.length) {
      setError('Escribe claves separadas por coma, por ejemplo FIBRAHD15, EDUCA18.')
      return
    }
    setError('')
    onApply(list)
  }
  return (
    <Card title="Agregar FIBRAs" description="La lista base siempre se incluye. Puedes sumar otras por su clave de la BMV.">
      <div className="kz-col" data-gap="3">
        <form onSubmit={submit} className="kz-scr-extra">
          <Input
            label="FIBRAs adicionales"
            hint={`Hasta ${MAX_EXTRA}, separadas por coma. Por ejemplo: FIBRAHD15, EDUCA18`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={error || undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="secondary">
            Actualizar tabla
          </Button>
        </form>
        {extra.length ? (
          <div className="kz-row" data-gap="2" data-align="center">
            <p className="kz-research-muted">Agregadas: {extra.join(', ')}.</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setText('')
                onApply([])
              }}
            >
              Quitar las agregadas
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

/** @param {{ rows: any[], notes: string[] }} props */
function Reasons({ rows, notes }) {
  const items = rows
    .map((row) => ({ row, missing: missingFields(row), own: notesFor(row.symbol, notes) }))
    .filter((x) => x.missing.length || x.own.length)
  return (
    <Card
      title="Datos que faltan y por qué"
      description="Cuando un estado financiero no es de la FIBRA, es viejo o no cuadra, sus métricas salen como s/d en lugar de un número inventado."
    >
      {items.length ? (
        <ul className="kz-scr-reasons">
          {items.map(({ row, missing, own }) => (
            <li key={row.symbol} id={reasonId(row.symbol)}>
              <h3 className="kz-scr-h3">
                <span className="mono">{row.symbol}</span> {row.name ? <span className="kz-research-muted">{row.name}</span> : null}
              </h3>
              {missing.length ? <p className="kz-research-muted">En s/d: {missing.join(', ')}.</p> : null}
              {own.length ? (
                <ul className="kz-scr-list">
                  {own.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : (
                <p className="kz-research-muted">El servidor no explicó por qué faltan; el reporte trimestral de la FIBRA puede traer esas cifras.</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="kz-research-muted">Todas las FIBRAs de la tabla tienen todos sus datos.</p>
      )}
    </Card>
  )
}

/** @param {{ rows: any[], rate: ReturnType<typeof describeRate>, status: any }} props */
function SpreadChart({ rows, rate, status }) {
  const data = spreadBars(rows)
  return (
    <Card title="Diferencial contra la tasa" padding="md">
      <Suspense fallback={<Skeleton height={Math.max(160, data.length * 30)} />}>
        <Bars
          title="Diferencial por FIBRA"
          titleAs="h3"
          description={`Distribución pagada en 12 meses menos ${rate.against}. En puntos porcentuales; las que no tienen dato van al final como s/d.`}
          data={data}
          format="pp"
          decimals={2}
          color={1}
          categoryLabel="FIBRA"
          valueLabel="Diferencial"
          status={status}
          emptyText="Ninguna FIBRA tiene diferencial"
        />
      </Suspense>
    </Card>
  )
}

/** @param {{ notes: string[] }} props */
function Notes({ notes }) {
  return (
    <Card
      title="Notas del cálculo"
      description="Cómo se leen estas cifras y de qué fecha son."
      footer={
        <Link className="kz-scr-link" to={METHOD_PATH}>
          Metodología completa de FIBRAs
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
        <p className="kz-research-muted">El servidor no dejó avisos generales.</p>
      )}
    </Card>
  )
}

export default function Fibras() {
  const [params, setParams] = useSearchParams()
  const extraParam = params.get('extra')
  const extra = useMemo(() => parseExtra(extraParam), [extraParam])
  const query = useQuery(fibrasScreenerQuery(extra))
  const data = query.data
  const rows = data?.rows ?? []
  const notes = data?.meta?.notes ?? []
  const rate = describeRate(data?.meta, data?.cetes28)
  const general = generalNotes(notes, rows.map((r) => r.symbol))
  const split = splitRateNotes(general)
  const rateAsOf = rateDate(notes)
  // La tarjeta de la tasa lleva la fecha y la fuente de la tasa, no las de los precios; el respaldo
  // (fallback) y lo viejo (stale) son los que dijo el servidor.
  const rateStatus = readableMeta(data?.meta, {
    ...(rate.source ? { source: rate.source === 'fred' ? 'FRED' : 'Banxico' } : {}),
    ...(rateAsOf ? { asOf: rateAsOf } : {}),
  })
  const status = readableMeta(data?.meta)

  const applyExtra = (list) => {
    const next = new URLSearchParams(params)
    if (list.length) next.set('extra', list.join(','))
    else next.delete('extra')
    setParams(next, { replace: true })
  }

  return (
    <div className="kz-container kz-col kz-research-page" data-gap="6">
      <PageHeader
        eyebrow="Screener"
        title="FIBRAs"
        description="Fideicomisos de bienes raíces de la BMV: apalancamiento, cap rate implícito, flujo, distribución pagada, precio contra valor en libros y diferencial contra la tasa de corto plazo. Describe cada FIBRA; no es una recomendación de inversión."
        breadcrumbs={[{ label: 'Investigar', to: PATHS.research }, { label: 'FIBRAs' }]}
        actions={
          <Link className="kz-button" data-variant="secondary" data-size="sm" to={METHOD_PATH}>
            Cómo se calcula
          </Link>
        }
      />
      <div className="kz-research-grid" data-cols="2">
        <Card title="Tasa de referencia" status={rateStatus} description="La tasa contra la que se mide el diferencial de cada FIBRA.">
          <QueryBlock query={query} lines={3}>
            {() => <RateBody rate={rate} value={data.cetes28} date={rateAsOf} notes={split.rate} />}
          </QueryBlock>
        </Card>
        <ExtraForm key={extra.join(',')} extra={extra} onApply={applyExtra} />
      </div>
      {query.isPending ? <Table rows={[]} notes={[]} against={rate.against} status={undefined} loading /> : null}
      {data ? (
        <>
          <Table rows={rows} notes={notes} against={rate.against} status={status} />
          <div className="kz-research-grid" data-cols="2">
            <SpreadChart rows={rows} rate={rate} status={status} />
            <Reasons rows={rows} notes={notes} />
          </div>
          <Notes notes={split.rest} />
        </>
      ) : null}
    </div>
  )
}
