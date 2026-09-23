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
import { drawdowns, parametricCVaR, parametricVaR, summary } from '../lib/finance/performance.js'
import { twr } from '../lib/finance/performance-ledger.js'
import { externalFlows } from '../lib/finance/ledger.js'
import { isrOnGains } from '../lib/finance/tax-mx.js'
import { alignPanel } from '../lib/finance/returns.js'
import { meanVariance, riskParity } from '../lib/finance/optimize.js'
import { jamesStein } from '../lib/finance/expected.js'
import { ledoitWolfConstantCorrelation } from '../lib/finance/covariance.js'
import { lognormalParams, simulate } from '../lib/finance/montecarlo.js'

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

describe('simulador: la página describe el motor que existe', () => {
  it('los parámetros lognormales del ejemplo son los de lognormalParams', () => {
    const p = lognormalParams(0.08, 0.15)
    expect(plano('simulador.md')).toContain(`μ_l = ${p?.mu.toFixed(7)}`)
    expect(plano('simulador.md')).toContain(`σ_l = ${p?.sigma.toFixed(6)}`)
  })

  it('las dos pruebas de sanidad salen de simulate', () => {
    const base = { initial: 100000, contribution: 5000, years: 1, mu: 1.01 ** 12 - 1, sigma: 0, paths: 10 }
    const constante = simulate({ ...base, contributionGrowth: 0 })?.terminal.p50 ?? NaN
    const crece = simulate({ ...base, contributionGrowth: 1.01 ** 12 - 1 })?.terminal.p50 ?? NaN
    expect(plano('simulador.md')).toContain(`Aportación constante: ${cifra(constante)}`)
    expect(plano('simulador.md')).toContain(`1 por ciento al mes: ${cifra(crece)}`)
  })

  it('por omisión la aportación crece con la inflación, y la página no dice que sea opcional', () => {
    const base = { initial: 0, contribution: 1000, years: 2, mu: 0, sigma: 0, paths: 1, inflation: 0.04 }
    const sim = simulate(base)
    expect(sim?.contributedTotal).toBeGreaterThan(24000)
    expect(plano('simulador.md')).not.toMatch(/si eliges indexarlas/)
    expect(plano('simulador.md')).toMatch(/[Pp]or omisión, las aportaciones crecen con la inflación/)
  })

  it('el resumen final lista los campos que simulate devuelve, sin un peor decil que no existe', () => {
    const sim = simulate({ initial: 1000, years: 1, mu: 0.05, sigma: 0.1, paths: 50 })
    expect(Object.keys(sim?.terminal ?? {})).toEqual(['mean', 'sd', 'min', 'max', 'p5', 'p25', 'p50', 'p75', 'p95'])
    expect(plano('simulador.md')).not.toMatch(/peor decil/)
  })

  it('el retiro es un escenario determinista, no una probabilidad de que el capital dure', () => {
    expect(plano('simulador.md')).not.toMatch(/probabilidad de que el capital dure/)
    expect(plano('simulador.md')).toMatch(/determinista/)
  })

  it('el rendimiento ya no se describe como algo sin implementar', () => {
    expect(plano('simulador.md')).not.toMatch(/mientras no esté implementado el motor/)
  })
})

describe('remuestreo por bloques: los bloques son circulares', () => {
  it('con 12 meses de historia y bloques de 6 hay 12 arranques posibles, no 7', () => {
    // Rendimientos distintos por mes para leer de qué mes arrancó cada camino en el primer paso.
    const history = Array.from({ length: 12 }, (_, i) => (i + 1) / 1000)
    const sim = simulate({
      initial: 1, years: 1, method: 'bootstrap', history, blockSize: 6, paths: 2000, samplePaths: 2000, seed: 'bloques',
    })
    const arranques = new Set(sim?.samples.map((camino) => Math.round((camino[1] / camino[0] - 1) * 1000) - 1))
    expect(arranques.size).toBe(history.length)
  })

  it('el glosario cuenta los bloques posibles como la librería los sortea', () => {
    expect(glossary['bootstrap-por-bloques'].ejemplo).toContain('240 bloques posibles')
    expect(plano('simulador.md')).toMatch(/bloques son circulares/)
  })
})

describe('portafolio: TWR, aportación implícita e ISR como los calcula la librería', () => {
  it('el TWR resta el flujo del valor final, y así sale el −1 por ciento del ejemplo', () => {
    const r = twr([100, 160, 144], [0, 50, 0])
    expect(typeof r === 'number' ? r : r?.twr).toBeCloseTo(-0.01, 12)
    expect(glossary.twr.formula).toContain('(V_fin_i − flujo_i) / V_ini_i')
    expect(plano('portafolio.md')).toContain('r_i = (V_i − flujo_i) / V_(i−1) − 1')
    expect(plano('portafolio.md')).not.toMatch(/El flujo se considera al inicio del periodo/)
  })

  it('una compra sin efectivo suficiente se financia por el faltante, no por el costo', () => {
    const flujos = externalFlows([
      { id: 'd', type: 'deposit', amount: 600, currency: 'MXN', date: '2026-01-01' },
      { id: 'b', type: 'buy', symbol: 'X', quantity: 10, price: 100, currency: 'MXN', date: '2026-01-02' },
    ])
    expect(flujos.filter((f) => f.kind === 'funding').map((f) => f.amount)).toEqual([400])
    expect(plano('portafolio.md')).toMatch(/por el faltante, no por el costo completo/)
  })

  it('el ISR amortiza pérdidas de ejercicios anteriores antes de aplicar el 10 por ciento', () => {
    const r = isrOnGains({
      sales: [
        { saleDate: '2025-06-01', proceeds: 100, cost: 200, factor: 1 },
        { saleDate: '2026-06-01', proceeds: 300, cost: 100, factor: 1 },
      ],
    })
    expect(r?.years.find((y) => y.year === '2026')?.tax).toBeCloseTo(10, 12)
    expect(glossary['isr-ganancia-de-capital'].formula).toMatch(/pérdidas pendientes/)
    expect(plano('portafolio.md')).toMatch(/resta las pérdidas pendientes de ejercicios anteriores/)
  })

  it('el rebalanceo documenta la mejora por pares que la librería sí hace', () => {
    expect(plano('portafolio.md')).toMatch(/Mejora por pares/)
    expect(glossary.rebalanceo.formula).toMatch(/por pares/)
  })
})

describe('optimizador: problemas y parámetros como los resuelve optimize.js', () => {
  const cov = [[0.04, 0], [0, 0.09]]

  it('media varianza minimiza ½ wᵀCw − τ wᵀμ: con τ = 0.5 da pesos iguales', () => {
    const r = meanVariance([0.1, 0.15], cov, 0.5)
    expect(r?.weights[0]).toBeCloseTo(0.5, 6)
    expect(plano('optimizador.md')).toContain('min ½·wᵀCw − τ·wᵀμ')
    expect(plano('optimizador.md')).not.toMatch(/nivel de aversión/)
  })

  it('la paridad de riesgo no acepta caja, y la página no dice que sí', () => {
    const r = riskParity(cov, /** @type {any} */ ({ u: 0.5 }))
    expect(r?.weights[0]).toBeCloseTo(0.6, 8)
    expect(plano('optimizador.md')).toMatch(/La paridad de riesgo no acepta caja/)
  })

  it('el panel reporta activos descartados, no días', () => {
    const panel = alignPanel({
      A: { dates: ['2024-01-01', '2024-01-02', '2024-01-03'], values: [1, 2, 3] },
      B: { dates: ['2024-01-01', '2024-01-03'], values: [1, 2] },
    })
    expect(panel?.dates).toEqual(['2024-01-01', '2024-01-03'])
    expect(panel?.dropped).toEqual([])
    expect(plano('optimizador.md')).not.toMatch(/la lista de días descartados se reporta/)
  })

  it('James y Stein contrae hacia la cartera de mínima varianza por omisión', () => {
    const r = jamesStein([0.01, 0.02], [[0.04, 0], [0, 0.01]], 60)
    // μ₀ = (1ᵀΣ⁻¹μ)/(1ᵀΣ⁻¹1) = (0.25 + 2) / (25 + 100) · 100 = .018, no el promedio .015
    expect(r?.target).toBeCloseTo((0.01 / 0.04 + 0.02 / 0.01) / (1 / 0.04 + 1 / 0.01), 12)
    expect(plano('optimizador.md')).toMatch(/cartera de mínima varianza/)
    expect(plano('optimizador.md')).not.toMatch(/hacia el promedio general/)
  })

  it('el delta de Ledoit y Wolf del glosario es el del panel de prueba', () => {
    const golden = JSON.parse(readFileSync(new URL('../../tests/golden/covariance.json', import.meta.url), 'utf8'))
    const caso = golden.cases.find((c) => c.name.startsWith('panel fijo 60x5'))
    const delta = ledoitWolfConstantCorrelation(caso.input.returns)?.shrinkage ?? NaN
    expect(glossary['ledoit-wolf'].ejemplo).toContain(`delta sale ${delta.toFixed(2)}`)
  })

  it('el walk forward usa ventana móvil de 156 periodos por omisión', () => {
    expect(glossary['walk-forward'].formula).toContain('los últimos 156 periodos')
    expect(plano('optimizador.md')).toMatch(/Es móvil/)
  })
})

describe('riesgo y backtest: lo que la librería supone y lo que no', () => {
  it('riesgo.md ya no dice que no hay ningún 52 escondido: walkForward lo supone', () => {
    expect(plano('riesgo.md')).not.toMatch(/No hay ningún 52 escondido/)
    expect(plano('riesgo.md')).toMatch(/toma 52 si no se le indica otro/)
  })

  it('el resumen del backtest trae VaR y CVaR históricos, sin paramétrico', () => {
    const s = summary([0.01, -0.02, 0.03, 0.0, -0.01, 0.02], { k: 52 })
    expect(Object.keys(s ?? {})).toContain('var95')
    expect(Object.keys(s ?? {}).some((k) => /param/i.test(k))).toBe(false)
    expect(plano('backtest.md')).not.toMatch(/Histórico y paramétrico, los dos etiquetados/)
  })
})

// Las páginas de valuación, factores, fórmula mágica y FIBRAs describen al backend en Python
// (kaizen_api), que vitest no ejecuta. Estas guardas solo impiden que regresen afirmaciones que
// se comprobaron falsas contra ese código; la línea exacta está al lado de cada una.
describe('páginas del backend: afirmaciones que el código de kaizen_api contradice', () => {
  it.each([
    // dcf.py:27: la guarda recorta el crecimiento terminal y la valuación sigue saliendo
    ['valuacion-dcf.md', /la pantalla no deja salir de ellas/],
    // service.py:26 DEFAULT_LAMBDA = 1.0 y el router no acepta λ
    ['valuacion-dcf.md', /y ese campo es editable/],
    // multiples.py:315: no hay rendimiento por dividendo en el bloque de múltiplos
    ['valuacion-dcf.md', /rendimiento por dividendo, cada uno/],
    // magic.py:379: lugares de competencia 1-2-2-4, no promedio
    ['formula-magica.md', /comparten la posición promedio/],
    // factors.py:328: la cobertura saca a la emisora, no al factor
    ['screener-de-factores.md', /ese factor se excluye del puntaje total/],
    // factors.py:95: los criterios de cumple o no cumple son fijos
    ['screener-de-factores.md', /criterios que tú configuras/],
    // fibras.py:231: el flujo no se llama FFO y no hay AFFO
    ['fibras.md', /La pantalla muestra la razón distribución sobre AFFO/],
    ['README.md', /FFO y AFFO de verdad/],
  ])('%s no dice %s', (pagina, patron) => {
    expect(plano(pagina)).not.toMatch(patron)
  })
})
