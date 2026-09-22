// Raíz de la app: providers y router.
//
//   ErrorBoundary
//   └─ QueryClientProvider (TanStack Query, defaults en src/lib/api/queries.js)
//      └─ SessionProvider (vence la sesión a tiempo)
//         └─ CapabilitiesProvider (sondea /health sin bloquear)
//            └─ UiProvider (C1: tema, avisos, diálogos)
//               └─ RouterProvider
import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { CapabilitiesProvider } from '../lib/api/CapabilitiesProvider.jsx'
import { createQueryClient } from '../lib/api/queries.js'
import { SessionProvider } from '../lib/auth/SessionProvider.jsx'
import { UiProvider } from '../components/ui/UiProvider.jsx'
import { useTheme } from '../theme.js'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import { createAppRouter } from './router.jsx'
import './app.css'

/** Aplica el tema guardado (data-theme en <html>) también fuera de la app legada. */
function ThemeSync() {
  useTheme()
  return null
}

/**
 * @param {{ router?: ReturnType<typeof createAppRouter>, queryClient?: import('@tanstack/react-query').QueryClient }} props
 *   router y queryClient se pueden inyectar en pruebas.
 */
export default function AppRoot({ router: injectedRouter, queryClient: injectedClient }) {
  const [router] = useState(() => injectedRouter ?? createAppRouter())
  const [queryClient] = useState(() => injectedClient ?? createQueryClient())
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <CapabilitiesProvider>
            <UiProvider>
              <ThemeSync />
              <RouterProvider router={router} />
            </UiProvider>
          </CapabilitiesProvider>
        </SessionProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
