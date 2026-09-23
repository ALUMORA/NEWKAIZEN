// Marco de las rutas privadas (C3): liga de salto, barra lateral, barra superior, contenido,
// pie y, en móvil, barra inferior. router.jsx lo renderiza alrededor de todas las rutas privadas
// (PrivateLayout) y la página va en su <Outlet />.
//
// Landmarks: header (barra superior), nav "Principal" (barra lateral), main#contenido, footer.
// El legado (LegacyPage) se entera por ShellContext de que va incrustado y esconde su propio
// cromo.
import { useCallback, useRef, useState } from 'react'
import { Outlet } from 'react-router'
import BottomNav from './BottomNav.jsx'
import CommandPalette from './CommandPalette.jsx'
import Footer from './Footer.jsx'
import QueryFallback from './QueryFallback.jsx'
import Sidebar from './Sidebar.jsx'
import TopBar from './TopBar.jsx'
import { ShellContext } from './shell-context.js'
import { useCollapsed } from './useCollapsed.js'
import { useRouteFocus } from './useRouteFocus.js'
import { usePaletteShortcuts } from './useShortcuts.js'
import './shell.css'
import './topbar.css'
import './bottomnav.css'
import './palette.css'

const EMBEDDED = Object.freeze({ embedded: true })

export default function AppShell() {
  return (
    <QueryFallback>
      <Shell />
    </QueryFallback>
  )
}

function Shell() {
  const [collapsed, toggleCollapsed] = useCollapsed()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  usePaletteShortcuts(openPalette)
  const mainRef = useRef(/** @type {HTMLElement | null} */ (null))
  useRouteFocus(mainRef)
  return (
    <ShellContext.Provider value={EMBEDDED}>
      <div className="kz-shell" data-collapsed={collapsed || undefined}>
        <a className="kz-skip" href="#contenido">
          Saltar al contenido
        </a>
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
        <div className="kz-shell__frame">
          <TopBar onOpenPalette={openPalette} />
          <main className="kz-shell__main" id="contenido" ref={mainRef} tabIndex={-1}>
            <Outlet />
          </main>
          <Footer />
        </div>
        <BottomNav />
        <CommandPalette onClose={closePalette} open={paletteOpen} />
      </div>
    </ShellContext.Provider>
  )
}
