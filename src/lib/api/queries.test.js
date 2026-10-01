// La política de reintento de TanStack no debe apilarse encima de la de apiFetch: el cliente ya
// reintenta el arranque en frío cinco veces (~67 s), y si Query volviera a reintentar, quien usa
// la app esperaría el doble antes de ver el error.
import { ApiError } from './http.js'
import { COLD_START_DELAYS_MS } from './client.js'
import * as Q from './queries.js'
import { STALE_TIME, createQueryClient, factorScreenerQuery, queryKeys, shouldRetry } from './queries.js'

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

describe('factorScreenerQuery', () => {
  it('con universo propio y sin claves no sale: el API contestaría 422', () => {
    expect(factorScreenerQuery({ universe: 'custom', symbols: [] }).enabled).toBe(false)
    expect(factorScreenerQuery({ universe: 'custom' }).enabled).toBe(false)
    expect(factorScreenerQuery({ universe: 'custom', symbols: ['  '] }).enabled).toBe(false)
  })

  it('con claves propias o con un universo fijo sí sale', () => {
    expect(factorScreenerQuery({ universe: 'custom', symbols: ['AAPL', 'MSFT'] }).enabled).toBe(true)
    expect(factorScreenerQuery({ universe: 'mx' }).enabled).toBe(true)
    expect(factorScreenerQuery({ universe: 'us' }).enabled).toBe(true)
    expect(factorScreenerQuery().enabled).toBe(true)
  })
})

describe('fase 5', () => {
  const FACTORIES = [
    'curvesQuery', 'curveSpreadsQuery', 'moneyMarketQuery', 'expectationsQuery', 'fxMonitorQuery', 'fxCrossesQuery', 'fixQuery', 'fixTableQuery',
    'fxForwardQuery', 'economicCalendarQuery', 'macroIndicatorsQuery', 'macroWorldQuery', 'eventsSeasonQuery', 'earningsQuery', 'holdersQuery',
    'sharesQuery', 'filingsQuery', 'ohlcQuery', 'moversQuery', 'breadthQuery', 'sectorsQuery', 'fundQuery', 'referenceMxQuery',
    'updateFactorQuery', 'industriesQuery', 'creditHealthQuery',
  ]

  it('hay un xQuery por ruta nueva, con llave bajo "api" y frescura de una clase conocida', () => {
    const classes = new Set(Object.values(STALE_TIME))
    for (const name of FACTORIES) {
      const factory = /** @type {any} */ (Q)[name]
      expect(typeof factory, name).toBe('function')
      const opts = factory('AAPL', {})
      expect(opts.queryKey[0], name).toBe('api')
      expect(classes.has(opts.staleTime), name).toBe(true)
      expect(typeof opts.queryFn, name).toBe('function')
    }
  })

  it('clases nuevas: curvas 1 h, intradía 1 min y referencia 24 h, las mismas de http_cache.CACHE_SECONDS', () => {
    expect(STALE_TIME.curves).toBe(3_600_000)
    expect(STALE_TIME.intraday).toBe(60_000)
    expect(STALE_TIME.reference).toBe(86_400_000)
    // El backend no tiene clase "movers": las rutas de movimientos van con la de cotizaciones.
    expect(/** @type {any} */ (STALE_TIME).movers).toBeUndefined()
  })

  // Clase de caché de cada ruta en kaizen_api/routers/*.py (cache_control): la frescura del cliente
  // es la misma que el Cache-Control que manda el servidor.
  it.each([
    ['curvesQuery', () => Q.curvesQuery({ country: 'mx' }), 'curves'],
    ['curveSpreadsQuery', () => Q.curveSpreadsQuery(), 'curves'],
    ['moneyMarketQuery', () => Q.moneyMarketQuery(), 'macro'],
    ['expectationsQuery', () => Q.expectationsQuery(), 'macro'],
    ['fxMonitorQuery', () => Q.fxMonitorQuery(), 'macro'],
    ['fxCrossesQuery', () => Q.fxCrossesQuery(), 'macro'],
    ['fixQuery', () => Q.fixQuery({ date: '2026-09-30' }), 'macro'],
    ['fixTableQuery', () => Q.fixTableQuery({ start: '2026-01-01', end: '2026-09-30' }), 'macro'],
    ['fxForwardQuery', () => Q.fxForwardQuery(), 'macro'],
    ['economicCalendarQuery', () => Q.economicCalendarQuery({ start: '2026-10-01', end: '2026-10-07' }), 'reference'],
    ['macroIndicatorsQuery', () => Q.macroIndicatorsQuery({ country: 'mx' }), 'macro'],
    ['macroWorldQuery', () => Q.macroWorldQuery(), 'reference'],
    ['eventsSeasonQuery', () => Q.eventsSeasonQuery({ universe: 'mx' }), 'fundamentals'],
    ['earningsQuery', () => Q.earningsQuery('AAPL'), 'fundamentals'],
    ['holdersQuery', () => Q.holdersQuery('AAPL'), 'fundamentals'],
    ['sharesQuery', () => Q.sharesQuery('AAPL'), 'fundamentals'],
    ['filingsQuery', () => Q.filingsQuery('AAPL'), 'fundamentals'],
    ['moversQuery', () => Q.moversQuery({ market: 'mx', kind: 'gainers' }), 'quotes'],
    ['breadthQuery', () => Q.breadthQuery({ market: 'mx' }), 'quotes'],
    ['sectorsQuery', () => Q.sectorsQuery({ market: 'mx' }), 'quotes'],
    ['fundQuery', () => Q.fundQuery('SPY'), 'fundamentals'],
    ['referenceMxQuery', () => Q.referenceMxQuery(), 'reference'],
    ['updateFactorQuery', () => Q.updateFactorQuery({ from: '2025-01', to: '2026-08' }), 'macro'],
    ['industriesQuery', () => Q.industriesQuery({ market: 'US' }), 'reference'],
    ['creditHealthQuery', () => Q.creditHealthQuery('AAPL'), 'fundamentals'],
  ])('%s usa la frescura de la clase %s', (_, make, cls) => {
    expect(make().staleTime).toBe(/** @type {any} */ (STALE_TIME)[cls])
  })

  it('velas intradía se refrescan cada minuto; las diarias no', () => {
    const intraday = Q.ohlcQuery('AAPL', { range: '1d', interval: '5m' })
    expect(intraday.staleTime).toBe(STALE_TIME.intraday)
    expect(typeof intraday.refetchInterval).toBe('function')
    const daily = Q.ohlcQuery('AAPL', { range: '1y', interval: '1d' })
    expect(daily.staleTime).toBe(STALE_TIME.history)
    expect(daily.refetchInterval).toBe(false)
  })

  it('las llaves no dependen del orden de las listas ni de los undefined', () => {
    expect(queryKeys.curves({ country: 'mx', compare: ['1y', '1w'] })).toEqual(queryKeys.curves({ country: 'mx', compare: ['1w', '1y'], extra: undefined }))
    expect(queryKeys.earnings(' aapl'.trim())).toEqual(['api', 'earnings', 'AAPL'])
    expect(queryKeys.ohlc('aapl')).toEqual(['api', 'ohlc', 'AAPL', { range: '6mo', interval: '1d' }])
  })

  it('las que piden fechas o meses no salen sin ellas', () => {
    expect(Q.fixQuery(/** @type {any} */ ({})).enabled).toBe(false)
    expect(Q.fixTableQuery(/** @type {any} */ ({ start: '2026-01-01' })).enabled).toBe(false)
    expect(Q.economicCalendarQuery(/** @type {any} */ ({ end: '2026-10-01' })).enabled).toBe(false)
    expect(Q.updateFactorQuery(/** @type {any} */ ({ from: '2026-01' })).enabled).toBe(false)
    expect(Q.earningsQuery('').enabled).toBe(false)
    expect(Q.fixQuery({ date: '2026-09-30' }).enabled).toBe(true)
  })
})
