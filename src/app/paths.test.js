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
  ])('safeNext(%s) → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected)
  })

  it('pathLogin agrega next solo para rutas internas que no son la raíz', () => {
    expect(pathLogin('/portafolio')).toBe('/login?next=%2Fportafolio')
    expect(pathLogin('/')).toBe('/login')
    expect(pathLogin()).toBe('/login')
    expect(pathLogin('//evil.example')).toBe('/login')
  })
})
