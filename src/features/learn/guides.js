// Guías de metodología: los .md de docs/metodologia, cargados como texto y cada uno en su chunk.
const files = import.meta.glob('../../../docs/metodologia/*.md', { query: '?raw', import: 'default' })

/** slug → cargador del texto. README es el índice y no se lista como guía. */
export const GUIDES = Object.fromEntries(
  Object.entries(files)
    .map(([path, load]) => [path.split('/').pop().replace(/\.md$/, ''), load])
    .filter(([slug]) => slug !== 'README'),
)

/**
 * Nombres cortos para la lista de /aprender (el título largo sale del propio archivo). Solo se
 * listan las guías que existen en docs/metodologia; las de la fase 5 ya tienen nombre aquí para que
 * aparezcan en cuanto su stream escriba el archivo.
 */
export const GUIDE_NAMES = {
  backtest: 'Backtest',
  fibras: 'FIBRAs',
  'formula-magica': 'Fórmula mágica',
  'fuentes-de-datos': 'Fuentes de datos',
  mercados: 'Mercados',
  optimizador: 'Optimizador',
  portafolio: 'Portafolio',
  riesgo: 'Riesgo',
  'screener-de-factores': 'Screener de factores',
  simulador: 'Simulador',
  'valuacion-dcf': 'Valuación DCF',
  // Fase 5
  'tasas-y-curvas': 'Tasas y curvas',
  'tipo-de-cambio': 'Tipo de cambio',
  'economia-y-calendario': 'Economía y calendario',
  'resultados-y-documentos': 'Resultados y documentos',
  'analisis-tecnico': 'Análisis técnico',
  empresas: 'Empresas',
}

/**
 * Guías que se listan en /aprender: las que existen, con su nombre corto o, si una guía nueva no lo
 * tiene, su slug legible ("costo-de-capital" da "Costo de capital").
 * @returns {[string, string][]}
 */
export function guideList() {
  return Object.keys(GUIDES)
    .sort((a, b) => (GUIDE_NAMES[a] ?? a).localeCompare(GUIDE_NAMES[b] ?? b, 'es-MX'))
    .map((slug) => [slug, GUIDE_NAMES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ')])
}

/** El título (# ...) de una guía. @param {string} source */
export function titleOf(source) {
  const m = String(source ?? '').match(/^#\s+(.*)$/m)
  return m ? m[1].trim() : ''
}
