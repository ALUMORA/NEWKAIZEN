// Mock del API para specs de Playwright, con rutas a mano. El build de e2e apunta VITE_API_URL a
// http://api.test (.env.e2e), un host que no existe: todo request al API tiene que pasar por aquí.
//
//   const api = await mockApi(page, {
//     'GET /health': { json: { status: 'ok' } },
//     'GET /quotes/:symbol': ({ params }) => ({ json: { symbol: params.symbol, price: 1 } }),
//     'POST /auth/login': { status: 401, json: { error: 'credenciales' } },
//   })
//   api.on('GET /news', { json: { news: [] } })   // se pueden agregar después
//   ...
//   api.assertAllMatched()
//
// La llave es "MÉTODO /ruta". La ruta admite :parametros y * (un segmento) y se compara
// contra el pathname sin query; si la llave trae "?", la query tiene que coincidir exacta.
// Un request al API sin ruta que lo atienda NO pasa en silencio: se responde 501 con el
// detalle, lo que dispara las guardas (status >= 400), y assertAllMatched() lo lista.
//
// Con blockExternalRequests(page, origenesPermitidos) cualquier request fuera de esos orígenes
// se aborta y queda registrado en las guardas: ninguna prueba depende de la red real.
import { expect } from '@playwright/test'

export const API_BASE = process.env.E2E_API_URL ?? 'http://api.test'

/**
 * @typedef {{ status?: number, json?: unknown, body?: string | Buffer, contentType?: string,
 *   headers?: Record<string, string>, delayMs?: number }} MockResponse
 * @typedef {{ request: import('@playwright/test').Request, url: URL,
 *   params: Record<string, string>, body: unknown }} MockContext
 * @typedef {MockResponse | ((ctx: MockContext) => MockResponse | Promise<MockResponse>)} MockHandler
 */

function compileKey(key) {
  const m = /^([A-Z]+)\s+(\S+)$/.exec(key.trim())
  if (!m) throw new Error(`mockApi: llave inválida "${key}". Formato: "GET /ruta/:param"`)
  const [, method, target] = m
  const [pathPattern, query] = target.split('?')
  const names = []
  const source = pathPattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        names.push(seg.slice(1))
        return '([^/]+)'
      }
      if (seg === '*') return '[^/]+'
      return seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { key, method, regex: new RegExp(`^${source}/?$`), names, query: query ?? null }
}

function parseBody(request) {
  const raw = request.postData()
  if (raw == null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} page
 * @param {Record<string, MockHandler>} [routes]
 * @param {{ baseUrl?: string }} [options]
 */
export async function mockApi(page, routes = {}, { baseUrl = API_BASE } = {}) {
  const base = new URL(baseUrl)
  // La ruta base del API (p. ej. http://api.test/v2) se quita del pathname antes de comparar.
  const basePath = base.pathname.replace(/\/$/, '')
  /** @type {{ compiled: ReturnType<typeof compileKey>, handler: MockHandler }[]} */
  const table = []
  /** @type {string[]} */
  const calls = []
  /** @type {string[]} */
  const unmatched = []

  const on = (key, handler) => {
    // Las rutas agregadas después ganan sobre las anteriores con la misma forma.
    table.unshift({ compiled: compileKey(key), handler })
  }
  for (const [key, handler] of Object.entries(routes)) on(key, handler)

  await page.route(
    (url) => url.origin === base.origin && (basePath === '' || url.pathname.startsWith(basePath)),
    async (route, request) => {
      const url = new URL(request.url())
      const path = url.pathname.slice(basePath.length) || '/'
      const label = `${request.method()} ${path}${url.search}`
      // CORS: la app corre en 127.0.0.1 y el API en otro origen. Se refleja el Origin para que
      // también funcione con credentials: 'include'.
      const cors = {
        'access-control-allow-origin': request.headers().origin ?? '*',
        'access-control-allow-credentials': 'true',
        vary: 'Origin',
      }
      if (request.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            ...cors,
            'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
            'access-control-max-age': '600',
          },
        })
      }
      calls.push(label)
      for (const { compiled, handler } of table) {
        if (compiled.method !== request.method()) continue
        const m = compiled.regex.exec(path)
        if (!m) continue
        if (compiled.query !== null && url.search.slice(1) !== compiled.query) continue
        const params = Object.fromEntries(compiled.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]))
        const spec = typeof handler === 'function' ? await handler({ request, url, params, body: parseBody(request) }) : handler
        if (spec.delayMs) await new Promise((r) => setTimeout(r, spec.delayMs))
        const headers = { ...cors, ...(spec.headers ?? {}) }
        if (spec.json !== undefined) {
          return route.fulfill({ status: spec.status ?? 200, headers, contentType: 'application/json', body: JSON.stringify(spec.json) })
        }
        return route.fulfill({ status: spec.status ?? 200, headers, contentType: spec.contentType ?? 'text/plain', body: spec.body ?? '' })
      }
      unmatched.push(label)
      return route.fulfill({
        status: 501,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'mockApi: request sin mock', request: label }),
      })
    },
  )

  return {
    calls,
    unmatched,
    on,
    /** Falla si algún request al API no tenía mock. */
    assertAllMatched() {
      expect(unmatched, `Requests al API sin mock:\n  ${unmatched.join('\n  ')}`).toEqual([])
    },
  }
}

/**
 * Aborta cualquier request cuyo origen no esté en `allowedOrigins` (el servidor de la app, el
 * API mockeado...). Registrarlo ANTES de mockApi: en Playwright la última ruta
 * registrada se evalúa primero, así que los mocks siguen ganando para sus URLs.
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} page
 * @param {(string | RegExp)[]} allowedOrigins
 */
export async function blockExternalRequests(page, allowedOrigins) {
  const isAllowed = (url) =>
    url.protocol === 'data:' ||
    url.protocol === 'blob:' ||
    allowedOrigins.some((o) => (typeof o === 'string' ? url.origin === new URL(o).origin : o.test(url.href)))
  await page.route(
    (url) => !isAllowed(url),
    (route) => route.abort('blockedbyclient'),
  )
}
