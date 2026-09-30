// /watchlist: una lista de emisoras guardada en el navegador (storage v2), con precio, cambio del
// día y la tendencia de un mes. Agregar con el buscador y quitar con Deshacer.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, Plus } from 'lucide-react'
import { Button, Card, DataStatus, DataTable, Delta, EmptyState, Money, PageHeader, SearchCombobox, Skeleton, useToast } from '../../../components/ui/index.js'
import { Sparkline } from '../../../components/charts/Sparkline.jsx'
import { historyQuery, quotesQuery } from '../../../lib/api/queries.js'
import { LEGACY_WATCHLIST_NAME, update, useStore } from '../../../lib/storage.js'
import { checkNewSymbol } from '../add-symbol.js'
import { trendSummary } from '../trend.js'
import '../watchlist.css'

const EMPTY = []

function setSymbols(listId, fn) {
  update((state) => {
    const lists = state.watchlists ?? []
    if (!lists.length || !lists.some((l) => l.id === listId)) {
      return { ...state, watchlists: [...lists, { id: listId, name: LEGACY_WATCHLIST_NAME, symbols: fn([]) }] }
    }
    return { ...state, watchlists: lists.map((l) => (l.id === listId ? { ...l, symbols: fn(l.symbols) } : l)) }
  })
}

const TREND_PARAMS = { range: '1mo' }

function Trend({ symbol }) {
  const { data, isPending, isError } = useQuery(historyQuery(symbol, TREND_PARAMS))
  if (isPending) return <Skeleton width={80} height={24} />
  const t = isError ? null : trendSummary(data)
  if (!t) return <span className="kz-missing">s/d</span>
  return (
    <Sparkline values={data.close} label={`Tendencia de ${t.label}`}>
      {t.change != null ? <Delta value={t.change} /> : <span className="kz-missing">s/d</span>}
    </Sparkline>
  )
}

/** Pie de la tabla: periodo, tipo de precio y fuente de la tendencia (comparte caché con las filas). */
function TrendMeta({ symbol }) {
  const { data } = useQuery(historyQuery(symbol, TREND_PARAMS))
  const t = trendSummary(data)
  if (!t) return null
  return (
    <div className="wl-trend-meta">
      <p className="wl-note">{t.note}</p>
      {data?.meta && <DataStatus {...data.meta} />}
    </div>
  )
}

/**
 * Buscador de la lista: el SearchCombobox compartido (el de la paleta ⌘K). Las que ya están en la
 * lista no se ofrecen. Sin opciones (búsqueda caída o servidor viejo) o mientras la búsqueda no
 * alcanza al texto, Enter o "Agregar" agregan la clave escrita.
 * @param {{ onAdd: (symbol: string) => void, symbols: string[] }} props
 */
function SearchBox({ onAdd, symbols }) {
  const [q, setQ] = useState('')
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const tryAdd = (/** @type {string} */ raw) => {
    const out = checkNewSymbol(symbols, raw)
    setError(out.error)
    if (out.symbol) {
      onAdd(out.symbol)
      setQ('')
    }
  }
  return (
    <form
      className="wl-search"
      onSubmit={(e) => {
        e.preventDefault()
        tryAdd(q)
      }}
    >
      <SearchCombobox
        id="wl-buscar"
        label="Agregar una emisora"
        hint={
          <>
            Busca por clave o nombre, por ejemplo WALMEX o FEMSA.
            {error && (
              <span className="kz-error-text wl-search-error" role="alert">
                <CircleAlert size={14} aria-hidden="true" />
                {error}
              </span>
            )}
          </>
        }
        value={q}
        onValueChange={(v) => {
          setQ(v)
          setError(null)
        }}
        onSelect={(option) => tryAdd(option.symbol ?? option.label)}
        // En los 200 ms del debounce las opciones todavía son del texto anterior: Enter agrega lo
        // escrito, no la primera de esa búsqueda vieja.
        onEnter={({ q: typed, searching }) => {
          if (!searching) return false
          tryAdd(typed)
          return true
        }}
        exclude={symbols}
        limit={6}
        clearOnSelect={false}
      />
      <Button type="submit" variant="secondary" icon={<Plus size={16} />} disabled={!q.trim()}>
        Agregar
      </Button>
    </form>
  )
}

export default function Watchlist() {
  const toast = useToast()
  const lists = useStore((s) => s.watchlists) ?? EMPTY
  const list = lists[0] ?? null
  const listId = list?.id ?? 'wl-mi-lista'
  const symbols = list?.symbols ?? EMPTY
  const quotes = useQuery(quotesQuery(symbols))

  const rows = useMemo(() => {
    const bySymbol = new Map((quotes.data?.quotes ?? []).map((q) => [q.symbol, q]))
    return symbols.map((symbol) => ({ symbol, quote: bySymbol.get(symbol) ?? null }))
  }, [symbols, quotes.data])

  const add = (symbol) => {
    setSymbols(listId, (s) => (s.includes(symbol) ? s : [...s, symbol]))
    toast.show({ title: `${symbol} se agregó a tu lista`, tone: 'positive' })
  }
  const remove = (symbol) => {
    const index = symbols.indexOf(symbol)
    setSymbols(listId, (s) => s.filter((x) => x !== symbol))
    toast.show({
      title: `${symbol} salió de tu lista`,
      action: {
        label: 'Deshacer',
        onClick: () => setSymbols(listId, (s) => (s.includes(symbol) ? s : [...s.slice(0, index), symbol, ...s.slice(index)])),
      },
    })
  }

  const columns = [
    {
      key: 'symbol',
      header: 'Emisora',
      sortable: true,
      format: (value, row) => (
        <span className="wl-name">
          <strong>{value}</strong>
          {row.quote?.name && <span>{row.quote.name}</span>}
        </span>
      ),
    },
    { key: 'price', header: 'Precio', numeric: true, sortable: true, sortValue: (r) => r.quote?.price ?? null, format: (_, r) => (r.quote ? <Money value={r.quote.price} currency={r.quote.currency} /> : <span className="kz-missing">s/d</span>) },
    { key: 'change', header: 'Cambio del día', numeric: true, sortable: true, sortValue: (r) => r.quote?.changePct ?? null, format: (_, r) => (r.quote?.changePct != null ? <Delta value={r.quote.changePct} arrow /> : <span className="kz-missing">s/d</span>) },
    { key: 'trend', header: 'Un mes', align: 'right', format: (_, r) => <span className="wl-spark"><Trend symbol={r.symbol} /></span> },
    { key: 'actions', header: <span className="sr-only">Acciones</span>, align: 'right', format: (_, r) => <Button size="sm" variant="ghost" onClick={() => remove(r.symbol)}>Quitar<span className="sr-only"> {r.symbol}</span></Button> },
  ]

  const missing = quotes.data?.missing ?? EMPTY

  return (
    <div className="kz-container wl-page">
      <PageHeader title="Lista de seguimiento" description="Las emisoras que quieres tener a la vista. Se guarda solo en este navegador." />
      <SearchBox onAdd={add} symbols={symbols} />
      <Card
        title={list?.name ?? LEGACY_WATCHLIST_NAME}
        padding="none"
        status={quotes.data?.meta}
        description={symbols.length ? `${symbols.length} ${symbols.length === 1 ? 'emisora' : 'emisoras'}` : undefined}
      >
        {symbols.length === 0 ? (
          <EmptyState title="Tu lista está vacía" text="Usa el buscador de arriba para agregar la primera emisora." />
        ) : (
          <DataTable
            caption="Emisoras en seguimiento"
            captionHidden
            columns={columns}
            rows={rows}
            rowKey="symbol"
            loading={quotes.isPending}
            error={quotes.isError ? 'No pudimos cargar los precios.' : undefined}
            onRetry={() => quotes.refetch()}
          />
        )}
      </Card>
      {symbols.length > 0 && <TrendMeta symbol={symbols[0]} />}
      {missing.length > 0 && <p className="wl-note">Sin precio por ahora: {missing.join(', ')}.</p>}
    </div>
  )
}
