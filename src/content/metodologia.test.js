// Pruebas de que el texto de las páginas de metodología y del glosario dice lo mismo que la
// librería calcula. Las páginas se escribieron contra el spec cuando src/lib/finance solo tenía
// ledger.js; cada caso de aquí amarra una afirmación concreta al código que hoy la implementa,
// para que el texto no se vuelva a despegar sin que alguien lo note.
//
// Cada bloque nace de un defecto de la revisión de fase 2 (docs/overhaul/notas/fase2-revisiones.md,
// sección A5) o de una diferencia encontrada al comparar las páginas contra el código.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { glossary } from './glossary.js'
import { MAX_STALE_DAYS, rfSeriesForDates } from '../lib/finance/rates.js'
import { drawdowns, parametricCVaR, parametricVaR } from '../lib/finance/performance.js'

const leer = (nombre) => readFileSync(new URL(`../../docs/metodologia/${nombre}`, import.meta.url), 'utf8')
/** El texto de una página con los saltos de línea colapsados, para buscar frases partidas. */
const plano = (nombre) => leer(nombre).replace(/\s+/g, ' ')
const largoDe = (slug) => glossary[slug].largo.join(' ')
const todoDe = (slug) => {
  const t = glossary[slug]
  return [t.corto, ...t.largo, t.formula, t.comoLeer, t.ejemplo, t.fuente].join(' ')
}
/** 1234.5 → "1,234.50", como escriben las páginas. */
const cifra = (n, decimales = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })

describe('tasa libre de riesgo: el arrastre de hasta 45 días está escrito donde se lee', () => {
  it('la librería de verdad arrastra la tasa hasta MAX_STALE_DAYS y después da null', () => {
    const rf = rfSeriesForDates({ dates: ['2024-01-01'], values: [0.11] }, [
      '2024-01-01',
      '2024-02-15', // 45 días después del dato: todavía vale
      '2024-02-16', // 46 días: ya no
      '2024-02-23',
    ])
    expect(MAX_STALE_DAYS).toBe(45)
    expect(rf?.[1]).not.toBeNull()
    expect(rf?.[2]).toBeNull()
  })

  it('fuentes-de-datos, riesgo y el término del glosario dan el mismo límite que el código', () => {
    const limite = `${MAX_STALE_DAYS} días`
    expect(plano('fuentes-de-datos.md')).toContain(limite)
    expect(plano('riesgo.md')).toContain(limite)
    expect(largoDe('tasa-libre-de-riesgo')).toContain(limite)
  })

  it('no afirma que el arrastre de la tasa quede en meta.notes: lo hace la librería del cliente', () => {
    // meta.notes es del sobre del API v2 y solo el servidor lo llena; rfSeriesForDates devuelve
    // números y null, sin notas. Decir que "las dos" excepciones quedan ahí era falso para la tasa.
    expect(plano('fuentes-de-datos.md')).not.toMatch(/las dos quedan escritas en `meta\.notes`/)
  })
})

describe('valuación DCF: los múltiplos del valor terminal salen de la fórmula de la página', () => {
  const veces = (wacc, g) => (1 + g) / (wacc - g)
  it.each([
    [0.03, veces(0.09, 0.03)],
    [0.07, veces(0.09, 0.07)],
    [0.089, veces(0.09, 0.089)],
  ])('con WACC 9%% y g = %s el texto trae el múltiplo correcto', (_g, esperado) => {
    expect(plano('valuacion-dcf.md')).toContain(`${cifra(esperado)} veces`.replace('.00 veces', ' veces'))
  })
})

describe('riesgo: VaR y CVaR paramétricos', () => {
  it('no usa el calco "acurada" en ninguna página ni en el glosario', () => {
    const paginas = ['riesgo.md', 'simulador.md', 'backtest.md', 'optimizador.md']
    for (const p of paginas) expect(leer(p)).not.toMatch(/acurad/i)
    expect(Object.keys(glossary).map(todoDe).join(' ')).not.toMatch(/acurad/i)
  })

  it('los ejemplos del glosario reproducen con el σ que citan', () => {
    const sigma = 0.059161
    const varPct = (parametricVaR(0.045, sigma, 0.95) ?? NaN) * 100
    const cvarPct = (parametricCVaR(0.045, sigma, 0.95) ?? NaN) * 100
    expect(glossary.var.ejemplo).toContain('σ = 5.9161 por ciento')
    expect(glossary.var.ejemplo).toContain(`${varPct.toFixed(2)} por ciento`)
    expect(glossary.cvar.ejemplo).toContain(`${cvarPct.toFixed(2)} por ciento`)
  })
})

describe('FIBRAs: la retención es la del art. 188, no el 10 por ciento del art. 140', () => {
  it('fibra y rendimiento por distribución dan la tasa del artículo 9', () => {
    for (const slug of ['fibra', 'rendimiento-por-distribucion']) {
      const texto = todoDe(slug)
      expect(texto, slug).toMatch(/30 por ciento/)
      expect(texto, slug).toMatch(/art(í|i)culo 9/)
    }
  })

  it('retención por dividendos aclara que su 10 por ciento no cubre a las FIBRAs', () => {
    expect(largoDe('retencion-por-dividendos')).toMatch(/FIBRA/)
    expect(largoDe('retencion-por-dividendos')).toMatch(/30 por ciento/)
  })

  it('la página de FIBRAs da la tasa en la sección de rendimiento por distribución', () => {
    const seccion = plano('fibras.md').split('## Rendimiento por distribución')[1]?.split('## ')[0] ?? ''
    expect(seccion).toMatch(/30 por ciento/)
    expect(seccion).toMatch(/art(í|i)culo 9/)
  })
})

describe('backtest: la caída máxima se escribe con el máximo que incluye t', () => {
  it('la librería da −33.33 por ciento en el caso conocido', () => {
    const dd = drawdowns([100, 120, 90, 110, 80, 130])
    expect(dd?.maxDrawdown).toBeCloseTo(-1 / 3, 10)
    expect([dd?.peakIndex, dd?.troughIndex, dd?.recoveryIndex]).toEqual([1, 4, 5])
  })

  it('la tabla no escribe "máximo hasta t − 1", que se lee como un máximo que excluye a t', () => {
    const texto = plano('backtest.md')
    expect(texto).not.toMatch(/máximo hasta t − 1/)
    expect(texto).toContain('máx(V_0..V_t)')
  })
})
