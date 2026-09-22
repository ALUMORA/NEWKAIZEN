// Ayudas para specs de la app nueva (build de e2e, API en http://api.test).
//
//   const api = await setupApp(page, { baseURL, health: 'v2', legacyApi: true, session: true })
//   await page.goto('/mercados')
//
// - health: 'v2' | 'legacy' | 'down' | objeto propio | null (sin mock de /health). Lo pide la
//   app al arrancar (capabilities) y la app legada al montarse.
// - legacyApi: sirve las rutas v1 (/rf, /market, /stock/...) desde e2e/fixtures/app/legacy-api.har
//   (npm run fixtures:api). Lo que no esté ahí cae en mockApi, que responde 501 y las guardas
//   lo marcan.
// - session: true siembra DEFAULT_SESSION; un objeto siembra esa sesión.
import { fileURLToPath } from 'node:url'
import { fixTime } from './clock.js'
import { API_BASE, blockExternalRequests, mockApi } from './mockApi.js'
import { DEFAULT_SESSION, seedSession } from './auth.js'
import { readLegacyMeta } from './legacy.js'

export const APP_LEGACY_HAR = fileURLToPath(new URL('../fixtures/app/legacy-api.har', import.meta.url))
export const API_URL_RE = /^http:\/\/api\.test\//

/** /health del API v2 (contrato de docs/api-v2.md). */
export const HEALTH_V2 = Object.freeze({
  status: 'ok',
  apiVersion: 2,
  version: '2.0.0-e2e',
  commit: null,
  authRequired: true,
  capabilities: ['history.dates', 'fx.fix', 'rates.mx', 'rf.series', 'search'],
  providers: { yahoo: { ok: true }, banxico: { configured: true }, fred: { configured: true }, sec: { ok: true }, eodhd: { configured: false } },
  serverTime: '2026-09-22T14:52:19Z',
})

/** /health del backend viejo. */
export const HEALTH_LEGACY = Object.freeze({ status: 'ok' })

/** Respuesta de POST /auth/login. */
export function loginResponse(overrides = {}) {
  return { token: 'jwt.e2e', expiresAt: '2099-01-01T00:00:00.000Z', user: { username: 'ana', displayName: 'Ana López' }, ...overrides }
}

/**
 * Permisos explícitos para errores HTTP que una prueba provoca a propósito: el 4xx/5xx en sí y el
 * "Failed to load resource" que Chromium imprime como console.error.
 * @param {number} status
 * @param {string} method
 * @param {string} path p. ej. "/auth/login"
 * @param {string} reason
 */
export function expectedHttpError(status, method, path, reason) {
  return [
    { kind: /** @type {const} */ ('http'), match: `${status} ${method} ${API_BASE}${path}`, reason },
    { kind: /** @type {const} */ ('console.error'), match: new RegExp(`status of ${status}\\b.*${path.replace(/[/.]/g, '\\$&')}`), reason },
  ]
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ baseURL: string, health?: 'v2' | 'legacy' | 'down' | object | null,
 *   healthDelayMs?: number, legacyApi?: boolean, session?: boolean | object,
 *   fixClock?: boolean, routes?: Record<string, any> }} options
 */
export async function setupApp(page, { baseURL, health = 'v2', healthDelayMs = 0, legacyApi = false, session = false, fixClock = true, routes = {} }) {
  await blockExternalRequests(page, [baseURL, API_BASE])
  const table = { ...routes }
  if (health === 'v2') table['GET /health'] = { json: HEALTH_V2, delayMs: healthDelayMs }
  else if (health === 'legacy') table['GET /health'] = { json: HEALTH_LEGACY, delayMs: healthDelayMs }
  else if (health === 'down') table['GET /health'] = { status: 503, body: 'Service Unavailable', contentType: 'text/html', delayMs: healthDelayMs }
  else if (health && typeof health === 'object') table['GET /health'] = { json: health, delayMs: healthDelayMs }
  const api = await mockApi(page, table)
  if (legacyApi) {
    // Registrado después de mockApi: Playwright evalúa primero la última ruta, así que el HAR
    // atiende lo suyo y lo demás (fallback) cae en mockApi.
    await page.routeFromHAR(APP_LEGACY_HAR, { url: API_URL_RE, notFound: 'fallback', update: false })
  }
  if (session) await seedSession(page, session === true ? DEFAULT_SESSION : session)
  if (fixClock) await fixTime(page, readLegacyMeta().recordedAt.desktop)
  return api
}
