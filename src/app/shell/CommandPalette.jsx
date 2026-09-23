// Paleta de comandos (⌘K, Ctrl+K o "/"). Es el SearchCombobox de C1 en modo `inline`: el foco se
// queda en el campo y la opción activa se anuncia con aria-activedescendant. Flechas mueven,
// Enter abre, Esc cierra (lo maneja el Dialog de C1, que también atrapa el foco y lo regresa).
//
// Grupos: Emisoras (/v2/search con 200 ms de espera, más las recientes), Ir a (todas las rutas de
// nav.js) y Acciones (tema, cerrar sesión). Un ticker tecleado + Enter abre su ficha aunque la
// búsqueda no haya contestado: "WALMEX" abre /investigar/WALMEX.MX.
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Clock, LogOut, SunMoon } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Dialog, SearchCombobox } from '../../components/ui/index.js'
import { useCapabilities } from '../../lib/api/capabilities.js'
import { searchQuery } from '../../lib/api/queries.js'
import { useTheme } from '../../theme.js'
import { flatNav } from '../nav.js'
import { pathInstrument } from '../paths.js'
import { buildGroups, fold, isTickerLike, matchSymbol, pushRecent, readRecents } from './palette-model.js'
import { useLogout } from './useLogout.js'

const SEARCH_LIMIT = 8
const ROUTES = flatNav()

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
  const [recents] = useState(readRecents)
  const canSearch = status === 'ready'

  /**
   * @param {import('./palette-model.js').PaletteOption} option
   * @param {{ results: { symbol: string, name?: string }[] }} context
   */
  function choose(option, { results }) {
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

  /** Enter sin opción activa y con un ticker: se busca en ese momento y se abre su ficha. @param {string} text */
  async function openTicker(text) {
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

  return (
    <Dialog className="kz-palette" closeLabel="Cerrar búsqueda" initialFocusRef={inputRef} onClose={onClose} open title="Buscar emisora o función">
      <SearchCombobox
        className="kz-palette__combobox"
        getGroups={({ q, results }) => buildGroups({ q, results, recents, routes: ROUTES, dark: theme.dark })}
        hideLabel
        inline
        inputRef={inputRef}
        label="Buscar emisora o función"
        limit={SEARCH_LIMIT}
        onEnter={({ q: text, activeOption, searching }) => {
          const option = /** @type {import('./palette-model.js').PaletteOption | null} */ (activeOption)
          // Una ruta o acción cuyo nombre empieza con lo tecleado gana ("fibras" abre FIBRAs). Si no,
          // un ticker cuya búsqueda todavía no llega gana sobre lo que coincidió de rebote.
          const named = option && option.kind !== 'symbol' && fold(option.label).startsWith(fold(text))
          const direct = text && !named && isTickerLike(text) && option?.kind !== 'symbol' && (searching || !option)
          if (!direct) return false
          void openTicker(text)
          return true
        }}
        onSelect={(option, context) => choose(/** @type {import('./palette-model.js').PaletteOption} */ (option), context)}
        placeholder="WALMEX, Apple, CETES, riesgo…"
        renderOption={(option) => (
          <>
            <OptionIcon option={/** @type {import('./palette-model.js').PaletteOption} */ (option)} />
            <span className="kz-combobox__label">{option.label}</span>
            {option.detail && <span className="kz-combobox__detail">{option.detail}</span>}
          </>
        )}
      />
      <p aria-hidden="true" className="kz-palette__hint">
        <kbd>↑</kbd> <kbd>↓</kbd> para moverte, <kbd>Enter</kbd> para abrir, <kbd>Esc</kbd> para cerrar
      </p>
    </Dialog>
  )
}
