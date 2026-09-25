// Buscador de emisoras (/investigar): por nombre o clave con /v2/search (espera de 250 ms), con
// clave, nombre, bolsa y moneda de cada resultado, los recientes (los mismos de la paleta ⌘K) y
// ligas a la ficha. Teclado: Flecha abajo baja a los resultados, flechas los recorren, Inicio y Fin
// saltan, Esc regresa al campo, y Enter en el campo abre la emisora que mejor coincide.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCapabilities } from '../../../lib/api/capabilities.js'
import { searchQuery } from '../../../lib/api/queries.js'
import { Button, Card, EmptyState, Input, PageHeader } from '../../../components/ui/index.js'
import { PATHS, pathInstrument } from '../../../app/paths.js'
import { pushRecent, readRecents, RECENT_KEY } from '../../../app/shell/palette-model.js'
import { QueryBlock } from '../components/QueryBlock.jsx'
import { ResultList } from '../components/ResultList.jsx'
import { SEARCH_DEBOUNCE_MS, SEARCH_EXAMPLES, SEARCH_LIMIT, SEARCH_MAX_LENGTH, pickSymbol, statusText } from '../search-model.js'
import '../research.css'
import '../search.css'

const OTHER_WAYS = [
  { to: PATHS.compare, label: 'Comparar emisoras', text: 'De 2 a 5 emisoras lado a lado.' },
  { to: PATHS.screener, label: 'Screener de factores', text: 'Un universo ordenado por valor, calidad, momentum, volatilidad y crecimiento.' },
  { to: PATHS.screenerMagic, label: 'Fórmula mágica', text: 'El ranking de Greenblatt con EBIT reportado.' },
  { to: PATHS.screenerFibras, label: 'FIBRAs', text: 'Distribución, NAV y deuda de los fideicomisos inmobiliarios.' },
]

/** @param {string} value @param {number} ms */
function useDebounced(value, ms) {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

function Recents({ recents, onClear, onOpen }) {
  return (
    <Card
      title="Recientes"
      description="Las últimas fichas que abriste aquí o desde la búsqueda rápida. Se guardan solo en este navegador."
      actions={recents.length ? <Button variant="ghost" size="sm" onClick={onClear}>Borrar recientes</Button> : null}
    >
      {recents.length ? (
        <ResultList label="Emisoras recientes" results={recents} onOpen={onOpen} compact />
      ) : (
        <EmptyState size="sm" title="Todavía no hay recientes" text="Las fichas que abras van a aparecer aquí." />
      )}
    </Card>
  )
}

export default function Search() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { status } = useCapabilities()
  const [params, setParams] = useSearchParams()
  const urlQ = params.get('q') ?? ''
  const [text, setText] = useState(urlQ)
  const [recents, setRecents] = useState(readRecents)
  const [notice, setNotice] = useState('')
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const listRef = useRef(/** @type {HTMLUListElement | null} */ (null))

  const q = text.trim()
  const debounced = useDebounced(q, SEARCH_DEBOUNCE_MS)
  const canSearch = status === 'ready'
  const search = useQuery({ ...searchQuery(debounced, SEARCH_LIMIT), enabled: canSearch && debounced.length > 0, placeholderData: (prev) => prev })
  // Mientras llega la búsqueda nueva, placeholderData deja la lista anterior en pantalla; sirve
  // para no parpadear, pero no cuenta como resultado de lo que está escrito.
  const stale = search.isPlaceholderData
  const results = debounced && search.data ? search.data.results : []

  // La URL lleva lo buscado (?q=) para que Atrás y una liga compartida regresen a lo mismo. Si la
  // URL cambia desde afuera (otra liga a /investigar), el campo la sigue.
  const [lastUrlQ, setLastUrlQ] = useState(urlQ)
  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ)
    if (urlQ !== debounced) setText(urlQ)
  }
  useEffect(() => {
    if (debounced === urlQ) return
    setParams(debounced ? { q: debounced } : {}, { replace: true })
  }, [debounced, urlQ, setParams])

  const searching = canSearch && q.length > 0 && (q !== debounced || search.isFetching)
  const live = statusText({ q, searching, count: search.isSuccess && !stale && q === debounced ? results.length : null, failed: search.isError && q === debounced })

  /** @param {{ symbol: string, name?: string | null }} entry */
  function open(entry) {
    setRecents(pushRecent({ symbol: entry.symbol, name: entry.name ?? undefined }))
  }

  async function submit(event) {
    event.preventDefault()
    if (!q) return
    let list = q === debounced && !stale ? results : []
    if (canSearch && (q !== debounced || stale)) {
      try {
        list = (await queryClient.fetchQuery(searchQuery(q, SEARCH_LIMIT)))?.results ?? []
      } catch {
        list = []
      }
    }
    const symbol = pickSymbol(q, list)
    if (!symbol) {
      setNotice(`No encontramos “${q}”. Prueba con la clave, por ejemplo WALMEX o AAPL.`)
      return
    }
    setNotice('')
    const found = list.find((r) => r.symbol === symbol)
    open({ symbol, name: found?.name })
    navigate(pathInstrument(symbol))
  }

  /** @param {import('react').KeyboardEvent<HTMLInputElement>} event */
  function onInputKey(event) {
    if (event.key === 'ArrowDown') {
      const first = listRef.current?.querySelector('a')
      if (first) {
        event.preventDefault()
        first.focus()
      }
    } else if (event.key === 'Escape' && text) {
      event.preventDefault()
      setText('')
      setNotice('')
    }
  }

  function clearRecents() {
    try {
      globalThis.localStorage?.removeItem(RECENT_KEY)
    } catch {
      /* sin almacenamiento: no había nada guardado */
    }
    setRecents([])
  }

  function fillExample(example) {
    setText(example)
    setNotice('')
    inputRef.current?.focus()
  }

  const offline = status === 'legacy' || status === 'down'
  const waking = !canSearch && !offline
  const hint = offline
    ? 'La búsqueda por nombre no está disponible con este servidor. Escribe la clave exacta y presiona Enter.'
    : 'Por ejemplo walmart, FEMSA o AAPL. Flecha abajo recorre los resultados; Enter abre el que mejor coincide.'

  return (
    <div className="kz-container kz-col kz-research-page" data-gap="6">
      <PageHeader
        title="Buscar emisora"
        eyebrow="Investigar"
        description="Encuentra una emisora de la BMV, del SIC o de las bolsas de Estados Unidos por su nombre o su clave, y abre su ficha con precio, fundamentales y valuación."
      />
      <div className="kz-split">
        <div className="kz-col" data-gap="4">
          <Card title="Buscar">
            <form role="search" aria-label="Buscar emisora" onSubmit={submit} className="kz-search-form">
              <Input
                ref={inputRef}
                label="Nombre o clave de la emisora"
                hint={hint}
                type="search"
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setNotice('')
                }}
                onKeyDown={onInputKey}
                maxLength={SEARCH_MAX_LENGTH}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
                error={notice || undefined}
              />
              <Button type="submit">Abrir ficha</Button>
            </form>
            <p className="sr-only" role="status" aria-live="polite">{live}</p>
          </Card>
          {q ? (
            <Card title="Resultados" status={search.data?.meta}>
              {offline ? (
                <EmptyState size="sm" title="Sin búsqueda por nombre" text="Presiona Enter para abrir la ficha con la clave tal como la escribiste." />
              ) : waking ? (
                <EmptyState size="sm" title="Conectando con el servidor…" text="La búsqueda empieza en cuanto conteste. Si ya sabes la clave, presiona Enter para abrir su ficha." />
              ) : (
                <QueryBlock
                  query={{ ...search, isPending: searching && !search.data }}
                  isEmpty={results.length === 0}
                  emptyTitle={`Sin resultados para “${q}”`}
                  emptyText="Prueba con la clave (WALMEX, AAPL) o con otro nombre. Si conoces la clave exacta, presiona Enter para abrir su ficha."
                  lines={5}
                >
                  <ResultList ref={listRef} label={`Resultados para “${debounced}”`} results={results} onOpen={open} inputRef={inputRef} />
                </QueryBlock>
              )}
            </Card>
          ) : (
            <Card title="Ejemplos de búsqueda" description="Toca uno para llenar el campo. Son ejemplos de escritura, no sugerencias de inversión.">
              <ul className="kz-search-examples" aria-label="Ejemplos de búsqueda">
                {SEARCH_EXAMPLES.map((example) => (
                  <li key={example}>
                    <Button variant="secondary" size="sm" onClick={() => fillExample(example)}>{example}</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="kz-col" data-gap="4">
          <Recents recents={recents} onClear={clearRecents} onOpen={open} />
          <Card title="Otras formas de investigar">
            <ul className="kz-search-ways">
              {OTHER_WAYS.map((way) => (
                <li key={way.to}>
                  <Link to={way.to}>{way.label}</Link>
                  <span className="kz-research-muted">{way.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
