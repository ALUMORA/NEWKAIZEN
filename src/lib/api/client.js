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
// - authorizedFetch(input, init): fetch() con la misma política de sesión (Bearer y 401) que
//   devuelve la Response cruda. Es para la app legada, que lee las respuestas a su manera. Solo
//   toca URLs del API; /health nunca lleva token (es pública y la app legada la usa para detectar
//   el backend); con token y /health todavía sin contestar, espera al sondeo para no mandarle el
//   header a un backend viejo.
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

/** URL, como texto, de lo que recibe fetch(): string, URL o Request. */
function inputUrl(input) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input && typeof input.url === 'string' ? input.url : String(input)
}

/**
 * ¿La URL es del API? Compara contra la base completa más "/" o "?", para que un host como
 * "https://api.example.com.otro.net" no pase por "https://api.example.com".
 * @param {string} url
 * @param {string} [base]
 */
export function isApiUrl(url, base = API_BASE) {
  return url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`)
}

/**
 * Rutas del API que nunca llevan token. /health es pública en el API v2, y el backend viejo
 * contesta el preflight con "Access-Control-Allow-Headers: *", que según la especificación de
 * fetch no cubre Authorization: si /health llevara el header, la app legada no detectaría ese
 * backend.
 */
const PUBLIC_API_PATHS = new Set(['/health'])

/** "/stock/AAPL" para `${API_BASE}/stock/AAPL?x=1`. La URL ya pasó por isApiUrl. */
function apiPath(url) {
  return url.slice(API_BASE.length).split(/[?#]/)[0] || '/'
}

/**
 * Con token en mano, antes de mandarlo hay que saber si el servidor usa sesiones: mientras el
 * primer sondeo de /health no conteste (authRequired null, sin checkedAt) se espera a que
 * termine. Así un backend viejo nunca recibe Authorization. Respeta la cancelación del request.
 * @param {AbortSignal | undefined} signal
 */
async function waitForAuthPolicy(signal) {
  const caps = getCapabilities()
  if (caps.authRequired !== null || caps.checkedAt) return
  const probe = startCapabilitiesProbe()
  if (!signal) {
    await probe
    return
  }
  if (signal.aborted) throw signal.reason
  await new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    probe.then(resolve, resolve).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * fetch() con la política de sesión de apiFetch, para código que necesita la Response cruda (la
 * app legada de src/legacy). Solo actúa sobre URLs del API (API_BASE):
 * - agrega Authorization: Bearer <token> si hay token y el servidor no dijo authRequired=false
 *   (un header Authorization que ya venga no se toca). Si /health todavía no contesta, primero
 *   espera al sondeo. /health nunca lleva token.
 * - un 401 cierra la sesión y emite "kaizen:unauthorized" como en apiFetch; RequireAuth manda a
 *   /login?next=<ruta>.
 * No lanza por status ni reintenta: devuelve la Response tal cual. Cualquier otra URL pasa
 * directo a fetch, sin token y sin tocar la sesión.
 * @param {RequestInfo | URL} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function authorizedFetch(input, init) {
  const url = inputUrl(input)
  if (!isApiUrl(url)) return fetch(input, init)
  const path = apiPath(url)
  if (PUBLIC_API_PATHS.has(path)) return fetch(input, init)
  const fromRequest = typeof Request !== 'undefined' && input instanceof Request ? input : null
  let options = init
  if (getToken()) {
    await waitForAuthPolicy(init?.signal ?? fromRequest?.signal ?? undefined)
    const { Authorization } = authHeaders(true)
    if (Authorization) {
      const headers = new Headers(init?.headers ?? fromRequest?.headers)
      if (!headers.has('Authorization')) headers.set('Authorization', Authorization)
      options = { ...init, headers }
    }
  }
  const res = await fetch(input, options)
  if (res.status === 401) notifyUnauthorized(path)
  return res
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
