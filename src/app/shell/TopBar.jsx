// Barra superior. Escritorio: botón de búsqueda (abre la paleta), tira de mercado, estado del
// servidor, tema y menú de usuario. Móvil (< 768 px): logo, estado, lupa y menú de usuario; la
// tira baja a una segunda fila que se desplaza dentro de sí misma.
import { Search } from 'lucide-react'
import { Link } from 'react-router'
import { IconButton, Mark, ThemeToggle } from '../../components/ui/index.js'
import { PATHS } from '../paths.js'
import MarketStrip from './MarketStrip.jsx'
import ServerStatus from './ServerStatus.jsx'
import UserMenu from './UserMenu.jsx'

/** Atajo que se muestra: ⌘K en Mac, Ctrl+K en lo demás. */
function shortcutLabel() {
  const platform = globalThis.navigator?.platform ?? ''
  return /Mac|iPhone|iPad/.test(platform) ? '⌘K' : 'Ctrl+K'
}

/** @param {{ onOpenPalette: () => void }} props */
export default function TopBar({ onOpenPalette }) {
  const shortcut = shortcutLabel()
  return (
    <header className="kz-top">
      <div className="kz-top__row">
        <Link aria-label="Kaizen, ir a Mercados" className="kz-top__logo" to={PATHS.markets}>
          <Mark size={28} />
        </Link>
        <button aria-keyshortcuts="Meta+K Control+K /" aria-haspopup="dialog" className="kz-top__search" onClick={onOpenPalette} type="button">
          <Search aria-hidden="true" size={16} />
          <span className="kz-top__search-text">Buscar emisora o función…</span>
          <kbd aria-hidden="true" className="kz-top__kbd">
            {shortcut}
          </kbd>
        </button>
        <div className="kz-top__strip">
          <MarketStrip />
        </div>
        <div className="kz-top__actions">
          <ServerStatus />
          <IconButton aria-haspopup="dialog" className="kz-top__search-icon" label="Buscar emisora o función" onClick={onOpenPalette}>
            <Search size={20} />
          </IconButton>
          <ThemeToggle className="kz-top__theme" />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
