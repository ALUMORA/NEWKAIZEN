// Raíz de todas las rutas: título del documento según handle.title, aviso del servidor,
// Suspense para las páginas diferidas y scroll arriba al navegar.
import { Suspense, useEffect } from 'react'
import { Outlet, ScrollRestoration, useMatches } from 'react-router'
import CapabilitiesBanner from './CapabilitiesBanner.jsx'

export const APP_TITLE = 'Kaizen · Mercados, portafolio e investigación'

function RouteLoading() {
  return (
    <div className="kz-route-loading" role="status">
      Cargando…
    </div>
  )
}

function useDocumentTitle() {
  const matches = useMatches()
  const title = [...matches].reverse().find((m) => /** @type {any} */ (m.handle)?.title)?.handle
  const text = /** @type {{ title?: string } | undefined} */ (title)?.title
  useEffect(() => {
    document.title = text ? `${text} · Kaizen` : APP_TITLE
  }, [text])
}

export default function RootLayout() {
  useDocumentTitle()
  return (
    <>
      <CapabilitiesBanner />
      <Suspense fallback={<RouteLoading />}>
        <Outlet />
      </Suspense>
      <ScrollRestoration />
    </>
  )
}
