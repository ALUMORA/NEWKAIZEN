// ¿El servidor ya anuncia esta función en /health? Las secciones solo piden un endpoint cuando el
// API v2 está listo y lo anuncia, igual que la tira de mercado del shell: con el servidor viejo,
// dormido o sin esa capacidad no se manda nada y la sección lo dice.
//
//   const feature = useFeature(['curves'])
//   const q = useQuery({ ...curvesQuery({ country: 'mx' }), enabled: feature.enabled })
//
// Vive en lib/api desde la fase 5 para que todas las features lo usen; la ruta vieja
// (src/features/markets/overview/useFeature.js) lo reexporta.
import { useCapabilities } from './capabilities.js'

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
