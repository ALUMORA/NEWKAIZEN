// Paleta de comandos (⌘K, Ctrl+K o "/"). Combobox con lista (patrón de ARIA 1.2): el foco se
// queda en el campo y la opción activa se anuncia con aria-activedescendant. Flechas mueven,
// Enter abre, Esc cierra (lo maneja el Dialog de C1, que también atrapa el foco y lo regresa).
//
// Grupos: Emisoras (/v2/search con 200 ms de espera, más las recientes), Ir a (todas las rutas de
// nav.js) y Acciones (tema, cerrar sesión). Un ticker tecleado + Enter abre su ficha aunque la
// búsqueda no haya contestado: "WALMEX" abre /investigar/WALMEX.MX.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Clock, LogOut, SunMoon } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Dialog } from '../../components/ui/index.js'
import { useCapabilities } from '../../lib/api/capabilities.js'
import { searchQuery } from '../../lib/api/queries.js'
import { useTheme } from '../../theme.js'
import { flatNav } from '../nav.js'
import { pathInstrument } from '../paths.js'
import { buildGroups, fold, isTickerLike, matchSymbol, pushRecent, readRecents } from './palette-model.js'
import { useLogout } from './useLogout.js'

const SEARCH_LIMIT = 8
const ROUTES = flatNav()

/** @param {string} value @param {number} ms */
function useDebounced(value, ms) {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

/** @param {{ option: import('./palette-model.js').PaletteOption }} props */
function OptionIcon({ option }) {
  if (option.kind === 'route') return <ArrowRight aria-hidden="true" size={16} />
  if (option.action === 'theme') return <SunMoon aria-hidden="true" size={16} />
  if (option.action === 'logout') return <LogOut aria-hidden="true" size={16} />
  return option.detail?.endsWith('Reciente') ? <Clock aria-hidden="true" size={16} /> : <span aria-hidden="true" className="kz-palette__ticker-dot" />
}

/** @param {{ open: boolean, onClose: () => void }} props */
export default function CommandPalette({ open, onClose }) {
  return open ? <PaletteBody onClose={onClose} /> : null
}

/** @param {{ onClose: () => void }} props */
function PaletteBody({ onClose }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const theme = useTheme()
  const onLogout = useLogout()
  const { status } = useCapabilities()
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const listId = `kz-palette-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [q, setQ] = useState('')
  const [recents] = useState(readRecents)
  const [active, setActive] = useState(0)
  const [lastQ, setLastQ] = useState(q)
  if (lastQ !== q) {
    // La opción activa regresa a la primera cada vez que cambia el texto.
    setLastQ(q)
    setActive(0)
  }
  const debounced = useDebounced(q.trim(), 200)
  const canSearch = status === 'ready'
  const search = useQuery({ ...searchQuery(debounced, SEARCH_LIMIT), enabled: canSearch && debounced.length > 0 })
  const results = useMemo(() => (debounced && search.data ? search.data.results : []), [debounced, search.data])

  const groups = useMemo(() => buildGroups({ q, results, recents, routes: ROUTES, dark: theme.dark }), [q, results, recents, theme.dark])
  const flat = useMemo(() => groups.flatMap((g) => g.options), [groups])
  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : -1
  const activeOption = activeIndex >= 0 ? flat[activeIndex] : null
  const optionId = (/** @type {string} */ id) => `${listId}-${id}`
  const searching = canSearch && q.trim().length > 0 && (q.trim() !== debounced || search.isFetching)

  useEffect(() => {
    if (!activeOption) return
    document.getElementById(optionId(activeOption.id))?.scrollIntoView({ block: 'nearest' })
    // optionId solo depende de listId, que no cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOption])

  /** @param {import('./palette-model.js').PaletteOption} option */
  function choose(option) {
    onClose()
    if (option.kind === 'action') {
      if (option.action === 'theme') theme.toggle()
      if (option.action === 'logout') onLogout()
      return
    }
    if (option.kind === 'symbol' && option.symbol) {
      const found = results.find((r) => r.symbol === option.symbol) ?? recents.find((r) => r.symbol === option.symbol)
      pushRecent({ symbol: option.symbol, name: found?.name })
    }
    if (option.to) navigate(option.to)
  }

  /** Enter sin opción activa y con un ticker: se busca en ese momento y se abre su ficha. */
  async function openTicker() {
    const text = q.trim()
    let symbol = text.toUpperCase()
    let name
    if (canSearch) {
      try {
        const data = await queryClient.fetchQuery(searchQuery(text, SEARCH_LIMIT))
        const hit = matchSymbol(text, data?.results)
        if (hit) {
          symbol = hit
          name = data.results.find((r) => r.symbol === hit)?.name
        }
      } catch {
        /* sin búsqueda: se abre tal cual lo tecleado */
      }
    }
    pushRecent({ symbol, name })
    onClose()
    navigate(pathInstrument(symbol))
  }

  /** @param {import('react').KeyboardEvent<HTMLInputElement>} event */
  function onKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!flat.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((activeIndex + step + flat.length) % flat.length)
    } else if (event.key === 'Home' && flat.length && event.ctrlKey) {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End' && flat.length && event.ctrlKey) {
      event.preventDefault()
      setActive(flat.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const text = q.trim()
      // Una ruta o acción cuyo nombre empieza con lo tecleado gana ("fibras" abre FIBRAs). Si no,
      // un ticker cuya búsqueda todavía no llega gana sobre lo que coincidió de rebote.
      const named = activeOption && activeOption.kind !== 'symbol' && fold(activeOption.label).startsWith(fold(text))
      const direct = text && !named && isTickerLike(text) && activeOption?.kind !== 'symbol' && (searching || !activeOption)
      if (direct) void openTicker()
      else if (activeOption) choose(activeOption)
    }
  }

  const total = flat.length
  const statusText = searching ? 'Buscando emisoras…' : total === 0 ? 'Sin resultados' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`

  return (
    <Dialog className="kz-palette" closeLabel="Cerrar búsqueda" initialFocusRef={inputRef} onClose={onClose} open title="Buscar emisora o función">
      <input
        aria-activedescendant={activeOption ? optionId(activeOption.id) : undefined}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded="true"
        aria-label="Buscar emisora o función"
        autoComplete="off"
        className="kz-palette__input"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="WALMEX, Apple, CETES, riesgo…"
        ref={inputRef}
        role="combobox"
        spellCheck={false}
        type="text"
        value={q}
      />
      <p aria-live="polite" className="kz-palette__status" role="status">
        {statusText}
      </p>
      <div aria-label="Resultados" className="kz-palette__list" id={listId} role="listbox">
        {groups.map((group) => (
          <div aria-labelledby={`${listId}-g-${group.id}`} className="kz-palette__group" key={group.id} role="group">
            <p aria-hidden="true" className="kz-palette__group-label kz-eyebrow" id={`${listId}-g-${group.id}`}>
              {group.label}
            </p>
            {group.options.map((option) => {
              const selected = option.id === activeOption?.id
              return (
                // El foco se queda en el campo; el clic elige y el cursor marca la activa.
                <div
                  aria-selected={selected}
                  className="kz-palette__option"
                  id={optionId(option.id)}
                  key={option.id}
                  onClick={() => choose(option)}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => {
                    if (!selected) setActive(flat.indexOf(option))
                  }}
                  role="option"
                >
                  <OptionIcon option={option} />
                  <span className="kz-palette__label">{option.label}</span>
                  {option.detail && <span className="kz-palette__detail">{option.detail}</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <p aria-hidden="true" className="kz-palette__hint">
        <kbd>↑</kbd> <kbd>↓</kbd> para moverte, <kbd>Enter</kbd> para abrir, <kbd>Esc</kbd> para cerrar
      </p>
    </Dialog>
  )
}
