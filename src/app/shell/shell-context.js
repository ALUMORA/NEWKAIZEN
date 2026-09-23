// Contexto del marco de la app. Lo lee el legado (src/legacy/App.legacy.jsx) para saber que va
// incrustado dentro del shell nuevo y esconder su propia barra lateral y encabezado.
import { createContext, useContext } from 'react'

/** @type {import('react').Context<{ embedded: boolean }>} */
export const ShellContext = createContext({ embedded: false })

export function useShell() {
  return useContext(ShellContext)
}
