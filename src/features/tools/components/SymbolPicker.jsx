// Elegir emisoras: del portafolio activo, por búsqueda en /v2/search o escribiendo la clave.
// La búsqueda es el SearchCombobox compartido (el de la paleta ⌘K): flechas y Enter eligen una
// opción. Sin opciones (búsqueda caída o servidor viejo) o mientras la búsqueda no alcanza al texto,
// Enter agrega la clave escrita, igual que el botón "Agregar". Las elegidas quedan como lista con botón
// para quitar cada una; nada vive solo en un hover.
import { useState } from 'react'
import { CircleAlert, Plus, X } from 'lucide-react'
import { Button, IconButton, SearchCombobox } from '../../../components/ui/index.js'
import { addSymbol } from '../selection.js'

const SEARCH_LIMIT = 6
const HINT = 'Busca por nombre o escribe la clave, por ejemplo WALMEX.MX o AAPL.'

/**
 * @param {{ id: string, selected: string[], onChange: (next: string[]) => void, max: number,
 *   portfolioSymbols?: string[] | null, portfolioLabel?: string, children?: import('react').ReactNode }} props
 */
export function SymbolPicker({ id, selected, onChange, max, portfolioSymbols = null, portfolioLabel = 'Usar las de mi portafolio', children }) {
  const [q, setQ] = useState('')
  const [error, setError] = useState(/** @type {string | null} */ (null))

  // Si no se puede agregar (repetida, inválida o sin lugar), el texto se queda para corregirlo.
  const add = (/** @type {string} */ symbol) => {
    const out = addSymbol(selected, symbol, max)
    setError(out.error)
    if (!out.error) {
      onChange(out.list)
      setQ('')
    }
  }

  return (
    <div className="kz-picker">
      <form
        className="kz-picker__form"
        onSubmit={(e) => {
          e.preventDefault()
          add(q)
        }}
      >
        <SearchCombobox
          id={`${id}-search`}
          label="Agregar emisora"
          // El error va dentro de la ayuda, que el campo ya anuncia con aria-describedby.
          hint={
            <>
              {HINT}
              {error && (
                <span className="kz-error-text kz-picker__error" role="alert">
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
          onSelect={(option) => add(option.symbol ?? option.label)}
          // En los 200 ms del debounce las opciones todavía son del texto anterior: Enter agrega lo
          // escrito, no la primera de esa búsqueda vieja.
          onEnter={({ q: typed, searching }) => {
            if (!searching) return false
            add(typed)
            return true
          }}
          exclude={selected}
          limit={SEARCH_LIMIT}
          clearOnSelect={false}
          className="kz-picker__search"
        />
        <Button type="submit" variant="secondary" icon={<Plus size={16} />} disabled={!q.trim()}>
          Agregar
        </Button>
      </form>
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
