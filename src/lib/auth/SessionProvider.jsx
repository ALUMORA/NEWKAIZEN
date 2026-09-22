// Cierra la sesión cuando vence su expiresAt, aunque nadie haga requests. El estado de la sesión
// vive en session.js (store de módulo); este provider solo agenda el vencimiento. Los timers del
// navegador aceptan hasta ~24.8 días, así que se reagenda por tramos.
import { useEffect } from 'react'
import { clearSession, isExpired, useSession } from './session.js'

const MAX_TIMEOUT_MS = 2_147_000_000

export function SessionProvider({ children }) {
  const session = useSession()

  useEffect(() => {
    if (!session) return undefined
    let timer
    const schedule = () => {
      if (isExpired(session)) {
        clearSession('expired')
        return
      }
      const wait = Math.min(Date.parse(session.expiresAt) - Date.now(), MAX_TIMEOUT_MS)
      timer = setTimeout(schedule, Math.max(wait, 0))
    }
    schedule()
    // Una pestaña en segundo plano puede atrasar los timers: se revisa al volver.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isExpired(session)) clearSession('expired')
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session])

  return children
}
