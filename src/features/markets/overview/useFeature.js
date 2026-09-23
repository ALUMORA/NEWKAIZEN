// ¿El servidor ya anuncia esta función en /health? Las secciones del panorama solo piden un
// endpoint cuando el API v2 está listo y lo anuncia, igual que la tira de mercado del shell: con el
// servidor viejo, dormido o sin esa capacidad no se manda nada y la sección lo dice.
import { useCapabilities } from '../../../lib/api/capabilities.js'

/**
 * @param {string[]} names basta con que el servidor anuncie una
 * @returns {{ enabled: boolean, waiting: boolean, reason: string }}
 */
export function useFeature(names) {
  const { status, capabilities } = useCapabilities()
  const waiting = status === 'probing' || status === 'waking'
  const enabled = status === 'ready' && names.some((n) => capabilities?.has(n))
  let reason = ''
  if (!enabled && !waiting) {
    reason =
      status === 'down'
        ? 'No pudimos hablar con el servidor. Vuelve a intentar en unos minutos.'
        : 'El servidor todavía no ofrece este dato. Cuando lo tenga, aparecerá aquí.'
  }
  return { enabled, waiting, reason }
}
