// Lista de emisoras con liga a su ficha: resultados del buscador y recientes. Cada renglón es una
// liga normal (se puede abrir en otra pestaña); las flechas mueven el foco entre ligas, Inicio y
// Fin saltan a los extremos, y Esc o Flecha arriba en la primera regresan al campo de búsqueda.
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '../../../components/ui/index.js'
import { pathInstrument } from '../../../app/paths.js'
import { marketLabel, typeLabel } from '../search-model.js'

/**
 * @param {import('react').KeyboardEvent<HTMLUListElement>} event
 * @param {import('react').RefObject<HTMLInputElement | null> | undefined} inputRef
 */
function moveFocus(event, inputRef) {
  const links = /** @type {HTMLAnchorElement[]} */ ([...event.currentTarget.querySelectorAll('a')])
  const index = links.indexOf(/** @type {HTMLAnchorElement} */ (document.activeElement))
  if (index < 0) return
  let next = -1
  if (event.key === 'ArrowDown') next = Math.min(index + 1, links.length - 1)
  else if (event.key === 'ArrowUp') next = index - 1
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = links.length - 1
  else if (event.key === 'Escape') next = -1
  else return
  event.preventDefault()
  if (next >= 0) links[next].focus()
  else inputRef?.current?.focus()
}

/**
 * @param {{ label: string, results: { symbol: string, name?: string | null, exchange?: string | null,
 *   currency?: string | null, type?: string | null }[], onOpen: (r: { symbol: string, name?: string | null }) => void,
 *   compact?: boolean, inputRef?: import('react').RefObject<HTMLInputElement | null>,
 *   ref?: import('react').Ref<HTMLUListElement> }} props
 */
export function ResultList({ label, results, onOpen, compact = false, inputRef, ref }) {
  return (
    <ul ref={ref} className="kz-search-list" data-compact={compact || undefined} aria-label={label} onKeyDown={(e) => moveFocus(e, inputRef)}>
      {results.map((r) => (
        <li key={r.symbol}>
          <Link className="kz-search-item" to={pathInstrument(r.symbol)} onClick={() => onOpen(r)}>
            <span className="kz-search-item__symbol mono">{r.symbol}</span>
            <span className="kz-search-item__name">{r.name || 's/d'}</span>
            {compact ? null : (
              <span className="kz-search-item__meta">
                <span className="kz-search-item__market">{marketLabel(r)}</span>
                <Badge tone={r.type === 'fibra' || r.type === 'etf' ? 'info' : 'neutral'}>{typeLabel(r.type)}</Badge>
              </span>
            )}
            <ChevronRight className="kz-search-item__go" aria-hidden="true" size={16} />
          </Link>
        </li>
      ))}
    </ul>
  )
}
