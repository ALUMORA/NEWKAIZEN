import { installFetch, json, networkError, text } from '../../test/fetchMock.js'
import { API_BASE } from './config.js'
import {
  getCapabilities,
  hasCapability,
  parseHealth,
  probeHealth,
  resetCapabilitiesForTests,
  startCapabilitiesProbe,
  subscribeCapabilities,
} from './capabilities.js'

const v2Health = {
  status: 'ok',
  apiVersion: 2,
  version: '2.0.0',
  commit: 'abc123',
  authRequired: true,
  capabilities: ['history.dates', 'fx.fix', 7],
  providers: { yahoo: { ok: true }, banxico: { configured: false } },
  serverTime: '2026-09-22T14:00:00Z',
}

beforeEach(() => {
  resetCapabilitiesForTests()
})

describe('parseHealth', () => {
  it('API v2: ready, capacidades como Set y authRequired', () => {
    const s = parseHealth(v2Health)
    expect(s).toMatchObject({ status: 'ready', apiVersion: 2, authRequired: true, version: '2.0.0', commit: 'abc123' })
    expect([...s.capabilities]).toEqual(['history.dates', 'fx.fix'])
    expect(s.providers.banxico).toEqual({ configured: false })
  })

  it('API viejo: {"status":"ok"} sin apiVersion es legacy y sin sesiones', () => {
    expect(parseHealth({ status: 'ok' })).toMatchObject({ status: 'legacy', apiVersion: 1, authRequired: false })
  })

  it('authRequired ausente se toma como true', () => {
    expect(parseHealth({ status: 'ok', apiVersion: 2 }).authRequired).toBe(true)
  })

  it.each([[null], ['<html>listado de directorios</html>'], [{ status: 'down' }], [[]]])('rechaza %o', (body) => {
    expect(() => parseHealth(body)).toThrow(/no esperábamos/)
  })
})

describe('probeHealth', () => {
  it('pide GET /health sin Authorization', async () => {
    const f = installFetch([json(200, v2Health)])
    await probeHealth()
    expect(f.calls[0].url).toBe(`${API_BASE}/health`)
    expect(f.calls[0].headers.authorization).toBeUndefined()
  })
})

describe('startCapabilitiesProbe', () => {
  it('detecta v2 y es idempotente (StrictMode lo llama dos veces)', async () => {
    const f = installFetch([json(200, v2Health)])
    const a = startCapabilitiesProbe()
    const b = startCapabilitiesProbe()
    expect(a).toBe(b)
    const s = await a
    expect(s.status).toBe('ready')
    expect(f.calls).toHaveLength(1)
    expect(hasCapability('fx.fix')).toBe(true)
    expect(hasCapability('valuation.dcf')).toBe(false)
    await startCapabilitiesProbe()
    expect(f.calls).toHaveLength(1)
  })

  it('detecta el backend viejo', async () => {
    installFetch([json(200, { status: 'ok' })])
    expect((await startCapabilitiesProbe()).status).toBe('legacy')
  })

  it('pasa a "waking" si tarda más de 3 s y a "ready" cuando contesta', async () => {
    vi.useFakeTimers()
    let resolveHealth
    installFetch([() => new Promise((r) => (resolveHealth = r))])
    const statuses = []
    subscribeCapabilities(() => statuses.push(getCapabilities().status))
    const p = startCapabilitiesProbe()
    expect(getCapabilities().status).toBe('probing')
    await vi.advanceTimersByTimeAsync(3000)
    expect(getCapabilities().status).toBe('waking')
    resolveHealth(json(200, v2Health)())
    await p
    expect(getCapabilities().status).toBe('ready')
    expect(statuses).toEqual(['waking', 'ready'])
  })

  it('reintenta errores de arranque en frío y termina "ready"', async () => {
    vi.useFakeTimers()
    const f = installFetch([text(503, 'Service Unavailable'), networkError(), json(200, v2Health)])
    const p = startCapabilitiesProbe()
    await vi.advanceTimersByTimeAsync(0)
    expect(getCapabilities().status).toBe('waking')
    await vi.advanceTimersByTimeAsync(2000 + 5000)
    await p
    expect(getCapabilities().status).toBe('ready')
    expect(f.calls).toHaveLength(3)
  })

  it('se rinde después de ~70 s: "down" con el error', async () => {
    vi.useFakeTimers()
    const f = installFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const p = startCapabilitiesProbe()
    await vi.advanceTimersByTimeAsync(70_000)
    const s = await p
    expect(s.status).toBe('down')
    expect(s.error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
    expect(f.calls).toHaveLength(6)
  })

  it('un 404 en /health no es arranque en frío: "down" de inmediato', async () => {
    const f = installFetch([json(404, {})])
    expect((await startCapabilitiesProbe()).status).toBe('down')
    expect(f.calls).toHaveLength(1)
  })

  it('force vuelve a sondear (botón Reintentar)', async () => {
    installFetch([json(404, {}), json(200, v2Health)])
    await startCapabilitiesProbe()
    expect(getCapabilities().status).toBe('down')
    await startCapabilitiesProbe({ force: true })
    expect(getCapabilities().status).toBe('ready')
  })
})
