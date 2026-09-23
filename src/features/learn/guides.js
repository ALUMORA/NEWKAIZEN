// Guías de metodología: los .md de docs/metodologia, cargados como texto y cada uno en su chunk.
const files = import.meta.glob('../../../docs/metodologia/*.md', { query: '?raw', import: 'default' })

/** slug → cargador del texto. README es el índice y no se lista como guía. */
export const GUIDES = Object.fromEntries(
  Object.entries(files)
    .map(([path, load]) => [path.split('/').pop().replace(/\.md$/, ''), load])
    .filter(([slug]) => slug !== 'README'),
)

/** Nombres cortos para la lista de /aprender (el título largo sale del propio archivo). */
export const GUIDE_NAMES = {
  backtest: 'Backtest',
  fibras: 'FIBRAs',
  'formula-magica': 'Fórmula mágica',
  'fuentes-de-datos': 'Fuentes de datos',
  optimizador: 'Optimizador',
  portafolio: 'Portafolio',
  riesgo: 'Riesgo',
  'screener-de-factores': 'Screener de factores',
  simulador: 'Simulador',
  'valuacion-dcf': 'Valuación DCF',
}

/** El título (# ...) de una guía. @param {string} source */
export function titleOf(source) {
  const m = String(source ?? '').match(/^#\s+(.*)$/m)
  return m ? m[1].trim() : ''
}
