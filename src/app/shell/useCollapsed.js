// Estado plegado de la barra lateral, recordado en este navegador. localStorage puede no existir
// o fallar (ventana privada, datos bloqueados): entonces solo vive en memoria.
import { useCallback, useState } from 'react'

const KEY = 'kaizen.sidebar'

function read() {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'collapsed'
  } catch {
    return false
  }
}

export function useCollapsed() {
  const [collapsed, setCollapsed] = useState(read)
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        globalThis.localStorage?.setItem(KEY, next ? 'collapsed' : 'expanded')
      } catch {
        /* sin almacenamiento: solo en memoria */
      }
      return next
    })
  }, [])
  return [collapsed, toggle]
}
