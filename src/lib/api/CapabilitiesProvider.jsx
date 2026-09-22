// Arranca el sondeo de /health al montar la app. No bloquea el render: los hijos se pintan de
// inmediato y cada pantalla lee el estado con useCapabilities().
import { useEffect } from 'react'
import { startCapabilitiesProbe } from './capabilities.js'

export function CapabilitiesProvider({ children }) {
  useEffect(() => {
    startCapabilitiesProbe()
  }, [])
  return children
}
