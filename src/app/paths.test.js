import { DEFAULT_PRIVATE_PATH, PATHS, pathCompare, pathInstrument, pathLearnTerm, pathLogin, route, safeNext } from './paths.js'

describe('paths', () => {
  it('route() quita la diagonal inicial para los routes.jsx', () => {
    expect(route(PATHS.portfolioRisk)).toBe('portafolio/riesgo')
    expect(route(PATHS.instrument)).toBe('investigar/:symbol')
  })

  it('helpers de rutas con parámetros', () => {
    expect(pathInstrument(' walmex.mx ')).toBe('/investigar/WALMEX.MX')
    expect(pathInstrument('^MXX')).toBe('/investigar/%5EMXX')
    expect(pathCompare(['aapl', 'MSFT'])).toBe('/investigar/comparar?symbols=AAPL,MSFT')
    expect(pathCompare([])).toBe('/investigar/comparar')
    expect(pathLearnTerm('Sharpe')).toBe('/aprender/sharpe')
  })

  it.each([
    ['/portafolio', '/portafolio'],
    ['/investigar/AAPL?x=1#y', '/investigar/AAPL?x=1#y'],
    [null, DEFAULT_PRIVATE_PATH],
    ['', DEFAULT_PRIVATE_PATH],
    ['portafolio', DEFAULT_PRIVATE_PATH],
    ['//evil.example/x', DEFAULT_PRIVATE_PATH],
    ['/\\evil.example', DEFAULT_PRIVATE_PATH],
    ['https://evil.example', DEFAULT_PRIVATE_PATH],
    ['javascript:alert(1)', DEFAULT_PRIVATE_PATH],
    ['/login', DEFAULT_PRIVATE_PATH],
    ['/login?next=/x', DEFAULT_PRIVATE_PATH],
    ['/loginator', '/loginator'],
    ['/LOGIN', DEFAULT_PRIVATE_PATH],
    ['/login/', DEFAULT_PRIVATE_PATH],
    ['/investigar/%5EMXX', '/investigar/%5EMXX'],
  ])('safeNext(%s) → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected)
  })

  // ?next llega ya decodificado una vez (URLSearchParams): se prueban los caracteres crudos y
  // también la forma %XX, por si el link venía codificado dos veces.
  it.each([
    // Caracteres de control: el parser de URL borra tab, LF y CR y "/\t/example.com" queda "//example.com".
    ['/\t/example.com'],
    ['/\n/example.com'],
    ['/\r/example.com'],
    ['/%09/example.com'],
    ['/%0A/example.com'],
    ['/%0d/example.com'],
    ['/\u0000portafolio'],
    ['/%00portafolio'],
    ['/\u007F'],
    ['/%7F'],
    // Diagonal invertida: el parser la trata como "/".
    ['/\\example.com'],
    ['/%5Cexample.com'],
    ['/%5C%5Cexample.com'],
    ['/portafolio%5C..%5C'],
    // Relativas al protocolo, también disfrazadas.
    ['//example.com'],
    ['///example.com'],
    ['/%2F/example.com'],
    ['/%2Fexample.com'],
    // Relativas al protocolo por la vía de los segmentos de punto: el parser normaliza "/.."
    // DENTRO del mismo origen y deja el pathname "//example.com".
    ['/..//example.com'],
    ['/..//example.com?x=1'],
    ['/..//example.com#z'],
    ['/..//attacker.test/path'],
    ['/%2e%2e//example.com'],
    ['/.%2e//example.com'],
    ['/a/../..//example.com'],
    ['/investigar/../..//example.com'],
    // Esquemas y URLs absolutas.
    ['https:'],
    ['https://example.com/portafolio'],
    ['http:/example.com'],
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['data:text/html,hola'],
    // %XX mal formado.
    ['/%E0%A4%A'],
  ])('safeNext rechaza %j', (input) => {
    expect(safeNext(input)).toBe(DEFAULT_PRIVATE_PATH)
    expect(safeNext(input, '/respaldo')).toBe('/respaldo')
  })

  it('safeNext normaliza la ruta y se queda en el origen de la página', () => {
    expect(safeNext('/investigar/../portafolio?x=1#y')).toBe('/portafolio?x=1#y')
    expect(safeNext('/./screener')).toBe('/screener')
    expect(safeNext('/login/../portafolio')).toBe('/portafolio')
    expect(safeNext('/a/../login')).toBe(DEFAULT_PRIVATE_PATH)
    // Subir de más no debe sacarnos del sitio: se queda en la raíz, no en "//".
    expect(safeNext('/../portafolio')).toBe('/portafolio')
    expect(safeNext('/a/b/../../../../screener')).toBe('/screener')
  })

  it('safeNext nunca devuelve algo que empiece con "//"', () => {
    for (const input of ['/..//example.com', '/%2e%2e//example.com', '/a/../..//example.com', '/..//example.com?x=1']) {
      expect(safeNext(input, '/respaldo').startsWith('//')).toBe(false)
    }
  })

  it('safeNext compara contra location.origin cuando hay página', () => {
    vi.stubGlobal('location', { origin: 'https://kaizen.example' })
    try {
      expect(safeNext('/portafolio')).toBe('/portafolio')
      expect(safeNext('//kaizen.example.evil.com/x')).toBe(DEFAULT_PRIVATE_PATH)
      expect(safeNext('https://kaizen.example/portafolio')).toBe(DEFAULT_PRIVATE_PATH)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('pathLogin agrega next solo para rutas internas que no son la raíz', () => {
    expect(pathLogin('/portafolio')).toBe('/login?next=%2Fportafolio')
    expect(pathLogin('/')).toBe('/login')
    expect(pathLogin()).toBe('/login')
    expect(pathLogin('//evil.example')).toBe('/login')
    expect(pathLogin('/\t/evil.example')).toBe('/login')
  })
})
