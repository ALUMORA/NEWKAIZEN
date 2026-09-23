// La app monta QueryClientProvider en AppRoot. Si el shell se renderiza sin él (pruebas de rutas
// con createMemoryRouter), pone uno propio con los defaults de la app en vez de romper la página.
import { QueryClientContext, QueryClientProvider } from '@tanstack/react-query'
import { useContext, useState } from 'react'
import { createQueryClient } from '../../lib/api/queries.js'

/** @param {{ children: import('react').ReactNode }} props */
export default function QueryFallback({ children }) {
  const client = useContext(QueryClientContext)
  const [fallback] = useState(() => (client ? null : createQueryClient()))
  if (client || !fallback) return children
  return <QueryClientProvider client={fallback}>{children}</QueryClientProvider>
}
