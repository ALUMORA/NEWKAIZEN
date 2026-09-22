import {
  BACKUP_PREFIX,
  FUTURE_VERSION_ERROR,
  LEGACY_KEYS,
  MIGRATED_NOTE,
  STORAGE_KEY,
  ImportError,
  emptyState,
  exportJSON,
  getStorageError,
  hashLegacyValue,
  importJSON,
  isReadOnly,
  legacyChangedSinceMigration,
  load,
  migrateLegacy,
  normalizeState,
  resetStorageForTests,
  save,
  subscribe,
  update,
  validateTransaction,
} from './storage.js'

const backupKeys = () =>
  Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k) => k.startsWith(BACKUP_PREFIX))

const legacyPortfolios = [
  {
    id: 'p1',
    name: 'Principal',
    positions: [
      { ticker: 'AAPL', shares: 10, cost: 150 },
      { ticker: 'WALMEX.MX', shares: 50, cost: 68 },
      { ticker: '$MXN', shares: 25000, cost: 1 },
    ],
  },
  { id: 'p2', name: 'Retiro', positions: [{ ticker: 'naftrac.mx', shares: 3, cost: 60.5 }] },
]

beforeEach(() => {
  resetStorageForTests()
})

describe('arranque sin datos', () => {
  it('empieza sin portafolios y sin escribir nada', () => {
    const s = load()
    expect(s.v).toBe(2)
    expect(s.portfolios).toEqual([])
    expect(s.activePortfolioId).toBeNull()
    expect(s.watchlists).toEqual([])
    expect(s.settings).toEqual({ benchmark: 'NAFTRAC.MX', riskProfile: null, onboardingDone: false })
    expect(s.migrationReport).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('load() devuelve la misma referencia mientras no cambie (useSyncExternalStore)', () => {
    expect(load()).toBe(load())
  })
})

describe('migración desde momentum_portfolios', () => {
  beforeEach(() => {
    localStorage.setItem(LEGACY_KEYS.portfolios, JSON.stringify(legacyPortfolios))
    localStorage.setItem(LEGACY_KEYS.screener, 'AAPL, msft,  WALMEX.MX,AAPL, bad ticker!!')
  })

  it('convierte posiciones en movimientos con $MXN como depósito', () => {
    const s = load()
    expect(s.portfolios.map((p) => [p.id, p.name, p.baseCurrency])).toEqual([
      ['p1', 'Principal', 'MXN'],
      ['p2', 'Retiro', 'MXN'],
    ])
    expect(s.activePortfolioId).toBe('p1')
    const [aapl, walmex, cash] = s.portfolios[0].transactions
    expect(aapl).toEqual({
      id: 'p1-mig-1', type: 'buy', date: null, symbol: 'AAPL', quantity: 10, price: 150, currency: 'USD',
      fxRate: null, fees: 0, amount: null, ratio: null, note: MIGRATED_NOTE,
    })
    expect(walmex).toMatchObject({ type: 'buy', symbol: 'WALMEX.MX', quantity: 50, price: 68, currency: 'MXN' })
    expect(cash).toMatchObject({ type: 'deposit', symbol: null, amount: 25000, currency: 'MXN', note: MIGRATED_NOTE })
    expect(s.portfolios[1].transactions[0]).toMatchObject({ symbol: 'NAFTRAC.MX', currency: 'MXN', price: 60.5 })
  })

  it('pasa momentum_screener a la lista "Mi lista" sin repetidos ni inválidos', () => {
    const s = load()
    expect(s.watchlists).toEqual([{ id: 'wl-mi-lista', name: 'Mi lista', symbols: ['AAPL', 'MSFT', 'WALMEX.MX'] }])
    expect(s.migrationReport.dropped.some((d) => d.source === LEGACY_KEYS.screener)).toBe(true)
  })

  it('respalda cada llave vieja, nunca las borra y escribe kaizen:v2', () => {
    const s = load()
    expect(localStorage.getItem(LEGACY_KEYS.portfolios)).toBe(JSON.stringify(legacyPortfolios))
    expect(localStorage.getItem(LEGACY_KEYS.screener)).not.toBeNull()
    const backups = backupKeys()
    expect(backups).toHaveLength(2)
    for (const key of backups) {
      expect(key).toMatch(/^kaizen:backup:\d{4}-\d{2}-\d{2}T[\d:.]+Z:(momentum_portfolios|momentum_screener)$/)
      const original = key.endsWith(LEGACY_KEYS.portfolios) ? LEGACY_KEYS.portfolios : LEGACY_KEYS.screener
      expect(localStorage.getItem(key)).toBe(localStorage.getItem(original))
    }
    expect(s.migrationReport.backups.sort()).toEqual(backups.sort())
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).portfolios).toHaveLength(2)
  })

  it('el reporte cuenta portafolios, movimientos, listas y fuentes', () => {
    const r = load().migrationReport
    expect(r).toMatchObject({
      sources: [LEGACY_KEYS.portfolios, LEGACY_KEYS.screener],
      portfolios: 2,
      transactions: 4,
      watchlists: 1,
      legacyExample: false,
      recoveredFromCorruptV2: false,
    })
  })

  it('migra una sola vez: con kaizen:v2 presente ya no vuelve a leer las llaves viejas', () => {
    load()
    resetStorageForTests()
    localStorage.setItem(LEGACY_KEYS.portfolios, JSON.stringify([{ id: 'x', name: 'Otro', positions: [] }]))
    const s = load()
    expect(s.portfolios.map((p) => p.name)).toEqual(['Principal', 'Retiro'])
    expect(backupKeys()).toHaveLength(2)
  })
})

describe('migración desde momentum_portfolio (un solo portafolio)', () => {
  it('crea "Principal" con p1', () => {
    localStorage.setItem(LEGACY_KEYS.portfolio, JSON.stringify([{ ticker: 'CEMEXCPO.MX', shares: 100, cost: 8.5 }]))
    const s = load()
    expect(s.portfolios).toHaveLength(1)
    expect(s.portfolios[0]).toMatchObject({ id: 'p1', name: 'Principal' })
    expect(s.portfolios[0].transactions[0]).toMatchObject({ symbol: 'CEMEXCPO.MX', quantity: 100, price: 8.5, currency: 'MXN' })
    expect(s.migrationReport.sources).toEqual([LEGACY_KEYS.portfolio])
    expect(backupKeys()).toEqual([expect.stringMatching(/:momentum_portfolio$/)])
    expect(localStorage.getItem(LEGACY_KEYS.portfolio)).not.toBeNull()
  })

  it('momentum_portfolios gana si existen las dos, como en la app vieja', () => {
    localStorage.setItem(LEGACY_KEYS.portfolio, JSON.stringify([{ ticker: 'AMZN', shares: 1, cost: 1 }]))
    localStorage.setItem(LEGACY_KEYS.portfolios, JSON.stringify(legacyPortfolios))
    expect(load().portfolios.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('si momentum_portfolios está roto usa momentum_portfolio y lo reporta', () => {
    localStorage.setItem(LEGACY_KEYS.portfolios, '{no es json')
    localStorage.setItem(LEGACY_KEYS.portfolio, JSON.stringify([{ ticker: 'AMZN', shares: 1, cost: 100 }]))
    const s = load()
    expect(s.portfolios[0].transactions[0].symbol).toBe('AMZN')
    expect(s.migrationReport.dropped).toContainEqual({ source: LEGACY_KEYS.portfolios, reason: 'JSON inválido' })
  })
})

describe('entradas mal formadas', () => {
  it('descarta posiciones inválidas y conserva las buenas', () => {
    localStorage.setItem(
      LEGACY_KEYS.portfolios,
      JSON.stringify([
        {
          id: 'p1',
          name: '',
          positions: [
            null,
            { ticker: 'AAPL', shares: -1, cost: 10 },
            { ticker: 'AAPL', shares: 'diez', cost: 10 },
            { ticker: '<script>', shares: 1, cost: 1 },
            { ticker: 'MSFT', shares: 2, cost: -5 },
            { ticker: 'MSFT', shares: 2 },
            { ticker: 'NVDA', shares: '3', cost: '100.5' },
          ],
        },
        'basura',
      ]),
    )
    const s = load()
    expect(s.portfolios).toHaveLength(1)
    expect(s.portfolios[0].name).toBe('Portafolio 1')
    const txs = s.portfolios[0].transactions
    expect(txs.map((t) => [t.symbol, t.quantity, t.price])).toEqual([
      ['MSFT', 2, null],
      ['NVDA', 3, 100.5],
    ])
    const reasons = s.migrationReport.dropped.map((d) => d.reason)
    expect(reasons).toEqual(
      expect.arrayContaining(['posición mal formada', 'cantidad inválida', 'costo inválido', 'portafolio mal formado']),
    )
    expect(reasons.some((r) => r.startsWith('ticker inválido'))).toBe(true)
    expect(s.migrationReport.notes).toContain('Algunas posiciones no tenían costo y quedaron sin precio de compra.')
  })

  it('marca el portafolio de ejemplo de la versión anterior', () => {
    localStorage.setItem(
      LEGACY_KEYS.portfolios,
      JSON.stringify([
        {
          id: 'p1',
          name: 'Principal',
          positions: [
            { ticker: 'AAPL', shares: 10, cost: 150 },
            { ticker: 'MSFT', shares: 8, cost: 320 },
            { ticker: 'AMZN', shares: 5, cost: 130 },
            { ticker: 'CEMEXCPO.MX', shares: 100, cost: 8.5 },
            { ticker: 'WALMEX.MX', shares: 50, cost: 68 },
          ],
        },
      ]),
    )
    expect(load().migrationReport.legacyExample).toBe(true)
  })

  it('kaizen:v2 dañado se respalda y se vuelve a migrar desde las llaves viejas', () => {
    localStorage.setItem(STORAGE_KEY, '{"v":2,')
    localStorage.setItem(LEGACY_KEYS.portfolios, JSON.stringify(legacyPortfolios))
    const s = load()
    expect(s.portfolios).toHaveLength(2)
    expect(s.migrationReport.recoveredFromCorruptV2).toBe(true)
    const v2Backup = backupKeys().find((k) => k.endsWith(`:${STORAGE_KEY}`))
    expect(localStorage.getItem(v2Backup)).toBe('{"v":2,')
  })

  it('kaizen:v2 dañado sin llaves viejas: estado vacío, respaldo y reporte', () => {
    localStorage.setItem(STORAGE_KEY, 'null')
    const s = load()
    expect(s.portfolios).toEqual([])
    expect(s.migrationReport.recoveredFromCorruptV2).toBe(true)
    expect(backupKeys()).toHaveLength(1)
    resetStorageForTests()
    load()
    expect(backupKeys()).toHaveLength(1)
  })

  it('normalizeState descarta movimientos inválidos y ajusta el portafolio activo', () => {
    const res = normalizeState({
      v: 2,
      portfolios: [
        {
          id: 'a',
          name: 'A',
          transactions: [
            { id: 't1', type: 'buy', symbol: 'AAPL', quantity: 1, price: 10, currency: 'USD', date: '2026-01-02' },
            { id: 't2', type: 'buy', symbol: 'AAPL', quantity: 0, price: 10, currency: 'USD' },
            { id: 't3', type: 'teleport', symbol: 'AAPL' },
            { id: 't4', type: 'deposit', amount: 100, currency: 'EUR' },
            { id: 't5', type: 'split', symbol: 'AAPL', ratio: 4, date: '2026-02-30' },
          ],
          targets: { AAPL: 0.6, 'mal símbolo': 0.4, MSFT: 3 },
        },
      ],
      activePortfolioId: 'no-existe',
      settings: { benchmark: '???', onboardingDone: 'sí' },
    })
    expect(res.state.portfolios[0].transactions.map((t) => t.id)).toEqual(['t1'])
    expect(res.state.portfolios[0].targets).toEqual({ AAPL: 0.6 })
    expect(res.state.activePortfolioId).toBe('a')
    expect(res.state.settings).toEqual({ benchmark: 'NAFTRAC.MX', riskProfile: null, onboardingDone: false })
    expect(res.dropped.map((d) => d.reason)).toEqual(
      expect.arrayContaining(['la cantidad debe ser mayor que cero', 'tipo desconocido (teleport)', 'moneda no soportada (EUR)', 'fecha inválida']),
    )
  })

  it('normalizeState rechaza lo que no es v2', () => {
    expect(normalizeState(null)).toBeNull()
    expect(normalizeState({ v: 1 })).toBeNull()
    expect(normalizeState([])).toBeNull()
  })
})

describe('validateTransaction', () => {
  it.each([
    [{ type: 'sell', symbol: 'AAPL', quantity: 1, price: 200, currency: 'USD', fxRate: 17.2 }, true],
    [{ type: 'dividend', symbol: 'AAPL', amount: 0.25, currency: 'USD' }, true],
    [{ type: 'withdrawal', amount: 500 }, true],
    [{ type: 'fee', amount: 10, symbol: 'AAPL' }, true],
    [{ type: 'split', symbol: 'NVDA', ratio: 10 }, true],
    [{ type: 'withdrawal', amount: 0 }, false],
    [{ type: 'buy', symbol: 'AAPL', quantity: 1, price: 1, fees: -1 }, false],
    [{ type: 'buy', symbol: 'AAPL', quantity: 1, price: 1, fxRate: 0 }, false],
    [{ type: 'buy', quantity: 1, price: 1 }, false],
    [{ type: 'split', symbol: 'NVDA', ratio: 0 }, false],
  ])('%o → válido: %s', (raw, ok) => {
    expect(Boolean(validateTransaction(raw).tx)).toBe(ok)
  })

  it('completa valores por defecto', () => {
    const { tx } = validateTransaction({ type: 'deposit', amount: 10 })
    expect(tx).toMatchObject({ currency: 'MXN', fees: 0, date: null, note: '', symbol: null })
    expect(tx.id).toMatch(/^tx_/)
  })
})

describe('save, update y subscribe', () => {
  it('save valida, fija updatedAt, escribe y avisa', () => {
    const calls = []
    const off = subscribe(() => calls.push(load()))
    const next = save({ ...emptyState('2020-01-01T00:00:00.000Z'), portfolios: [{ id: 'x', name: 'X', transactions: [] }] })
    expect(next.updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
    expect(next.activePortfolioId).toBe('x')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).portfolios[0].name).toBe('X')
    expect(calls).toHaveLength(1)
    expect(load()).toBe(next)
    off()
    update((s) => ({ ...s, settings: { ...s.settings, onboardingDone: true } }))
    expect(calls).toHaveLength(1)
    expect(load().settings.onboardingDone).toBe(true)
  })

  it('si el navegador no deja escribir, el cambio queda en memoria y se reporta', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const next = save(emptyState())
    expect(load()).toBe(next)
    expect(getStorageError()).toEqual({ code: 'WRITE_FAILED', message: 'No se pudieron guardar tus cambios en este navegador.' })
    spy.mockRestore()
    save(next)
    expect(getStorageError()).toBeNull()
  })
})

describe('exportar e importar', () => {
  it('ida y vuelta conserva el estado', () => {
    localStorage.setItem(LEGACY_KEYS.portfolios, JSON.stringify(legacyPortfolios))
    const before = load()
    const text = exportJSON()
    const envelope = JSON.parse(text)
    expect(envelope).toMatchObject({ app: 'kaizen', kind: 'kaizen-backup', v: 2 })

    save(emptyState())
    expect(load().portfolios).toEqual([])
    const { state, dropped, backup } = importJSON(text)
    expect(dropped).toEqual([])
    const strip = (s) => {
      const copy = { ...s }
      delete copy.updatedAt
      return copy
    }
    expect(strip(state)).toEqual(strip(before))
    expect(strip(load())).toEqual(strip(before))
    expect(backup).toMatch(/:kaizen:v2$/)
  })

  it('acepta el estado v2 sin sobre', () => {
    const raw = { ...emptyState(), watchlists: [{ id: 'w', name: 'W', symbols: ['aapl', 'AAPL', 'x y'] }] }
    const { state } = importJSON(JSON.stringify(raw))
    expect(state.watchlists[0].symbols).toEqual(['AAPL'])
  })

  it.each([
    ['no es json', 'El archivo no es un JSON válido.'],
    [JSON.stringify({ v: 1 }), 'El archivo no tiene el formato de respaldo de Kaizen (versión 2).'],
    [JSON.stringify({ kind: 'kaizen-backup', data: null }), 'El archivo no tiene el formato de respaldo de Kaizen (versión 2).'],
  ])('rechaza %s', (text, message) => {
    expect(() => importJSON(text)).toThrow(ImportError)
    expect(() => importJSON(text)).toThrow(message)
  })

  it('importar nunca borra las llaves viejas', () => {
    localStorage.setItem(LEGACY_KEYS.screener, 'AAPL')
    load()
    importJSON(JSON.stringify(emptyState()))
    expect(localStorage.getItem(LEGACY_KEYS.screener)).toBe('AAPL')
  })
})

describe('migrateLegacy (puro)', () => {
  it('null si no hay llaves viejas', () => {
    expect(migrateLegacy(() => null)).toBeNull()
  })

  it('no toca el storage', () => {
    const store = { [LEGACY_KEYS.screener]: 'AAPL\nMSFT' }
    const s = migrateLegacy((k) => store[k] ?? null, '2026-09-22T00:00:00.000Z')
    expect(s.watchlists[0].symbols).toEqual(['AAPL', 'MSFT'])
    expect(s.portfolios).toEqual([])
    expect(localStorage.length).toBe(0)
  })

  it('acepta momentum_screener como arreglo JSON', () => {
    const s = migrateLegacy((k) => (k === LEGACY_KEYS.screener ? '["amxl.mx","AMXL.MX"]' : null))
    expect(s.watchlists[0].symbols).toEqual(['AMXL.MX'])
  })
})

describe('datos de una versión más nueva', () => {
  const future = {
    v: 3,
    updatedAt: '2027-01-01T00:00:00.000Z',
    portfolios: [{ id: 'p-nuevo', name: 'Del futuro', transactions: [] }],
    activePortfolioId: 'p-nuevo',
    watchlists: [],
    settings: { benchmark: 'NAFTRAC.MX', riskProfile: null, onboardingDone: true },
    novedad: 'un campo que esta versión no conoce',
  }
  const stored = JSON.stringify(future)

  beforeEach(() => {
    localStorage.setItem(STORAGE_KEY, stored)
    localStorage.setItem(LEGACY_KEYS.portfolios, JSON.stringify(legacyPortfolios))
  })

  it('no los sobrescribe, no los respalda y no re-migra', () => {
    const state = load()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
    expect(backupKeys()).toEqual([])
    expect(state.portfolios).toEqual([])
    expect(state.migrationReport).toBeNull()
  })

  it('el estado queda en solo lectura y el mensaje está en español', () => {
    expect(isReadOnly()).toBe(true)
    expect(getStorageError()).toEqual({
      code: 'FUTURE_VERSION',
      message: 'Tus datos se guardaron con una versión más nueva de Kaizen. Recarga la página para usarla.',
    })
    expect(FUTURE_VERSION_ERROR.message).not.toMatch(/[—–]/)
  })

  it('guardar no hace nada: ni en el storage ni en memoria, y lo reporta', () => {
    const before = load()
    const calls = []
    const off = subscribe(() => calls.push(1))
    const next = save({ ...emptyState(), portfolios: [{ id: 'x', name: 'X', transactions: [] }] })
    expect(next).toBe(before)
    expect(load().portfolios).toEqual([])
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
    expect(getStorageError()?.code).toBe('FUTURE_VERSION')
    expect(calls).toHaveLength(1)
    off()

    update((st) => ({ ...st, settings: { ...st.settings, onboardingDone: true } }))
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
    expect(load().settings.onboardingDone).toBe(false)
  })

  it('importar tampoco pisa los datos nuevos', () => {
    expect(() => importJSON(JSON.stringify(emptyState()))).toThrow(ImportError)
    expect(() => importJSON(JSON.stringify(emptyState()))).toThrow(FUTURE_VERSION_ERROR.message)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored)
  })

  it('un v que no es número sigue contando como dañado (se respalda y se empieza de cero)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...future, v: 'tres' }))
    resetStorageForTests()
    const state = load()
    expect(isReadOnly()).toBe(false)
    expect(state.migrationReport?.recoveredFromCorruptV2).toBe(true)
    expect(backupKeys().some((k) => k.endsWith(':kaizen:v2'))).toBe(true)
  })
})

describe('la migración es una foto única (legacyHashes)', () => {
  it('guarda la huella de las tres llaves viejas al migrar', () => {
    localStorage.setItem(LEGACY_KEYS.portfolios, JSON.stringify(legacyPortfolios))
    localStorage.setItem(LEGACY_KEYS.screener, 'AAPL,MSFT')
    const state = load()
    expect(state.legacyHashes).toEqual({
      [LEGACY_KEYS.portfolios]: hashLegacyValue(JSON.stringify(legacyPortfolios)),
      [LEGACY_KEYS.portfolio]: null,
      [LEGACY_KEYS.screener]: hashLegacyValue('AAPL,MSFT'),
    })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).legacyHashes).toEqual(state.legacyHashes)
  })

  it('hashLegacyValue cambia con el contenido y no guarda una copia del texto', () => {
    expect(hashLegacyValue(null)).toBeNull()
    expect(hashLegacyValue('AAPL,MSFT')).toBe(hashLegacyValue('AAPL,MSFT'))
    expect(hashLegacyValue('AAPL,MSFT')).not.toBe(hashLegacyValue('AAPL,MSFU'))
    expect(hashLegacyValue('AAPL,MSFT')).not.toContain('AAPL')
  })

  it('legacyChangedSinceMigration ve el cambio pero no re-migra', () => {
    localStorage.setItem(LEGACY_KEYS.portfolios, JSON.stringify(legacyPortfolios))
    const migrated = load()
    expect(legacyChangedSinceMigration()).toEqual({ known: true, changed: [], hashes: migrated.legacyHashes })

    // La app legada sigue viva y agrega una posición.
    const touched = [...legacyPortfolios, { id: 'p3', name: 'Nuevo', positions: [{ ticker: 'GMEXICOB.MX', shares: 1, cost: 100 }] }]
    localStorage.setItem(LEGACY_KEYS.portfolios, JSON.stringify(touched))
    resetStorageForTests()
    const after = load()
    expect(legacyChangedSinceMigration().changed).toEqual([LEGACY_KEYS.portfolios])
    // Nada se re-migró: siguen los dos portafolios de la foto original.
    expect(after.portfolios.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(after.legacyHashes).toEqual(migrated.legacyHashes)
  })

  it('borrar una llave vieja también cuenta como cambio', () => {
    localStorage.setItem(LEGACY_KEYS.screener, 'AAPL')
    load()
    localStorage.removeItem(LEGACY_KEYS.screener)
    expect(legacyChangedSinceMigration().changed).toEqual([LEGACY_KEYS.screener])
  })

  // El Workspace legado escribe "momentum_screener" con su lista por defecto en cada montaje
  // (App.legacy.jsx, efecto "Persistir screener"), así que a quien estrena la app nueva y luego
  // abre cualquier ruta legada le aparece una llave vieja que no existía al migrar. Eso es ruido
  // del legado, no algo que la persona haya cambiado: si contara, F1 ofrecería re-importar datos
  // viejos sin que nadie los haya tocado.
  describe('lo que el legado escribe solo por montarse no cuenta como cambio', () => {
    // Tal como lo escribe la app vieja: SCREEN_TICKERS.join(", "), con espacio después de la coma.
    const legacyDefaultScreener = 'AAPL, MSFT, GOOGL, AMZN, META, NVDA, TSLA, JPM, V, WMT, CEMEXCPO.MX, WALMEX.MX, AMXL.MX, FEMSAUBD.MX'
    const legacyDefaultPortfolios = JSON.stringify([
      {
        id: 'p1',
        name: 'Principal',
        positions: [
          { ticker: 'AAPL', shares: 10, cost: 150 },
          { ticker: 'MSFT', shares: 8, cost: 320 },
          { ticker: 'AMZN', shares: 5, cost: 130 },
          { ticker: 'CEMEXCPO.MX', shares: 100, cost: 8.5 },
          { ticker: 'WALMEX.MX', shares: 50, cost: 68 },
        ],
      },
    ])

    it('el screener por defecto que aparece al abrir una ruta legada no es divergencia', () => {
      load() // storage vacío: la foto guarda null en las tres llaves
      localStorage.setItem(LEGACY_KEYS.screener, legacyDefaultScreener)
      expect(legacyChangedSinceMigration().changed).toEqual([])
      expect(legacyChangedSinceMigration().known).toBe(true)
    })

    it('el portafolio de ejemplo del legado tampoco', () => {
      load()
      localStorage.setItem(LEGACY_KEYS.portfolios, legacyDefaultPortfolios)
      expect(legacyChangedSinceMigration().changed).toEqual([])
    })

    it('una lista que la persona sí cambió sigue contando', () => {
      load()
      localStorage.setItem(LEGACY_KEYS.screener, `${legacyDefaultScreener}, GMEXICOB.MX`)
      expect(legacyChangedSinceMigration().changed).toEqual([LEGACY_KEYS.screener])
    })

    it('el filtro solo aplica a una llave que no existía al migrar', () => {
      localStorage.setItem(LEGACY_KEYS.screener, 'AAPL,MSFT')
      load()
      // La llave sí existía y ahora quedó en la lista por defecto: eso lo hizo la persona.
      localStorage.setItem(LEGACY_KEYS.screener, legacyDefaultScreener)
      expect(legacyChangedSinceMigration().changed).toEqual([LEGACY_KEYS.screener])
    })
  })

  it('sin foto guardada (estado de antes de este cambio) avisa known: false', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...emptyState(), legacyHashes: undefined }))
    const res = legacyChangedSinceMigration()
    expect(res.known).toBe(false)
    expect(res.changed).toEqual([])
  })

  it('guardar conserva la foto', () => {
    localStorage.setItem(LEGACY_KEYS.screener, 'AAPL')
    const hashes = load().legacyHashes
    const next = update((s) => ({ ...s, settings: { ...s.settings, onboardingDone: true } }))
    expect(next.legacyHashes).toEqual(hashes)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).legacyHashes).toEqual(hashes)
  })
})
