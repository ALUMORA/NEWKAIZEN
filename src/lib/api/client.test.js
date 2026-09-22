// @vitest-environment jsdom
// jsdom para tener window y CustomEvent (el 401 emite "kaizen:unauthorized").
import { installFetch, json, networkError, text, hang } from '../../test/fetchMock.js'
import { SESSION_KEY, consumeEndReason, isAuthenticated, resetSessionForTests } from '../auth/session.js'
import { getCapabilities, resetCapabilitiesForTests } from './capabilities.js'
import { API_BASE, ApiError, COLD_START_DELAYS_MS, UNAUTHORIZED_EVENT, apiFetch, authorizedFetch, isApiUrl } from './client.js'

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

describe('authorizedFetch (app legada)', () => {
  /** @param {() => Promise<unknown>} fn */
  async function collectEvents(fn) {
    const events = []
    const onEvent = (e) => events.push(e.detail)
    window.addEventListener(UNAUTHORIZED_EVENT, onEvent)
    try {
      await fn()
    } finally {
      window.removeEventListener(UNAUTHORIZED_EVENT, onEvent)
    }
    return events
  }

  it('isApiUrl: la base, sus rutas y su query; no un host que solo empieza igual', () => {
    expect(isApiUrl(API_BASE)).toBe(true)
    expect(isApiUrl(`${API_BASE}/stock/AAPL`)).toBe(true)
    expect(isApiUrl(`${API_BASE}?x=1`)).toBe(true)
    expect(isApiUrl(`${API_BASE}.otro.net/stock/AAPL`)).toBe(false)
    expect(isApiUrl(`${API_BASE}evil/stock`)).toBe(false)
    expect(isApiUrl('https://news.example.com/articulo')).toBe(false)
  })

  it('con sesión manda Bearer a las rutas v1 y conserva el resto de init (signal, method)', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    const f = installFetch([json(200, { rate: 0.09 })])
    const ctrl = new AbortController()
    const res = await authorizedFetch(`${API_BASE}/rf`, { signal: ctrl.signal })
    expect(res).toBeInstanceOf(Response)
    expect(await res.json()).toEqual({ rate: 0.09 })
    expect(f.calls[0]).toMatchObject({ url: `${API_BASE}/rf`, method: 'GET' })
    expect(f.calls[0].headers.authorization).toBe('Bearer jwt.xyz')
    expect(f.fn.mock.calls[0][1].signal).toBe(ctrl.signal)
  })

  it('acepta URL y Request, y no pisa un Authorization que ya venga', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    const f = installFetch([json(200, {}), json(200, {}), json(200, {})])
    await authorizedFetch(new URL(`${API_BASE}/market`))
    await authorizedFetch(new Request(`${API_BASE}/worldmap`, { headers: { 'x-extra': '1' } }))
    await authorizedFetch(`${API_BASE}/fx`, { headers: { Authorization: 'Bearer otro' } })
    expect(f.calls.map((c) => c.headers.authorization)).toEqual(['Bearer jwt.xyz', 'Bearer jwt.xyz', 'Bearer otro'])
    expect(f.calls[1].headers['x-extra']).toBe('1')
  })

  it('sin token, con authRequired=false o con el API viejo no manda Authorization', async () => {
    const f = installFetch([json(200, {}), json(200, {}), json(200, {})])
    await authorizedFetch(`${API_BASE}/macro`)
    // La sesión ya se leyó (vacía) y quedó en memoria: se olvida para que lea la nueva.
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    resetSessionForTests()
    resetCapabilitiesForTests({ status: 'ready', apiVersion: 2, authRequired: false, checkedAt: 'x' })
    await authorizedFetch(`${API_BASE}/macro`)
    resetCapabilitiesForTests({ status: 'legacy', apiVersion: 1, authRequired: false, checkedAt: 'x' })
    await authorizedFetch(`${API_BASE}/macro`)
    expect(f.calls.map((c) => c.headers.authorization ?? null)).toEqual([null, null, null])
  })

  it('/health nunca lleva token (es pública y el backend viejo no acepta el header en el preflight)', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    const f = installFetch([json(200, { status: 'ok' }), json(401, {})])
    const events = await collectEvents(async () => {
      await authorizedFetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(60_000) })
      // Un 401 de /health no dice nada de la sesión: no la cierra.
      expect((await authorizedFetch(`${API_BASE}/health?x=1`)).status).toBe(401)
    })
    expect(f.calls.map((c) => c.headers.authorization ?? null)).toEqual([null, null])
    expect(events).toEqual([])
    expect(isAuthenticated()).toBe(true)
  })

  describe('con token y /health todavía sin contestar', () => {
    beforeEach(() => {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
      resetCapabilitiesForTests({ status: 'probing' })
    })

    it('espera al sondeo: si el backend es el viejo, no manda Authorization', async () => {
      const f = installFetch([json(200, { status: 'ok' }), json(200, { rate: 0.09 })])
      await authorizedFetch(`${API_BASE}/rf`)
      expect(f.calls.map((c) => [c.url, c.headers.authorization ?? null])).toEqual([
        [`${API_BASE}/health`, null],
        [`${API_BASE}/rf`, null],
      ])
      expect(getCapabilities().status).toBe('legacy')
    })

    it('espera al sondeo: si es el API v2 con sesiones, sí manda el token', async () => {
      const f = installFetch([health, json(200, {})])
      await authorizedFetch(`${API_BASE}/stock/AAPL`)
      expect(f.calls.map((c) => [c.url, c.headers.authorization ?? null])).toEqual([
        [`${API_BASE}/health`, null],
        [`${API_BASE}/stock/AAPL`, 'Bearer jwt.xyz'],
      ])
    })

    it('si el sondeo da al servidor por caído, manda el token (no se sabe si lo pide)', async () => {
      const f = installFetch([json(404, {}), json(200, {})])
      await authorizedFetch(`${API_BASE}/market`)
      expect(getCapabilities().status).toBe('down')
      expect(f.calls[1].headers.authorization).toBe('Bearer jwt.xyz')
    })

    it('cancelar mientras espera rechaza con el motivo del signal y no hace el request', async () => {
      let release = () => {}
      const gate = new Promise((resolve) => {
        release = resolve
      })
      const f = installFetch([
        async () => {
          await gate
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
        },
      ])
      const ctrl = new AbortController()
      const pending = authorizedFetch(`${API_BASE}/fx`, { signal: ctrl.signal })
      ctrl.abort(new DOMException('ya no hace falta', 'AbortError'))
      await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'ya no hace falta' })
      release()
      await Promise.resolve()
      expect(f.calls.map((c) => c.url)).toEqual([`${API_BASE}/health`])
    })

    it('sin token no espera nada: el request sale de inmediato y sin header', async () => {
      sessionStorage.removeItem(SESSION_KEY)
      resetSessionForTests()
      const f = installFetch([json(200, {})])
      await authorizedFetch(`${API_BASE}/macro`)
      expect(f.calls.map((c) => [c.url, c.headers.authorization ?? null])).toEqual([[`${API_BASE}/macro`, null]])
    })
  })

  it('URL fuera del API: pasa directo, sin token, y su 401 no toca la sesión', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    const f = installFetch([json(401, {}), json(200, {})])
    const events = await collectEvents(async () => {
      const res = await authorizedFetch('https://otro.example.com/datos')
      expect(res.status).toBe(401)
      await authorizedFetch(`${API_BASE}.otro.net/stock/AAPL`)
    })
    expect(f.calls.map((c) => c.headers.authorization ?? null)).toEqual([null, null])
    expect(events).toEqual([])
    expect(isAuthenticated()).toBe(true)
  })

  it('401 del API: devuelve la Response, cierra la sesión y emite kaizen:unauthorized con la ruta', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    installFetch([json(401, { error: { code: 'UNAUTHORIZED', message: 'Inicia sesión.' } })])
    let res
    const events = await collectEvents(async () => {
      res = await authorizedFetch(`${API_BASE}/chart/AAPL?period=1y&ccy=MXN`)
    })
    expect(res.status).toBe(401)
    expect(events).toEqual([{ path: '/chart/AAPL' }])
    expect(isAuthenticated()).toBe(false)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
    expect(consumeEndReason()).toBe('unauthorized')
  })

  it('otros errores (500, red) no tocan la sesión: el legado los maneja como antes', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    installFetch([json(500, {}), networkError()])
    const res = await authorizedFetch(`${API_BASE}/stock/MSFT`)
    expect(res.status).toBe(500)
    await expect(authorizedFetch(`${API_BASE}/stock/MSFT`)).rejects.toThrow(TypeError)
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
