// Elegir emisoras: del portafolio activo, por búsqueda en /v2/search o escribiendo la clave.
// Las elegidas quedan como lista con botón para quitar cada una; nada vive solo en un hover.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { Button, IconButton, Input, SrOnly } from '../../../components/ui/index.js'
import { searchQuery } from '../../../lib/api/queries.js'
import { useCapabilities } from '../../../lib/api/capabilities.js'
import { addSymbol } from '../selection.js'

const SEARCH_LIMIT = 6

/** @param {string} value @param {number} ms */
function useDebounced(value, ms) {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

/**
 * @param {{ id: string, selected: string[], onChange: (next: string[]) => void, max: number,
 *   portfolioSymbols?: string[] | null, portfolioLabel?: string, children?: import('react').ReactNode }} props
 */
export function SymbolPicker({ id, selected, onChange, max, portfolioSymbols = null, portfolioLabel = 'Usar las de mi portafolio', children }) {
  const [q, setQ] = useState('')
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const { status } = useCapabilities()
  const debounced = useDebounced(q.trim(), 200)
  const search = useQuery({ ...searchQuery(debounced, SEARCH_LIMIT), enabled: status === 'ready' && debounced.length > 0 })
  const results = debounced && search.data ? search.data.results.filter((r) => !selected.includes(r.symbol)) : []

  const add = (/** @type {string} */ symbol) => {
    const out = addSymbol(selected, symbol, max)
    setError(out.error)
    if (!out.error) {
      onChange(out.list)
      setQ('')
    }
  }

  const announce = !debounced ? '' : search.isFetching ? 'Buscando' : results.length ? `${results.length} resultados` : 'Sin resultados en la búsqueda'

  return (
    <div className="kz-picker">
      <form
        className="kz-picker__form"
        onSubmit={(e) => {
          e.preventDefault()
          add(q)
        }}
      >
        <Input
          id={`${id}-search`}
          label="Agregar emisora"
          hint="Busca por nombre o escribe la clave, por ejemplo WALMEX.MX o AAPL."
          error={error ?? undefined}
          value={q}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQ(e.target.value)
            setError(null)
          }}
        />
        <Button type="submit" variant="secondary" icon={<Plus size={16} />} disabled={!q.trim()}>
          Agregar
        </Button>
      </form>
      <SrOnly as="p" aria-live="polite">{announce}</SrOnly>
      {results.length > 0 && (
        <ul className="kz-picker__results" aria-label="Resultados de la búsqueda">
          {results.map((r) => (
            <li key={r.symbol}>
              <button type="button" className="kz-picker__result" onClick={() => add(r.symbol)}>
                <span className="mono">{r.symbol}</span>
                <span className="kz-picker__name">{r.name}</span>
                <SrOnly>, agregar</SrOnly>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="kz-picker__selected">
        <p className="kz-picker__count" id={`${id}-count`}>
          {selected.length === 0 ? 'Todavía no eliges emisoras.' : `${selected.length} de ${max} emisoras elegidas`}
        </p>
        {selected.length > 0 && (
          <ul className="kz-picker__chips" aria-labelledby={`${id}-count`}>
            {selected.map((s) => (
              <li key={s} className="kz-picker__chip">
                <span className="mono">{s}</span>
                <IconButton size="sm" label={`Quitar ${s}`} onClick={() => onChange(selected.filter((x) => x !== s))}>
                  <X size={14} aria-hidden="true" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="kz-row" data-gap="3">
        {portfolioSymbols && portfolioSymbols.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange(portfolioSymbols.slice(0, max))}>
            {portfolioLabel}
          </Button>
        )}
        {selected.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Quitar todas
          </Button>
        )}
        {children}
      </div>
    </div>
  )
}
