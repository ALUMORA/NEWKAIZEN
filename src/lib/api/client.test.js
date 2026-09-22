// @vitest-environment jsdom
// jsdom para tener window y CustomEvent (el 401 emite "kaizen:unauthorized").
import { installFetch, json, networkError, text, hang } from '../../test/fetchMock.js'
import { SESSION_KEY, consumeEndReason, isAuthenticated, resetSessionForTests } from '../auth/session.js'
import { getCapabilities, resetCapabilitiesForTests } from './capabilities.js'
import { API_BASE, ApiError, COLD_START_DELAYS_MS, UNAUTHORIZED_EVENT, apiFetch } from './client.js'

const session = { token: 'jwt.xyz', expiresAt: '2099-01-01T00:00:00.000Z', user: { username: 'ana', displayName: 'Ana' } }
const health = json(200, { status: 'ok', apiVersion: 2, authRequired: true, capabilities: [] })

beforeEach(() => {
  resetSessionForTests()
  resetCapabilitiesForTests({ status: 'ready', apiVersion: 2, authRequired: true, checkedAt: '2026-09-22T00:00:00Z' })
})

describe('apiFetch: respuestas y ApiError', () => {
  it('devuelve el JSON y arma la URL con query (sin vacíos, arreglos con coma)', async () => {
    const f = installFetch([json(200, { quotes: [] })])
    const out = await apiFetch('/v2/quotes', { query: { symbols: ['AAPL', 'WALMEX.MX'], empty: '', none: null } })
    expect(out).toEqual({ quotes: [] })
    expect(f.calls[0].url).toBe(`${API_BASE}/v2/quotes?symbols=AAPL%2CWALMEX.MX`)
    expect(f.calls[0].headers.accept).toBe('application/json')
  })

  it('usa el sobre de error del contrato', async () => {
    installFetch([json(404, { error: { code: 'NOT_FOUND', message: 'No existe esa emisora.', details: { symbol: 'ZZZ' } } })])
    const err = await apiFetch('/v2/instrument/ZZZ').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'No existe esa emisora.', details: { symbol: 'ZZZ' }, fromApi: true })
  })

  it('sin sobre: código por status, mensaje genérico en español y el texto crudo solo en details', async () => {
    installFetch([text(500, '<html>Traceback (most recent call last)</html>')])
    const err = await apiFetch('/v2/x', { retryColdStart: false }).catch((e) => e)
    expect(err).toMatchObject({ status: 500, code: 'INTERNAL', fromApi: false })
    expect(err.message).toBe('El servidor tuvo un problema. Intenta de nuevo en unos minutos.')
    expect(err.message).not.toMatch(/Traceback/)
    expect(err.details.raw).toMatch(/Traceback/)
  })

  it('422 sin cuerpo', async () => {
    installFetch([() => new Response(null, { status: 422 })])
    await expect(apiFetch('/v2/x')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Revisa los datos enviados.' })
  })

  it('204 devuelve null', async () => {
    installFetch([() => new Response(null, { status: 204 })])
    await expect(apiFetch('/v2/x')).resolves.toBeNull()
  })

  it('timeout: ApiError TIMEOUT', async () => {
    installFetch([hang()])
    const err = await apiFetch('/v2/x', { timeoutMs: 20, retryColdStart: false }).catch((e) => e)
    expect(err).toMatchObject({ status: 0, code: 'TIMEOUT' })
  })

  it('cancelar con signal relanza el AbortError tal cual', async () => {
    installFetch([hang()])
    const ctrl = new AbortController()
    const p = apiFetch('/v2/x', { signal: ctrl.signal })
    ctrl.abort()
    const err = await p.catch((e) => e)
    expect(err).not.toBeInstanceOf(ApiError)
    expect(err.name).toBe('AbortError')
  })
})

describe('apiFetch: sesión', () => {
  it('manda Bearer con sesión; no con auth=false ni con authRequired=false', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    const f = installFetch([json(200, {}), json(200, {}), json(200, {})])
    await apiFetch('/v2/a')
    await apiFetch('/v2/b', { auth: false })
    resetCapabilitiesForTests({ status: 'ready', authRequired: false, checkedAt: 'x' })
    await apiFetch('/v2/c')
    expect(f.calls.map((c) => c.headers.authorization ?? null)).toEqual(['Bearer jwt.xyz', null, null])
  })

  it('401 en llamada autenticada: cierra la sesión y emite kaizen:unauthorized', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    installFetch([json(401, { error: { code: 'UNAUTHORIZED', message: 'Tu sesión venció.' } })])
    const events = []
    const onEvent = (e) => events.push(e.detail)
    window.addEventListener(UNAUTHORIZED_EVENT, onEvent)
    const err = await apiFetch('/v2/quotes').catch((e) => e)
    window.removeEventListener(UNAUTHORIZED_EVENT, onEvent)
    expect(err).toMatchObject({ status: 401, message: 'Tu sesión venció.' })
    expect(isAuthenticated()).toBe(false)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
    expect(consumeEndReason()).toBe('unauthorized')
    expect(events).toEqual([{ path: '/v2/quotes' }])
  })

  it('401 con auth=false no toca la sesión', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    installFetch([json(401, {})])
    await apiFetch('/auth/login', { method: 'POST', body: {}, auth: false }).catch(() => {})
    expect(isAuthenticated()).toBe(true)
  })
})

describe('apiFetch: arranque en frío', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('las esperas suman ~67 s', () => {
    expect(COLD_START_DELAYS_MS).toEqual([2000, 5000, 10000, 20000, 30000])
  })

  it('GET con 503 del proxy (sin sobre) mientras despierta: reintenta y resuelve', async () => {
    resetCapabilitiesForTests({ status: 'waking' })
    const f = installFetch([text(503, 'Service Unavailable'), networkError(), json(200, { ok: 1 })])
    const p = apiFetch('/v2/quotes')
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(5000)
    await expect(p).resolves.toEqual({ ok: 1 })
    expect(f.calls).toHaveLength(3)
  })

  it('servidor listo que deja de contestar: vuelve a sondear /health y reintenta', async () => {
    const f = installFetch((url) => (url.endsWith('/health') ? health() : f.calls.filter((c) => !c.url.endsWith('/health')).length === 1 ? text(502, 'Bad Gateway')() : json(200, { ok: 2 })()))
    const p = apiFetch('/v2/fx')
    await vi.advanceTimersByTimeAsync(2000)
    await expect(p).resolves.toEqual({ ok: 2 })
    expect(f.calls.some((c) => c.url === `${API_BASE}/health`)).toBe(true)
    expect(getCapabilities().status).toBe('ready')
  })

  it('agota los reintentos y lanza el último error', async () => {
    resetCapabilitiesForTests({ status: 'waking' })
    const f = installFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const p = apiFetch('/v2/quotes').catch((e) => e)
    await vi.advanceTimersByTimeAsync(70_000)
    const err = await p
    expect(err).toMatchObject({ code: 'NETWORK_ERROR' })
    expect(f.calls).toHaveLength(6)
  })

  it.each([
    ['POST', text(503, 'x'), { method: 'POST', body: {} }],
    ['GET 4xx', json(404, {}), {}],
    ['GET 429', json(429, {}), {}],
    ['GET 503 con sobre del API (proveedor caído, servidor despierto)', json(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Banxico no respondió.' } }), {}],
    ['GET con retryColdStart=false', networkError(), { retryColdStart: false }],
  ])('no reintenta: %s', async (_name, response, options) => {
    resetCapabilitiesForTests({ status: 'waking' })
    const f = installFetch([response, json(200, {})])
    await expect(apiFetch('/v2/x', options)).rejects.toBeInstanceOf(ApiError)
    expect(f.calls).toHaveLength(1)
  })

  it('no reintenta con el servidor marcado "down"', async () => {
    resetCapabilitiesForTests({ status: 'down', checkedAt: 'x' })
    const f = installFetch([networkError(), json(200, {})])
    await expect(apiFetch('/v2/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(f.calls).toHaveLength(1)
  })

  it('cancelar durante la espera corta el reintento', async () => {
    resetCapabilitiesForTests({ status: 'waking' })
    const f = installFetch([networkError(), json(200, {})])
    const ctrl = new AbortController()
    const p = apiFetch('/v2/x', { signal: ctrl.signal }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(500)
    ctrl.abort()
    const err = await p
    expect(err.name).toBe('AbortError')
    expect(f.calls).toHaveLength(1)
  })
})
