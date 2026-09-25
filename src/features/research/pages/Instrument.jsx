// Ficha de la emisora (/investigar/:symbol). Cada bloque trae su consulta con su DataStatus y sus
// estados de carga, vacío y error: si una sección falla, el resto de la ficha sigue en pie.
import { Suspense, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { dividendsQuery, historyQuery, instrumentQuery, momentumQuery, newsQuery, statementsQuery } from '../../../lib/api/queries.js'
import { fmtDate, fmtDateTime, fmtMoney, fmtMultiple, fmtNumber, fmtPct } from '../../../lib/format.js'
import { Card, DataTable, Delta, PageHeader, SegmentedControl, Skeleton, Stat } from '../../../components/ui/index.js'
import { PATHS } from '../../../app/paths.js'
import { usePageTitle } from '../../../app/pageTitle.js'
import { QueryBlock } from '../components/QueryBlock.jsx'
import { TimeSeries } from '../components/charts.js'
import { Valuation } from '../components/Valuation.jsx'
import { SectionNotes } from '../components/SectionNotes.jsx'
import { safeUrl } from '../symbols.js'
import { countryEs, looksEnglish, sectorEs } from '../yahoo-labels.js'
import '../research.css'

const RANGES = [
  { value: '6mo', label: '6 meses' },
  { value: '1y', label: '1 año' },
  { value: '5y', label: '5 años' },
  { value: 'max', label: 'Todo' },
]

function Overview({ query }) {
  const data = query.data
  const q = data?.quote
  const f = data?.fundamentals ?? {}
  const ccy = data?.priceCurrency
  return (
    <Card title="Resumen" status={data?.meta}>
      <QueryBlock query={query} lines={5}>
        {() => (
          <div className="kz-col" data-gap="3">
            <div className="kz-research-stats">
              <Stat
                size="lg"
                label="Precio"
                value={fmtMoney(q?.price, ccy)}
                delta={<Delta value={q?.changePct} hint="en el día" />}
                sublabel={q?.asOf ? `Al ${fmtDateTime(q.asOf)}` : undefined}
              />
              <Stat label="Rango de 52 semanas" value={`${fmtMoney(q?.low52w, ccy)} a ${fmtMoney(q?.high52w, ccy)}`} />
              <Stat label="Valor de mercado" value={fmtMoney(q?.marketCap, ccy, { compact: true })} />
              <Stat label="P/U" value={fmtMultiple(f.pe)} info={{ termKey: 'p-u', term: 'P/U' }} />
              <Stat label="P/VL" value={fmtMultiple(f.pb)} info={{ termKey: 'p-vl', term: 'P/VL' }} />
              <Stat label="VE/EBITDA" value={fmtMultiple(f.evEbitda)} info={{ termKey: 'ev-ebitda', term: 'VE/EBITDA' }} />
              <Stat label="ROE" value={fmtPct(f.roe)} info={{ termKey: 'roe', term: 'ROE' }} />
              <Stat label="Rendimiento por dividendo" value={fmtPct(f.dividendYield)} />
              <Stat label="Deuda / capital" value={fmtMultiple(f.debtToEquity, { decimals: 2 })} info={{ termKey: 'deuda-capital', term: 'Deuda / capital' }} />
              <Stat
                label="Beta"
                value={fmtNumber(data?.beta?.value)}
                sublabel={data?.beta ? `Contra ${data.beta.benchmark}` : undefined}
                info={{ termKey: 'beta', term: 'Beta' }}
              />
            </div>
            <p className="kz-research-muted">
              {[data?.exchange, sectorEs(data?.sector), data?.industry, countryEs(data?.country)].filter(Boolean).join(' · ')}
              {data?.coverage ? ` · ${data.coverage.available} de ${data.coverage.total} datos disponibles` : ''}
            </p>
            {data?.fxUsed ? (
              <p className="kz-research-muted">
                Los estados financieros vienen en {data.financialCurrency} y se convirtieron a {ccy} con {data.fxUsed.pair}{' '}
                <span className="num">{fmtNumber(data.fxUsed.rate, { decimals: 4 })}</span> del {fmtDate(data.fxUsed.asOf)}.
              </p>
            ) : null}
            {data?.description ? (
              looksEnglish(data.description) ? (
                <>
                  <p className="kz-research-muted">Descripción de Yahoo Finance, que solo la publica en inglés:</p>
                  <p className="kz-research-about" lang="en">{data.description}</p>
                </>
              ) : (
                <p className="kz-research-about">{data.description}</p>
              )
            ) : null}
            <SectionNotes notes={data?.meta?.notes} label="Avisos del resumen" />
          </div>
        )}
      </QueryBlock>
    </Card>
  )
}

function History({ symbol, name }) {
  const [range, setRange] = useState('1y')
  const query = useQuery(historyQuery(symbol, { range }))
  const data = query.data
  const points = (data?.dates ?? []).map((date, i) => ({
    date,
    value: data.close[i] ?? null,
  }))
  return (
    <Card title="Precio histórico" description="Cierres ajustados por splits y dividendos." status={data?.meta}>
      <div className="kz-col" data-gap="3">
        <SegmentedControl label="Periodo" hideLabel items={RANGES} value={range} onChange={setRange} />
        <QueryBlock query={query} isEmpty={points.length === 0} emptyTitle="Sin historia para este periodo" lines={6}>
          {() => (
            <Suspense fallback={<Skeleton height={280} />}>
              <TimeSeries
                title={`Precio de ${name ?? symbol}`}
                titleAs="h3"
                series={[{ id: symbol, label: symbol, points }]}
                format="money"
                currency={data.currency}
              />
            </Suspense>
          )}
        </QueryBlock>
      </div>
    </Card>
  )
}

function Statements({ symbol }) {
  const [freq, setFreq] = useState(/** @type {'annual' | 'quarterly'} */ ('annual'))
  const query = useQuery(statementsQuery(symbol, freq))
  const data = query.data
  const periods = data?.periods ?? []
  const columns = [
    { key: 'label', header: 'Concepto', minWidth: 180 },
    ...periods.map((p, i) => ({
      key: `p${i}`,
      header: p.fiscalQuarter ? `T${p.fiscalQuarter} ${p.fiscalYear}` : String(p.fiscalYear ?? fmtDate(p.end)),
      numeric: true,
      format: (v, row) => (row.id === 'eps' ? fmtNumber(v) : fmtNumber(v, { compact: true })),
    })),
  ]
  const rows = (data?.rows ?? []).map((r) => {
    /** @type {Record<string, unknown>} */
    const row = { id: r.id, label: r.label }
    r.values.forEach((v, i) => {
      row[`p${i}`] = v
    })
    return row
  })
  return (
    <Card
      title="Estados financieros"
      description={data ? `Cifras en ${data.currency}. Solo renglones reportados, nada se estima.` : undefined}
      status={data?.meta}
      padding="none"
      actions={
        <SegmentedControl
          label="Frecuencia"
          hideLabel
          items={[
            { value: 'annual', label: 'Anual' },
            { value: 'quarterly', label: 'Trimestral' },
          ]}
          value={freq}
          onChange={setFreq}
        />
      }
    >
      <QueryBlock query={query} isEmpty={periods.length === 0 || rows.length === 0} emptyTitle="Sin estados financieros disponibles" lines={6}>
        {() => (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey="id"
            caption={`Estados financieros ${freq === 'annual' ? 'anuales' : 'trimestrales'}`}
            captionHidden
            density="compact"
          />
        )}
      </QueryBlock>
    </Card>
  )
}

function Momentum({ symbol }) {
  const query = useQuery(momentumQuery(symbol))
  const d = query.data
  return (
    <Card title="Momentum" info={{ termKey: 'momentum-12-1', term: 'Momentum 12-1' }} status={d?.meta}>
      <QueryBlock query={query} lines={3}>
        {() => (
          <div className="kz-col" data-gap="3">
            <div className="kz-research-stats">
              <Stat label="12 meses sin el último" value={<Delta value={d.r12m1} />} />
              <Stat label={d.benchmark ? `Referencia (${d.benchmark})` : 'Referencia (sin índice en su moneda)'} value={<Delta value={d.benchmarkR12m1} />} />
              <Stat label="Diferencia contra la referencia" value={<Delta value={d.relative12m1} kind="pp" />} />
              <Stat label="6 meses" value={<Delta value={d.r6m} />} />
              <Stat label="3 meses" value={<Delta value={d.r3m} />} />
            </div>
            <SectionNotes notes={d.meta?.notes} label="Avisos del momentum" />
          </div>
        )}
      </QueryBlock>
    </Card>
  )
}

function Dividends({ symbol }) {
  const query = useQuery(dividendsQuery(symbol))
  const d = query.data
  const history = [...(d?.history ?? [])].reverse().slice(0, 12)
  return (
    <Card title="Dividendos" status={d?.meta}>
      <QueryBlock
        query={query}
        isEmpty={!d?.history?.length}
        emptyTitle="Sin dividendos registrados"
        emptyText="Esta emisora no ha pagado dividendos en el periodo disponible."
        lines={4}
      >
        {() => (
          <div className="kz-col" data-gap="3">
            <div className="kz-metric-grid">
              <Stat label="Últimos 12 meses" value={fmtMoney(d.ttm, d.currency)} />
              <Stat label="Rendimiento" value={fmtPct(d.yield)} />
            </div>
            <DataTable
              columns={[
                { key: 'date', header: 'Fecha', format: (v) => fmtDate(v) },
                {
                  key: 'amount',
                  header: 'Monto por acción',
                  numeric: true,
                  format: (v) => fmtMoney(v, d.currency, { decimals: 4 }),
                },
              ]}
              rows={history}
              rowKey="date"
              caption="Dividendos más recientes"
              density="compact"
            />
            <SectionNotes notes={d.meta?.notes} label="Avisos de los dividendos" />
          </div>
        )}
      </QueryBlock>
    </Card>
  )
}

function News({ symbol }) {
  const query = useQuery(newsQuery({ symbol, limit: 8 }))
  const items = query.data?.items ?? []
  return (
    <Card title="Noticias" status={query.data?.meta}>
      <QueryBlock query={query} isEmpty={items.length === 0} emptyTitle="Sin noticias recientes" lines={4}>
        {() => (
          <ul className="kz-research-news">
            {items.map((n) => (
              <li key={n.id}>
                {safeUrl(n.url) ? (
                  <a href={safeUrl(n.url)} target="_blank" rel="noopener noreferrer">
                    {n.title}
                    <span className="sr-only"> (abre en otra pestaña)</span>
                  </a>
                ) : (
                  <span>{n.title}</span>
                )}
                <small>
                  {n.source} · {fmtDateTime(n.publishedAt)}
                </small>
              </li>
            ))}
          </ul>
        )}
      </QueryBlock>
    </Card>
  )
}

export default function Instrument() {
  const params = useParams()
  const symbol = String(params.symbol ?? '').toUpperCase()
  const info = useQuery(instrumentQuery(symbol))
  const name = info.data?.name
  usePageTitle(symbol ? `Ficha de ${symbol}` : null)
  return (
    <div className="kz-container kz-col kz-research-page" data-gap="6">
      <PageHeader
        title={name ? `${name} (${symbol})` : symbol}
        eyebrow="Ficha de la emisora"
        description="Precio, fundamentales, estados financieros, valuación y noticias. Es información para entender a la emisora, no una recomendación."
        breadcrumbs={[{ label: 'Investigar', to: PATHS.research }, { label: symbol }]}
      />
      <Overview query={info} />
      <History symbol={symbol} name={name} />
      <div className="kz-research-grid" data-cols="2">
        <Momentum symbol={symbol} />
        <Dividends symbol={symbol} />
      </div>
      <Valuation key={symbol} symbol={symbol} />
      <Statements symbol={symbol} />
      <News symbol={symbol} />
    </div>
  )
}
