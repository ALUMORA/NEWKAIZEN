// Datos de muestra de la galería. Inventados a propósito y etiquetados como tales en la página:
// sirven para ver formatos y estados, no son cotizaciones.

/** Instante fijo de la galería: las insignias de DataStatus no cambian con el reloj. */
export const GALLERY_NOW = Date.parse('2026-09-22T20:52:00Z') // 14:52 en la Ciudad de México

export const SAMPLE_ROWS = [
  { symbol: 'WALMEX.MX', name: 'Walmart de México', sector: 'Consumo básico', price: 61.84, currency: 'MXN', change: 0.0123, ytd: -0.0842, pe: 21.4, marketCap: 1.078e12, volume: 18_420_100 },
  { symbol: 'GFNORTEO.MX', name: 'Grupo Financiero Banorte', sector: 'Financiero', price: 162.3, currency: 'MXN', change: -0.0045, ytd: 0.1161, pe: 8.9, marketCap: 4.68e11, volume: 6_120_400 },
  { symbol: 'AMXB.MX', name: 'América Móvil', sector: 'Telecomunicaciones', price: 17.02, currency: 'MXN', change: 0, ytd: 0.0412, pe: 18.2, marketCap: 1.05e12, volume: 41_880_000 },
  { symbol: 'CEMEXCPO.MX', name: 'Cemex', sector: 'Materiales', price: 12.66, currency: 'MXN', change: 0.0318, ytd: 0.2205, pe: -14.3, marketCap: 1.84e11, volume: 52_300_900 },
  { symbol: 'FUNO11.MX', name: 'Fibra Uno', sector: 'FIBRA', price: 22.91, currency: 'MXN', change: -0.0127, ytd: null, pe: null, marketCap: 8.7e10, volume: 9_004_300 },
  { symbol: 'AAPL', name: 'Apple', sector: 'Tecnología', price: 228.4, currency: 'USD', change: 0.0061, ytd: 0.1874, pe: 34.8, marketCap: 3.46e12, volume: 48_112_000 },
  { symbol: 'MSFT', name: 'Microsoft', sector: 'Tecnología', price: 438.12, currency: 'USD', change: -0.0212, ytd: 0.0409, pe: 36.1, marketCap: 3.26e12, volume: 19_870_000 },
  { symbol: 'NAFTRAC.MX', name: 'iShares NAFTRAC', sector: 'ETF', price: 58.7, currency: 'MXN', change: 0.0049, ytd: 0.0731, pe: null, marketCap: null, volume: 3_410_700 },
]

export const SWATCH_GROUPS = [
  {
    title: 'Superficies y texto',
    tokens: ['--bg', '--surface', '--surface-raised', '--surface-2', '--surface-3', '--border', '--control-border', '--ink', '--ink-soft', '--muted', '--muted-2'],
  },
  { title: 'Acento y foco', tokens: ['--accent', '--accent-strong', '--accent-soft', '--on-accent', '--focus'] },
  {
    title: 'Dirección y estado del dato',
    tokens: ['--up', '--up-soft', '--down', '--down-soft', '--flat', '--neutral-dir', '--neutral-dir-soft', '--stale', '--stale-soft'],
  },
  { title: 'Gráficas: categórica (en este orden)', tokens: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8'] },
  { title: 'Gráficas: secuencial', tokens: ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5'] },
  { title: 'Gráficas: divergente (azul y naranja)', tokens: ['--div-neg-2', '--div-neg-1', '--div-0', '--div-pos-1', '--div-pos-2'] },
  { title: 'Ejes y retícula', tokens: ['--grid', '--axis', '--crosshair'] },
]

export const TYPE_SCALE = [
  { token: '--text-3xl', px: 32, sample: 'Mi portafolio' },
  { token: '--text-2xl', px: 24, sample: 'Panorama de mercados' },
  { token: '--text-xl', px: 20, sample: '$1,234,567.89 MXN' },
  { token: '--text-lg', px: 16, sample: 'Rendimiento del año' },
  { token: '--text-md', px: 14, sample: 'Cuerpo y datos por omisión: 0.0123 se muestra 1.23%.' },
  { token: '--text-sm', px: 13, sample: 'Botones, pestañas y celdas de tabla' },
  { token: '--text-xs', px: 12, sample: 'Ayuda, pies de tarjeta y el mínimo para un dato' },
  { token: '--text-2xs', px: 11, sample: 'SOLO ETIQUETAS EN VERSALITAS', caps: true },
]

export const SPACING = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
