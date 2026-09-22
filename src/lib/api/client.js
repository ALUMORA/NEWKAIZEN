// Cliente del API v2. Todas las llamadas de la app pasan por apiFetch:
//
//   const data = await apiFetch('/v2/quotes', { query: { symbols: ['AAPL', 'WALMEX.MX'] }, signal })
//
// - Devuelve el JSON ya parseado o lanza ApiError { status, code, message, details, retryAfter }.
//   `message` siempre está en español y se puede mostrar tal cual.
// - Manda Authorization: Bearer <token> si hay sesión (auth=true) y el servidor no dijo
//   authRequired=false en /health.
// - 401 en una llamada autenticada: cierra la sesión y emite window "kaizen:unauthorized";
//   RequireAuth lo escucha y manda a /login?next=...
// - Arranque en frío (Render dormido): un GET que falla por red, timeout o 502/503/504 sin el
//   sobre de error del contrato se reintenta con esperas de 2, 5, 10, 20 y 30 s (~70 s) mientras
//   capabilities esté en "probing" o "waking". Si el servidor ya estaba "ready", se vuelve a
//   sondear /health (eso muestra el aviso de "Despertando") y se reintenta igual. Nunca se
//   reintenta un 4xx, ni un POST, ni con el servidor marcado "down".
import { API_BASE, UNAUTHORIZED_EVENT, buildUrl } from './config.js'
import { ApiError, isAbortError, isColdStartError, request, sleep } from './http.js'
import { getCapabilities, startCapabilitiesProbe } from './capabilities.js'
import { clearSession, getToken } from '../auth/session.js'

export { API_BASE, UNAUTHORIZED_EVENT } from './config.js'
export { ApiError, isAbortError } from './http.js'

/** Esperas entre reintentos de un GET por arranque en frío. Suman 67 s. */
export const COLD_START_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000]

/**
 * @typedef {{
 *   method?: string,
 *   body?: unknown,
 *   query?: Record<string, unknown>,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 *   auth?: boolean,
 *   retryColdStart?: boolean,
 *   headers?: Record<string, string>,
 *   delays?: number[],
 * }} ApiFetchOptions
 */

function authHeaders(auth) {
  if (!auth) return {}
  const token = getToken()
  if (!token) return {}
  if (getCapabilities().authRequired === false) return {}
  return { Authorization: `Bearer ${token}` }
}

function notifyUnauthorized(path) {
  clearSession('unauthorized')
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { path } }))
  }
}

/**
 * @param {string} path ruta del API ("/v2/quotes") o URL absoluta
 * @param {ApiFetchOptions} [options]
 * @returns {Promise<any>}
 */
export async function apiFetch(path, options = {}) {
  const {
    method = 'GET',
    body,
    query,
    signal,
    timeoutMs = 20_000,
    auth = true,
    retryColdStart = true,
    headers = {},
    delays = COLD_START_DELAYS_MS,
  } = options
  const url = buildUrl(path, query, API_BASE)
  const upper = method.toUpperCase()
  const canRetry = retryColdStart && upper === 'GET'

  for (let attempt = 0; ; attempt += 1) {
    try {
      const data = await request(url, {
        method: upper,
        body,
        signal,
        timeoutMs,
        headers: { ...headers, ...authHeaders(auth) },
      })
      // Si el sondeo había dado al servidor por caído y esto sí contestó, se vuelve a sondear
      // para quitar el aviso.
      if (getCapabilities().status === 'down') startCapabilitiesProbe({ force: true })
      return data
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err
      if (err instanceof ApiError && err.status === 401 && auth) {
        notifyUnauthorized(path)
        throw err
      }
      const delay = delays[attempt]
      if (!canRetry || !isColdStartError(err) || delay === undefined) throw err
      const { status } = getCapabilities()
      if (status === 'down') throw err
      if (status === 'ready' || status === 'legacy') {
        // El servidor estaba despierto y dejó de contestar: probablemente se durmió. El sondeo
        // pasa el estado a "waking" y la UI avisa mientras se reintenta.
        startCapabilitiesProbe({ force: true })
      }
      await sleep(delay, signal)
    }
  }
}
