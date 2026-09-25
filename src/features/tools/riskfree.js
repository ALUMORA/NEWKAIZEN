// La serie de /v2/rates/rf tal como llega: CETES del SIE, o, sin token de Banxico, la tasa
// interbancaria a 3 meses de la OCDE en FRED con `fallback` en true y `tenorDays` en 91. El plazo
// que se usa para convertir es SIEMPRE el de la respuesta (kaizen_api/domain/rates.py lo pide así),
// y el nombre en pantalla dice cuál de las dos es.

/** @param {{ tenorDays?: number | null } | null | undefined} rf */
export function rfTenorDays(rf) {
  const t = Number(rf?.tenorDays)
  return Number.isFinite(t) && t > 0 ? t : 28
}

/** @param {{ fallback?: boolean, meta?: { fallback?: boolean } } | null | undefined} rf */
export function rfIsFallback(rf) {
  return Boolean(rf?.fallback || rf?.meta?.fallback)
}

/**
 * Nombre corto de la tasa para la pantalla.
 * @param {{ fallback: boolean, tenorDays: number } | null | undefined} info
 */
export function rfLabel(info) {
  if (!info) return 'CETES 28'
  if (info.fallback) return 'tasa interbancaria a 3 meses de la OCDE (respaldo, no son CETES)'
  return `CETES ${info.tenorDays}`
}
