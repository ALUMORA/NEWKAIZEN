// Marco de las rutas privadas (C3): liga de salto, barra lateral, barra superior, contenido,
// pie y, en móvil, barra inferior. router.jsx lo renderiza alrededor de todas las rutas privadas
// (PrivateLayout) y la página va en su <Outlet />.
//
// Landmarks: header (barra superior), nav "Principal" (barra lateral), main#contenido, footer.
// El legado (LegacyPage) se entera por ShellContext de que va incrustado y esconde su propio
// cromo.
import { useCallback, useState } from 'react'
import { Outlet } from 'react-router'
import Sidebar from './Sidebar.jsx'
import TopBar from './TopBar.jsx'
import { ShellContext } from './shell-context.js'
import { useCollapsed } from './useCollapsed.js'
import './shell.css'
import './topbar.css'

const EMBEDDED = Object.freeze({ embedded: true })

export default function AppShell() {
  const [collapsed, toggleCollapsed] = useCollapsed()
  const [, setPaletteOpen] = useState(false)
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  return (
    <ShellContext.Provider value={EMBEDDED}>
      <div className="kz-shell" data-collapsed={collapsed || undefined}>
        <a className="kz-skip" href="#contenido">
          Saltar al contenido
        </a>
        <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
        <div className="kz-shell__frame">
          <TopBar onOpenPalette={openPalette} />
          <main className="kz-shell__main" id="contenido" tabIndex={-1}>
            <Outlet />
          </main>
          <footer className="kz-foot" />
        </div>
      </div>
    </ShellContext.Provider>
  )
}
