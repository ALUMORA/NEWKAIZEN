// Comparador (/investigar/comparar?symbols=A,B): de 2 a 5 emisoras con sus múltiplos y
// rendimientos lado a lado, y su precio en base 100 desde el panel. Cada bloque tiene sus estados.
import { Suspense, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { instrumentQuery, panelQuery } from '../../../lib/api/queries.js'
import { fmtMoney, fmtMultiple, fmtPct } from '../../../lib/format.js'
import { Button, Card, DataStatus, DataTable, Delta, EmptyState, Input, PageHeader, Skeleton } from '../../../components/ui/index.js'
import { PATHS, pathCompare, pathInstrument } from '../../../app/paths.js'
import { QueryBlock } from '../components/QueryBlock.jsx'
import { parseSymbols } from '../symbols.js'
import { TimeSeries } from '../components/charts.js'
import '../research.css'

const MIN = 2
const MAX = 5
const METRICS = [
  { key: 'price', label: 'Precio', format: (i) => fmtMoney(i.quote?.price, i.priceCurrency) },
  { key: 'changePct', label: 'Cambio del día', format: (i) => <Delta value={i.quote?.changePct} /> },
  { key: 'pe', label: 'P/U', format: (i) => fmtMultiple(i.fundamentals?.pe) },
  { key: 'pb', label: 'P/VL', format: (i) => fmtMultiple(i.fundamentals?.pb) },
  { key: 'evEbitda', label: 'VE/EBITDA', format: (i) => fmtMultiple(i.fundamentals?.evEbitda) },
  { key: 'dividendYield', label: 'Rendimiento por dividendo', format: (i) => fmtPct(i.fundamentals?.dividendYield) },
  { key: 'roe', label: 'ROE', format: (i) => fmtPct(i.fundamentals?.roe) },
  { key: 'netMargin', label: 'Margen neto', format: (i) => fmtPct(i.fundamentals?.netMargin) },
  { key: 'debtToEquity', label: 'Deuda / capital', format: (i) => fmtMultiple(i.fundamentals?.debtToEquity, { decimals: 2 }) },
  { key: 'revenueGrowthYoY', label: 'Crecimiento de ingresos', format: (i) => <Delta value={i.fundamentals?.revenueGrowthYoY} /> },
]

function Fundamentals({ symbols }) {
  const queries = useQueries({ queries: symbols.map((s) => instrumentQuery(s)) })
  const loading = queries.some((q) => q.isPending)
  const failed = symbols.filter((_, i) => queries[i].isError)
  const columns = [
    { key: 'label', header: 'Dato', minWidth: 160 },
    ...symbols.map((s, i) => ({
      key: s,
      header: queries[i].data?.name ? `${s}` : s,
      align: /** @type {const} */ ('right'),
      format: (_v, row) => (queries[i].data ? row.format(queries[i].data) : queries[i].isError ? 's/d' : ''),
    })),
  ]
  const rows = METRICS.map((m) => ({ ...m, id: m.key }))
  const statuses = queries.map((q, i) => ({ symbol: symbols[i], meta: q.data?.meta })).filter((x) => x.meta)
  return (
    <Card title="Múltiplos y rentabilidad" padding="none">
      <DataTable columns={columns} rows={rows} rowKey="id" caption="Múltiplos y rentabilidad lado a lado" captionHidden loading={loading} density="compact" />
      <div className="kz-row kz-research-foot" data-gap="3">
        {statuses.map((s) => (
          <span key={s.symbol} className="kz-row" data-gap="2">
            <span className="kz-research-muted">{s.symbol}</span>
            <DataStatus {...s.meta} />
          </span>
        ))}
      </div>
      {failed.length ? (
        <p className="kz-research-muted kz-research-foot" role="status">
          No pudimos cargar {failed.join(', ')}. Sus columnas quedan como s/d.
        </p>
      ) : null}
    </Card>
  )
}

function Performance({ symbols }) {
  const query = useQuery(panelQuery(symbols, { range: '1y', ccy: 'MXN' }))
  const data = query.data
  const dates = data?.dates ?? []
  const present = symbols.filter((s) => Array.isArray(data?.prices?.[s]) && data.prices[s].length)
  const series = present.map((s) => {
    const prices = data.prices[s]
    const base = prices.find((p) => typeof p === 'number' && p > 0)
    return { id: s, label: s, points: dates.map((date, i) => ({ date, value: base && prices[i] != null ? (prices[i] / base) * 100 : null })) }
  })
  const returns = present.map((s) => {
    const prices = data.prices[s]
    const first = prices.find((p) => typeof p === 'number' && p > 0)
    const last = [...prices].reverse().find((p) => typeof p === 'number')
    return { id: s, symbol: s, ret: first && last != null ? last / first - 1 : null }
  })
  return (
    <Card
      title="Rendimiento a un año"
      description="Precios en pesos, base 100 al inicio del periodo. Solo fechas en que todas cotizaron."
      status={data?.meta}
    >
      <QueryBlock query={query} isEmpty={series.length === 0} emptyTitle="Sin historia en común para estas emisoras" lines={6}>
        {() => (
          <div className="kz-col" data-gap="3">
            <Suspense fallback={<Skeleton height={280} />}>
              <TimeSeries title="Precio en base 100" titleAs="h3" series={series} format="number" decimals={1} />
            </Suspense>
            <DataTable
              columns={[
                { key: 'symbol', header: 'Emisora' },
                { key: 'ret', header: 'Rendimiento en el periodo', numeric: true, format: (v) => <Delta value={v} /> },
              ]}
              rows={returns}
              rowKey="id"
              caption="Rendimiento de cada emisora en el periodo"
              density="compact"
            />
            {data?.dropped?.length ? (
              <p className="kz-research-muted" role="status">
                Sin datos suficientes: {data.dropped.map((d) => `${d.symbol} (${d.reason})`).join(', ')}.
              </p>
            ) : null}
          </div>
        )}
      </QueryBlock>
    </Card>
  )
}

export default function Compare() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const symbols = parseSymbols(params.get('symbols')).slice(0, MAX)
  const [text, setText] = useState(symbols.join(', '))
  const [error, setError] = useState('')
  const valid = symbols.length >= MIN

  const submit = (event) => {
    event.preventDefault()
    const next = parseSymbols(text)
    if (next.length < MIN || next.length > MAX) {
      setError(`Escribe de ${MIN} a ${MAX} claves separadas por coma, por ejemplo WALMEX.MX, AAPL.`)
      return
    }
    setError('')
    navigate(pathCompare(next))
  }

  return (
    <div className="kz-container kz-col kz-research-page" data-gap="6">
      <PageHeader
        title="Comparar emisoras"
        description="De 2 a 5 emisoras lado a lado: valuación, rentabilidad, deuda y rendimiento. Sirve para entender diferencias, no es una recomendación."
        breadcrumbs={[{ label: 'Investigar', to: PATHS.research }, { label: 'Comparar' }]}
      />
      <Card title="Emisoras">
        <div className="kz-col" data-gap="3">
        <form onSubmit={submit} className="kz-row kz-research-compare-form" data-gap="3" data-align="start">
          <Input
            label="Claves de las emisoras"
            hint="Separadas por coma. Por ejemplo: WALMEX.MX, FEMSAUBD.MX, AAPL"
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={error || undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit">Comparar</Button>
        </form>
        {symbols.length ? (
          <p className="kz-research-muted">
            Fichas:{' '}
            {symbols.map((s, i) => (
              <span key={s}>
                {i ? ', ' : ''}
                <Link to={pathInstrument(s)}>{s}</Link>
              </span>
            ))}
          </p>
        ) : null}
        </div>
      </Card>
      {valid ? (
        <>
          <Fundamentals symbols={symbols} />
          <Performance symbols={symbols} />
        </>
      ) : (
        <EmptyState
          headingAs="h2"
          title="Elige al menos dos emisoras"
          text="Escribe sus claves arriba para verlas lado a lado."
        />
      )}
    </div>
  )
}
