import { API_BASE } from '../api/config.js'
import { ApiError } from '../api/http.js'
import { installFetch, json, networkError } from '../../test/fetchMock.js'
import {
  SESSION_KEY,
  clearSession,
  consumeEndReason,
  getSession,
  getToken,
  isAuthenticated,
  login,
  logout,
  normalizeSession,
  resetSessionForTests,
  subscribeSession,
} from './session.js'

const future = '2099-01-01T00:00:00.000Z'
const okBody = { token: 'jwt.abc', expiresAt: future, user: { username: 'ana', displayName: 'Ana López' } }

beforeEach(() => {
  resetSessionForTests()
})

describe('login', () => {
  it('200: guarda la sesión en sessionStorage y en memoria, y avisa', async () => {
    const f = installFetch([json(200, okBody)])
    const seen = []
    subscribeSession(() => seen.push(getSession()?.user.username ?? null))
    const session = await login('ana', 's3creta')
    expect(session).toEqual(okBody)
    expect(f.calls[0]).toMatchObject({ url: `${API_BASE}/auth/login`, method: 'POST' })
    expect(JSON.parse(f.calls[0].body)).toEqual({ username: 'ana', password: 's3creta' })
    expect(f.calls[0].headers['content-type']).toBe('application/json')
    expect(f.calls[0].headers.authorization).toBeUndefined()
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY))).toEqual(okBody)
    expect(isAuthenticated()).toBe(true)
    expect(getToken()).toBe('jwt.abc')
    expect(seen).toEqual(['ana'])
  })

  it('401: lanza ApiError UNAUTHORIZED con el mensaje del API y no guarda nada', async () => {
    installFetch([json(401, { error: { code: 'UNAUTHORIZED', message: 'Usuario o contraseña incorrectos.' } })])
    const err = await login('ana', 'mal').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, code: 'UNAUTHORIZED', message: 'Usuario o contraseña incorrectos.' })
    expect(isAuthenticated()).toBe(false)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('429: trae retryAfter desde el header', async () => {
    installFetch([json(429, { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos.' } }, { 'retry-after': '120' })])
    const err = await login('ana', 'x').catch((e) => e)
    expect(err).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfter: 120 })
  })

  it('429 sin header legible (CORS): usa details.retryAfter del sobre', async () => {
    installFetch([json(429, { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos.', details: { retryAfter: 59.2 } } })])
    const err = await login('ana', 'x').catch((e) => e)
    expect(err.retryAfter).toBe(60)
  })

  it('429 sin sobre ni header: mensaje genérico en español', async () => {
    installFetch([json(429, {})])
    const err = await login('ana', 'x').catch((e) => e)
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.retryAfter).toBeNull()
    expect(err.message).toMatch(/Espera un momento/)
  })

  it('sin red: ApiError status 0 NETWORK_ERROR', async () => {
    installFetch([networkError()])
    const err = await login('ana', 'x').catch((e) => e)
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
    expect(err.message).toMatch(/No pudimos conectar/)
  })

  it('respuesta 200 con forma inesperada o ya vencida: INVALID_RESPONSE', async () => {
    installFetch([json(200, { ok: true }), json(200, { ...okBody, expiresAt: '2000-01-01T00:00:00Z' })])
    await expect(login('ana', 'x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await expect(login('ana', 'x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(isAuthenticated()).toBe(false)
  })
})

describe('sesión guardada y vencimiento', () => {
  it('lee la sesión de sessionStorage al arrancar', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(okBody))
    expect(getSession()).toEqual(okBody)
  })

  it('una sesión vencida guardada se descarta y se borra', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...okBody, expiresAt: '2020-01-01T00:00:00Z' }))
    expect(getSession()).toBeNull()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('vence mientras la página está abierta: getSession la cierra con motivo "expired"', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-22T12:00:00Z') })
    installFetch([json(200, { ...okBody, expiresAt: '2026-09-22T13:00:00Z' })])
    await login('ana', 'x')
    expect(isAuthenticated()).toBe(true)
    vi.setSystemTime(new Date('2026-09-22T13:00:01Z'))
    expect(getSession()).toBeNull()
    expect(consumeEndReason()).toBe('expired')
    expect(consumeEndReason()).toBeNull()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('datos basura en sessionStorage no rompen nada', () => {
    sessionStorage.setItem(SESSION_KEY, '{nope')
    expect(getSession()).toBeNull()
  })

  it('logout y clearSession con motivo', () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(okBody))
    expect(isAuthenticated()).toBe(true)
    logout()
    expect(isAuthenticated()).toBe(false)
    expect(consumeEndReason()).toBe('logout')
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(okBody))
    resetSessionForTests()
    clearSession('unauthorized')
    expect(consumeEndReason()).toBe('unauthorized')
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
})

describe('sesión de desarrollo (VITE_SKIP_LOGIN)', () => {
  it('en dev con VITE_SKIP_LOGIN=true hay una sesión sintética de 12 h sin token', () => {
    vi.stubEnv('VITE_SKIP_LOGIN', 'true')
    const s = getSession()
    expect(s).toMatchObject({ token: null, user: { username: 'dev', displayName: 'Dev' }, dev: true })
    const hours = (Date.parse(s.expiresAt) - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(11.9)
    expect(hours).toBeLessThanOrEqual(12)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('sin la variable no hay sesión', () => {
    vi.stubEnv('VITE_SKIP_LOGIN', 'false')
    expect(getSession()).toBeNull()
  })
})

describe('normalizeSession', () => {
  it.each([
    [null],
    [{}],
    [{ token: '', expiresAt: future, user: { username: 'a' } }],
    [{ token: 't', expiresAt: 'ayer', user: { username: 'a' } }],
    [{ token: 't', expiresAt: future, user: {} }],
    [{ token: 5, expiresAt: future, user: { username: 'a' } }],
  ])('rechaza %o', (raw) => {
    expect(normalizeSession(raw)).toBeNull()
  })

  it('usa el username si no hay displayName', () => {
    expect(normalizeSession({ token: 't', expiresAt: future, user: { username: 'ana' } }).user.displayName).toBe('ana')
  })
})
