// fetch falso para pruebas unitarias del cliente del API. Cada llamada toma la siguiente
// respuesta de la cola (o la función `route`), y se registra en `calls`.
//
//   const f = installFetch([json(200, { ok: true }), networkError()])
//   ...
//   expect(f.calls[0].url).toBe('http://localhost:8002/health')
import { vi } from 'vitest'

/** Respuesta JSON. */
export function json(status, body, headers = {}) {
  return () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** Respuesta de texto (p. ej. la página HTML del proxy de Render). */
export function text(status, body, headers = {}) {
  return () => new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } })
}

/** Falla de red como la de fetch real (TypeError). */
export function networkError(message = 'Failed to fetch') {
  return () => {
    throw new TypeError(message)
  }
}

/** Respuesta que nunca llega salvo que el request se cancele. */
export function hang() {
  return (_url, init) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    })
}

/**
 * @param {Array<(url: string, init: RequestInit) => any> | ((url: string, init: RequestInit) => any)} plan
 *   cola de respuestas o una función que decide por URL
 */
export function installFetch(plan) {
  const queue = Array.isArray(plan) ? [...plan] : null
  const calls = []
  const fn = vi.fn(async (url, init = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers ?? {}).entries())
    calls.push({ url: String(url), method: init.method ?? 'GET', headers, body: init.body ?? null })
    const next = queue ? queue.shift() : plan
    if (!next) throw new Error(`fetch sin respuesta preparada: ${init.method ?? 'GET'} ${url}`)
    return next(String(url), init)
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}
