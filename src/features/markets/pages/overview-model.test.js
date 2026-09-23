import { describe, expect, it } from 'vitest'
import { dailySummary, dedupeMarkets, exchangeTiming, fmtItemPrice, fmtSessionDay, fxHint, latestAsOf, pickVix } from './overview-model.js'

const item = (symbol, label, price, changePct, currency = 'USD', asOf = '2026-09-18') => ({
  symbol,
  label,
  price,
  change: price == null || changePct == null ? null : price * changePct,
  changePct,
  currency,
  asOf,
})

const OVERVIEW = {
  groups: [
    { id: 'mx', label: 'México', items: [item('^MXX', 'S&P/BMV IPC', 61234.52, 0.00487, 'MXN')] },
    { id: 'us', label: 'Estados Unidos', items: [item('^GSPC', 'S&P 500', 6650.12, -0.00298), item('^VIX', 'VIX', 15.21, 0.0277, null)] },
    { id: 'global', label: 'Resto del mundo', items: [item('^N225', 'Nikkei 225', null, null, 'JPY', null)] },
    {
      id: 'fx',
      label: 'Divisas',
      items: [item('USDMXN=X', 'Dólar frente al peso', 18.4321, 0.0027, 'MXN'), item('DX-Y.NYB', 'Índice del dólar (DXY)', 97.1, -0.001, null)],
    },
    { id: 'commodities', label: 'Materias primas', items: [item('CL=F', 'Petróleo WTI', 62.5, -0.018), item('GC=F', 'Oro', 3650, 0)] },
    { id: 'crypto', label: 'Cripto', items: [item('BTC-USD', 'Bitcoin', 65000, 0.021), item('^GSPC', 'S&P 500 repetido', 1, 0.5)] },
  ],
  marketStatus: { bmv: { open: true, label: 'Abierto.' }, nyse: { open: false, label: 'Cerrado.' } },
  meta: { asOf: '2026-09-18', source: 'yahoo', delayMinutes: 15, stale: false, fallback: false },
}

const MACRO = {
  items: [
    { id: 'ust10y', label: 'Tesoro 10 años', value: 0.0415, unit: 'fraction', changeBp: 4 },
    { id: 'vix', label: 'VIX', value: 15.9, unit: 'index', change: 0.3, asOf: '2026-09-17', source: 'cboe' },
    { id: 'dxy', label: 'DXY', value: 97.2, unit: 'index', change: 0.1 },
  ],
  meta: { asOf: '2026-09-17', source: 'fred', delayMinutes: null, stale: false, fallback: false },
}

describe('fmtSessionDay', () => {
  it('fecha sola y con día de la semana en español', () => {
    expect(fmtSessionDay('2026-09-18')).toBe('vie 18 sep')
    expect(fmtSessionDay('2025-09-19')).toBe('vie 19 sep')
  })
  it('un instante se lee en la zona de la bolsa', () => {
    // 02:00 UTC del 19 es todavía el 18 en Nueva York y en la Ciudad de México.
    expect(fmtSessionDay('2026-09-19T02:00:00Z', 'America/New_York')).toBe('vie 18 sep')
  })
  it('lo que no es fecha da s/d', () => {
    expect(fmtSessionDay('2026-02-31')).toBe('s/d')
    expect(fmtSessionDay(null)).toBe('s/d')
    expect(fmtSessionDay('ayer')).toBe('s/d')
  })
})

describe('exchangeTiming', () => {
  it('abierta: retraso aproximado', () => {
    expect(exchangeTiming({ open: true, label: 'Abierto.' }, { delayMinutes: 15 })).toMatchObject({ open: true, state: 'Abierta', timing: 'Retraso ~15 min', detail: 'Abierto.' })
    expect(exchangeTiming({ open: true, label: 'x' }, { delayMinutes: null }).timing).toBe('Retraso s/d')
  })
  it('cerrada: fecha del último cierre del grupo', () => {
    expect(exchangeTiming({ open: false, label: 'Cerrado.' }, { lastAsOf: '2026-09-18' })).toMatchObject({ open: false, state: 'Cerrada', timing: 'Cierre vie 18 sep' })
    expect(exchangeTiming({ open: false, label: 'Cerrado.' }, { lastAsOf: null }).timing).toBe('Cierre s/d')
  })
  it('sin estado del API lo dice', () => {
    expect(exchangeTiming(undefined)).toMatchObject({ known: false, state: 'Sin dato' })
  })
})

describe('fxHint y precios', () => {
  it('USD/MXN arriba es peso más débil; abajo, más fuerte; el DXY arriba es dólar más fuerte', () => {
    expect(fxHint('USDMXN=X', 0.05)).toBe('peso más débil')
    expect(fxHint('USDMXN=X', -0.05)).toBe('peso más fuerte')
    expect(fxHint('EURUSD=X', 0.01)).toBe('dólar más débil')
    expect(fxHint('USDJPY=X', 0.01)).toBe('yen más débil')
    expect(fxHint('DX-Y.NYB', 0.2)).toBe('dólar más fuerte')
    expect(fxHint('USDMXN=X', 0)).toBeUndefined()
    expect(fxHint('^GSPC', 1)).toBeUndefined()
  })
  it('índices en puntos, divisas con 4 decimales, materias primas con moneda y faltante s/d', () => {
    expect(fmtItemPrice(item('^MXX', 'IPC', 61234.52, 0), 'mx')).toBe('61,234.52')
    expect(fmtItemPrice(item('USDMXN=X', 'USD', 18.4321, 0, 'MXN'), 'fx')).toBe('18.4321')
    expect(fmtItemPrice(item('DX-Y.NYB', 'DXY', 97.1, 0, null), 'fx')).toBe('97.10')
    expect(fmtItemPrice(item('CL=F', 'WTI', 62.5, 0), 'commodities')).toBe('$62.50 USD')
    expect(fmtItemPrice(item('^N225', 'Nikkei', null, null, 'JPY'), 'global')).toBe('s/d')
  })
  it('latestAsOf toma la fecha más nueva', () => {
    expect(latestAsOf([{ asOf: '2026-09-17' }, { asOf: '2026-09-18' }, { asOf: null }])).toBe('2026-09-18')
    expect(latestAsOf([])).toBeNull()
  })
})

describe('dedupeMarkets', () => {
  it('el VIX sale solo en el medidor, el DXY una vez y nada se repite', () => {
    const world = { items: [{ country: '484', symbol: 'EWW', label: 'México', changePct: 0.01 }, { country: '484', symbol: 'EWW', label: 'México', changePct: 0.01 }, { country: '840', symbol: '^GSPC', label: 'EE. UU.', changePct: 0 }] }
    const d = dedupeMarkets({ overview: OVERVIEW, macro: MACRO, world })
    const symbols = d.groups.flatMap((g) => g.items.map((it) => it.symbol))
    expect(symbols).not.toContain('^VIX')
    expect(symbols.filter((s) => s === '^GSPC')).toHaveLength(1)
    expect(d.usRates.map((r) => r.id)).toEqual(['ust10y'])
    expect(d.world.map((w) => w.symbol)).toEqual(['EWW'])
  })
  it('sin DXY con precio en el panorama, el de macro sí se muestra', () => {
    const d = dedupeMarkets({ overview: { groups: [] }, macro: MACRO })
    expect(d.usRates.map((r) => r.id)).toEqual(['ust10y', 'dxy'])
    expect(d.groups).toEqual([])
  })
})

describe('pickVix', () => {
  it('prefiere el del panorama y cae al de macro', () => {
    expect(pickVix(OVERVIEW, MACRO)).toMatchObject({ value: 15.21, from: 'overview', delayMinutes: 15 })
    expect(pickVix({ groups: [] }, MACRO)).toMatchObject({ value: 15.9, from: 'macro', source: 'cboe', asOf: '2026-09-17' })
    expect(pickVix(null, null)).toBeNull()
  })
})

describe('dailySummary', () => {
  const { groups } = dedupeMarkets({ overview: OVERVIEW })
  const lines = dailySummary({ groups, marketStatus: OVERVIEW.marketStatus })
  const text = lines.map((l) => l.text).join(' ')

  it('IPC abierto en presente, S&P 500 cerrado en pasado, con cifras formateadas', () => {
    expect(lines.find((l) => l.id === '^MXX')?.text).toBe('S&P/BMV IPC sube 0.49% y va en 61,234.52 puntos.')
    expect(lines.find((l) => l.id === '^GSPC')?.text).toBe('S&P 500 cerró con baja de 0.30%, en 6,650.12 puntos.')
  })
  it('USD/MXN con la misma semántica que el resto: peso más débil', () => {
    expect(lines.find((l) => l.id === 'USDMXN=X')?.text).toBe('El dólar sube 0.27% frente al peso, a 18.4321 pesos por dólar: peso más débil.')
  })
  it('amplitud y extremos sin divisas ni VIX; el faltante se dice', () => {
    expect(lines.find((l) => l.id === 'breadth')?.text).toBe(
      'Contra su cierre anterior, de 5 índices, materias primas y criptomonedas con dato, 2 están arriba, 2 abajo y 1 sin cambio.',
    )
    expect(lines.find((l) => l.id === 'extremes')?.text).toBe('Mayor alza: Bitcoin, +2.10%. Mayor baja: Petróleo WTI, −1.80%.')
    expect(lines.find((l) => l.id === 'missing')?.text).toBe('Sin dato en esta actualización: Nikkei 225.')
  })
  it('sin ánimo ni causas', () => {
    expect(text).not.toMatch(/sentimiento|ánimo|optimis|pesimis|miedo|codicia|cauteloso|positivo|negativo|porque|debido|gracias a|tras |\b(sube|baja|subió|bajó|alza|cambio) por\b/i)
  })
  it('sin datos no inventa nada', () => {
    expect(dailySummary({ groups: [] })).toEqual([])
  })
})
