// Configuración del API compartida por client.js, capabilities.js y legacy.js. Vive aparte para
// que esos módulos no se importen en círculo.
//
// VITE_API_URL fija el backend en cualquier modo (dev, build de e2e y producción). Sin ella, en
// `npm run dev` se usa el backend local y en producción el de Render. Para desarrollo conviene
// ponerla en .env.development.local: Vite también lee .env.local al hacer `vite build`, y un
// dist/ armado en local terminaría apuntando producción a localhost.

const RENDER_URL = 'https://app-4-everyone.onrender.com'
const LOCAL_URL = 'http://localhost:8002'

/** Quita las diagonales finales para poder concatenar rutas que empiezan con "/". */
function trimSlash(url) {
  return String(url).replace(/\/+$/, '')
}

/** URL base del API, sin diagonal final. */
export const API_BASE = trimSlash(
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? LOCAL_URL : RENDER_URL),
)

/** Los adaptadores v1 → v2 solo existen si se piden de forma explícita. */
export const ALLOW_LEGACY = import.meta.env.VITE_ALLOW_LEGACY === 'true'

/** Evento de window que se emite cuando el API responde 401 a una llamada autenticada. */
export const UNAUTHORIZED_EVENT = 'kaizen:unauthorized'

/** Patrón de símbolos que acepta el API (mismo que el backend). */
export const SYMBOL_RE = /^[A-Za-z0-9.\-^=$]{1,20}$/

/**
 * @param {string} path ruta que empieza con "/" o URL absoluta
 * @param {Record<string, unknown>} [query] parámetros; null, undefined y "" se omiten, los
 *   arreglos se unen con comas
 * @param {string} [base]
 * @returns {string}
 */
export function buildUrl(path, query, base = API_BASE) {
  const url = /^https?:\/\//i.test(path) ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(query)) {
    if (raw === undefined || raw === null || raw === '') continue
    const value = Array.isArray(raw) ? raw.join(',') : String(raw)
    if (value === '') continue
    params.append(key, value)
  }
  const qs = params.toString()
  if (!qs) return url
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`
}
