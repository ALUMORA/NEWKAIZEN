// Ayudas para specs de la app nueva (build de e2e, API en http://api.test).
//
//   const api = await setupApp(page, { baseURL, health: 'v2', session: true, routes })
//   await page.goto('/mercados')
//
// - health: 'v2' | 'legacy' | 'down' | objeto propio | null (sin mock de /health). Lo pide la
//   app al arrancar (capabilities). 'legacy' simula el backend viejo de Render, que solo contesta
//   {status: 'ok'}: la app avisa que el servidor no es compatible.
// - routes: tabla de mockApi para las rutas v2 que pide la página. Lo que no esté ahí responde 501
//   y las guardas lo marcan.
// - session: true siembra DEFAULT_SESSION; un objeto siembra esa sesión.
// - fixClock: fija el reloj en E2E_NOW (por omisión).
import { E2E_NOW, fixTime } from './clock.js'
import { API_BASE, blockExternalRequests, mockApi } from './mockApi.js'
import { DEFAULT_SESSION, seedSession } from './auth.js'


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

/**
 * Capacidades de la fase 5 por stream (schemas.KNOWN_CAPABILITIES). NO van en HEALTH_V2: cada spec
 * anuncia solo las suyas con healthWith(...) o con `capabilities` en setupApp, y declara sus
 * handlers en `routes`. Así una spec vieja nunca pide por accidente una ruta que no mockeó.
 */
export const V5_CAPABILITIES = Object.freeze({
  V5TS: ['curves', 'moneyMarket', 'expectations'],
  V5FX: ['fxdesk', 'fxdesk.crosses', 'fxdesk.fix', 'fxdesk.forward'],
  V5EC: ['calendar.economic', 'macro.indicators', 'macro.world'],
  V5FI: ['earnings', 'holders', 'shares', 'filings'],
  V5TC: ['ohlc', 'ohlc.intraday'],
  V5MK: ['movers', 'breadth', 'sectors'],
  V5PF: ['events.season', 'events.dividends', 'funds'],
  V5EM: ['reference.mx', 'business.industries', 'creditHealth'],
})

/**
 * /health del API v2 con capacidades extra, sin repetir las que ya trae la base.
 *   const HEALTH = healthWith(['markets.overview', ...V5_CAPABILITIES.V5TS])
 * @param {string[]} extra
 * @param {{ capabilities: string[] }} [base] HEALTH_V2 por omisión
 */
export function healthWith(extra, base = HEALTH_V2) {
  return { ...base, capabilities: [...new Set([...base.capabilities, ...extra])] }
}

/**
 * `meta` del contrato v2 para las respuestas mockeadas (docs/api-v2.md): sin respaldo, sin notas y
 * con la fecha del reloj de e2e, salvo lo que se cambie.
 * @param {Record<string, unknown>} [overrides]
 */
export function v2Meta(overrides = {}) {
  return { asOf: '2026-09-22T14:51:31Z', source: 'e2e', stale: false, fallback: false, notes: [], ...overrides }
}

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
 *   healthDelayMs?: number, session?: boolean | object, fixClock?: boolean,
 *   routes?: Record<string, any>, capabilities?: string[] }} options
 *   capabilities: extra sobre HEALTH_V2 cuando health es 'v2' (p. ej. V5_CAPABILITIES.V5MK).
 */
export async function setupApp(page, { baseURL, health = 'v2', healthDelayMs = 0, session = false, fixClock = true, routes = {}, capabilities = [] }) {
  await blockExternalRequests(page, [baseURL, API_BASE])
  const table = { ...routes }
  if (health === 'v2') table['GET /health'] = { json: capabilities.length ? healthWith(capabilities) : HEALTH_V2, delayMs: healthDelayMs }
  else if (health === 'legacy') table['GET /health'] = { json: HEALTH_LEGACY, delayMs: healthDelayMs }
  else if (health === 'down') table['GET /health'] = { status: 503, body: 'Service Unavailable', contentType: 'text/html', delayMs: healthDelayMs }
  else if (health && typeof health === 'object') table['GET /health'] = { json: health, delayMs: healthDelayMs }
  const api = await mockApi(page, table)
  const seeded = session === true ? DEFAULT_SESSION : session || null
  if (seeded) await seedSession(page, seeded)
  if (fixClock) await fixTime(page, E2E_NOW)
  return api
}
