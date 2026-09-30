// Contexto del marco de la app: `embedded` es true dentro de AppShell. Hoy nadie lo lee (lo leía el
// legado, retirado en M3). Se conserva para cuando Aprender y los legales se monten dentro del shell
// con sesión: PublicPage lo leería para no pintar su propio encabezado ni un segundo <main>.
import { createContext, useContext } from 'react'

/** @type {import('react').Context<{ embedded: boolean }>} */
export const ShellContext = createContext({ embedded: false })

export function useShell() {
  return useContext(ShellContext)
}
