// La política de reintento de TanStack no debe apilarse encima de la de apiFetch: el cliente ya
// reintenta el arranque en frío cinco veces (~67 s), y si Query volviera a reintentar, quien usa
// la app esperaría el doble antes de ver el error.
import { ApiError } from './http.js'
import { COLD_START_DELAYS_MS } from './client.js'
import { STALE_TIME, createQueryClient, queryKeys, shouldRetry } from './queries.js'

const abort = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })

describe('shouldRetry', () => {
  it('no reintenta el arranque en frío: apiFetch ya gastó ~67 s en eso', () => {
    const total = COLD_START_DELAYS_MS.reduce((a, b) => a + b, 0)
    expect(total).toBe(67_000)
    const coldStart = [
      new ApiError({ status: 0, code: 'NETWORK_ERROR' }),
      new ApiError({ status: 0, code: 'TIMEOUT' }),
      new ApiError({ status: 502 }),
      new ApiError({ status: 503 }),
      new ApiError({ status: 504 }),
    ]
    for (const error of coldStart) expect(shouldRetry(0, error)).toBe(false)
  })

  it('no reintenta ningún error de red (status 0), aunque traiga otro código', () => {
    expect(shouldRetry(0, new ApiError({ status: 0, code: 'RARO' }))).toBe(false)
  })

  it('no reintenta 4xx, servidor viejo ni cancelaciones', () => {
    expect(shouldRetry(0, new ApiError({ status: 401 }))).toBe(false)
    expect(shouldRetry(0, new ApiError({ status: 429, retryAfter: 30 }))).toBe(false)
    expect(shouldRetry(0, new ApiError({ status: 200, code: 'LEGACY_SERVER' }))).toBe(false)
    expect(shouldRetry(0, abort())).toBe(false)
  })

  it('un 5xx del API ya despierto (con sobre del contrato) sí tiene un reintento, solo uno', () => {
    const awake = new ApiError({ status: 503, fromApi: true, code: 'UPSTREAM_UNAVAILABLE' })
    expect(shouldRetry(0, awake)).toBe(true)
    expect(shouldRetry(1, awake)).toBe(false)
    const server = new ApiError({ status: 500 })
    expect(shouldRetry(0, server)).toBe(true)
    expect(shouldRetry(1, server)).toBe(false)
  })

  it('un error cualquiera (no ApiError) tiene un reintento', () => {
    expect(shouldRetry(0, new TypeError('x'))).toBe(true)
    expect(shouldRetry(1, new TypeError('x'))).toBe(false)
  })
})

describe('createQueryClient', () => {
  it('usa shouldRetry en las queries y nunca reintenta mutaciones', () => {
    const client = createQueryClient()
    const defaults = client.getDefaultOptions()
    expect(defaults.queries?.retry).toBe(shouldRetry)
    expect(defaults.mutations?.retry).toBe(false)
    expect(defaults.queries?.staleTime).toBe(STALE_TIME.quotes)
    client.clear()
  })
})

describe('queryKeys', () => {
  it('normalizan símbolos: mismo conjunto, misma llave', () => {
    expect(queryKeys.quotes([' aapl ', 'AAPL', 'walmex.mx'])).toEqual(['api', 'quotes', ['AAPL', 'WALMEX.MX']])
  })
})
