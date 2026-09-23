// Pruebas del glosario. Tres cosas se revisan aquí: que la forma de cada término sea la que el
// spec pide, que el texto cumpla las reglas de la casa (sin guiones largos, sin lenguaje de
// recomendación) y que el buscador encuentre sin acentos ni mayúsculas.
//
// Ojo con los guiones: este archivo no escribe los caracteres prohibidos, ni siquiera como
// ejemplo. La expresión regular se arma con String.fromCodePoint, para que un grep de guiones
// sobre src/content siga saliendo vacío.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  getTerm,
  glossary,
  glossaryCount,
  glossaryHref,
  glossarySearch,
  glossarySlugs,
  glossaryTerms,
  glossaryTip,
  hasTerm,
  relatedTerms,
  slugify,
} from './glossary.js'

/** Los términos que el spec de A5 enumera uno por uno. Ninguno se puede caer sin avisar. */
const TERMINOS_DEL_SPEC = [
  'rendimiento-simple', 'rendimiento-logaritmico', 'cagr', 'volatilidad', 'sharpe', 'sortino',
  'drawdown-maximo', 'calmar', 'var', 'cvar', 'beta', 'beta-ajustada', 'alfa-jensen',
  'tracking-error', 'information-ratio', 'treynor', 'correlacion', 'covarianza', 'ledoit-wolf',
  'frontera-eficiente', 'minima-varianza', 'portafolio-tangente', 'paridad-de-riesgo',
  'walk-forward', 'sobreajuste', 'monte-carlo', 'lognormal', 'interes-compuesto', 'real-vs-nominal',
  'twr', 'xirr', 'costo-promedio', 'efecto-precio-efecto-fx', 'isr-ganancia-de-capital',
  'retencion-por-dividendos', 'cetes', 'tasa-objetivo', 'tiie', 'udi', 'inpc', 'bono-m',
  'curva-de-rendimientos', 'spread-10a-2a', 'vix', 'dxy', 'p-u', 'p-vl', 'ev-ebitda', 'fcf-yield',
  'earnings-yield', 'roe', 'roic', 'margen-operativo', 'deuda-capital', 'formula-magica',
  'momentum-12-1', 'factor-valor', 'factor-calidad', 'baja-volatilidad', 'fibra', 'ffo-affo',
  'cap-rate', 'nav-p-nav', 'ltv', 'rendimiento-por-distribucion', 'dcf', 'wacc', 'capm',
  'prima-de-riesgo-de-mercado', 'riesgo-pais', 'crecimiento-terminal', 'multiplos', 'sic', 'bmv',
  'diversificacion', 'rebalanceo', 'horizonte-de-inversion', 'perfil-de-riesgo',
]

/** Guion de cifra (U+2012), en (U+2013), em (U+2014) y barra horizontal (U+2015). */
const GUIONES_PROHIBIDOS = new RegExp(`[${String.fromCodePoint(0x2012)}-${String.fromCodePoint(0x2015)}]`)

/** Lenguaje de recomendación: no va en ninguna pantalla de Kaizen. */
const LENGUAJE_DE_RECOMENDACION = [
  /\bBUY\b/i,
  /\bSELL\b/i,
  /\bte recomendamos\b/i,
  /\brecomendaci[oó]n de (compra|venta)\b/i,
  /\bse[nñ]al de (compra|venta)\b/i,
  /\bdeber[ií]as (comprar|vender|invertir)\b/i,
  /\bconviene comprar\b/i,
  /\bprecio objetivo de\b/i,
]

const CAMPOS_DE_TEXTO = ['titulo', 'corto', 'formula', 'comoLeer', 'ejemplo', 'fuente']

/** Todo el texto visible de un término, en una sola cadena. */
const textoDe = (term) => [...CAMPOS_DE_TEXTO.map((c) => term[c]), ...term.largo, ...(term.alias ?? [])].join('\n')

describe('cobertura del glosario', () => {
  it('tiene al menos 60 términos', () => {
    expect(glossaryCount).toBeGreaterThanOrEqual(60)
    expect(glossarySlugs).toHaveLength(glossaryCount)
    expect(glossaryTerms).toHaveLength(glossaryCount)
  })

  it('incluye todos los términos que enumera el spec', () => {
    const faltantes = TERMINOS_DEL_SPEC.filter((slug) => !(slug in glossary))
    expect(faltantes).toEqual([])
  })

  it('el rendimiento por dividendo de acciones es distinto del de distribución de FIBRAs', () => {
    const dividendo = glossary['rendimiento-por-dividendo']
    expect(dividendo).toBeDefined()
    expect(dividendo.titulo).toBe('Rendimiento por dividendo')
    expect(dividendo.fuente).toContain('art. 140')
    expect(glossary['rendimiento-por-distribucion'].fuente).toContain('art. 188')
    expect(dividendo.relacionados).toContain('rendimiento-por-distribucion')
    expect(glossarySearch('dividend yield')[0].slug).toBe('rendimiento-por-dividendo')
  })

  it('no repite slugs y los ordena por título en glossaryTerms', () => {
    expect(new Set(glossarySlugs).size).toBe(glossarySlugs.length)
    const titulos = glossaryTerms.map((t) => t.titulo)
    const ordenados = [...titulos].sort((a, b) => a.localeCompare(b, 'es-MX'))
    expect(titulos).toEqual(ordenados)
  })
})

describe('forma de cada término', () => {
  it.each(Object.keys(glossary))('%s cumple el esquema', (slug) => {
    const term = glossary[slug]
    expect(term.slug).toBe(slug)
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)

    for (const campo of CAMPOS_DE_TEXTO) {
      expect(typeof term[campo], `${slug}.${campo}`).toBe('string')
      expect(term[campo].trim(), `${slug}.${campo}`).not.toBe('')
    }

    expect(term.corto.length, `${slug}.corto`).toBeLessThanOrEqual(160)
    expect(term.titulo.length).toBeLessThanOrEqual(60)
    expect(term.fuente.length, `${slug}.fuente`).toBeGreaterThanOrEqual(10)

    expect(Array.isArray(term.largo)).toBe(true)
    expect(term.largo.length, `${slug}.largo`).toBeGreaterThanOrEqual(2)
    expect(term.largo.length, `${slug}.largo`).toBeLessThanOrEqual(4)
    for (const parrafo of term.largo) {
      expect(typeof parrafo).toBe('string')
      expect(parrafo.trim().length, `${slug}.largo`).toBeGreaterThan(60)
      expect(parrafo.length, `${slug}.largo`).toBeLessThanOrEqual(600)
    }

    expect(Array.isArray(term.relacionados)).toBe(true)
    expect(term.relacionados.length, `${slug}.relacionados`).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(term.alias ?? [])).toBe(true)
  })

  it('congela el glosario y sus listas, para que nadie lo mute por accidente', () => {
    expect(Object.isFrozen(glossary)).toBe(true)
    expect(Object.isFrozen(glossary.sharpe)).toBe(true)
    expect(Object.isFrozen(glossary.sharpe.relacionados)).toBe(true)
    expect(() => {
      glossary.sharpe.titulo = 'otro'
    }).toThrow()
  })
})

describe('integridad de relacionados', () => {
  it('todos los relacionados apuntan a un slug que existe', () => {
    const rotos = []
    for (const term of glossaryTerms) {
      for (const destino of term.relacionados) {
        if (!(destino in glossary)) rotos.push(`${term.slug} apunta a ${destino}`)
      }
    }
    expect(rotos).toEqual([])
  })

  it('ninguno se relaciona consigo mismo ni repite destinos', () => {
    const problemas = []
    for (const term of glossaryTerms) {
      if (term.relacionados.includes(term.slug)) problemas.push(`${term.slug} se apunta a sí mismo`)
      if (new Set(term.relacionados).size !== term.relacionados.length) problemas.push(`${term.slug} repite un destino`)
    }
    expect(problemas).toEqual([])
  })

  it('ningún término queda aislado: todos aparecen en los relacionados de alguien más', () => {
    const citados = new Set(glossaryTerms.flatMap((t) => [...t.relacionados]))
    const huerfanos = glossarySlugs.filter((slug) => !citados.has(slug))
    expect(huerfanos).toEqual([])
  })

  it('relatedTerms devuelve objetos completos y una lista vacía si no existe', () => {
    const relacionados = relatedTerms('sharpe')
    expect(relacionados.length).toBe(glossary.sharpe.relacionados.length)
    expect(relacionados.map((t) => t.slug)).toEqual([...glossary.sharpe.relacionados])
    expect(relatedTerms('no-existe-este-termino')).toEqual([])
  })

  it('los alias no chocan entre sí ni con un slug de otro término', () => {
    const vistos = new Map()
    const choques = []
    for (const term of glossaryTerms) {
      for (const alias of term.alias ?? []) {
        const clave = alias.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
        if (vistos.has(clave)) choques.push(`${clave}: ${vistos.get(clave)} y ${term.slug}`)
        else vistos.set(clave, term.slug)
        const otro = glossary[clave]
        if (otro && otro.slug !== term.slug) choques.push(`alias ${clave} de ${term.slug} es slug de ${otro.slug}`)
      }
    }
    expect(choques).toEqual([])
  })
})

describe('reglas de estilo de la casa', () => {
  it('no hay guiones em ni en en ningún campo', () => {
    const conGuion = glossaryTerms.filter((term) => GUIONES_PROHIBIDOS.test(textoDe(term))).map((t) => t.slug)
    expect(conGuion).toEqual([])
  })

  it('tampoco hay guiones em ni en en el archivo fuente, ni en comentarios', () => {
    for (const archivo of ['./glossary.js', './glossary-lazy.js']) {
      const fuente = readFileSync(new URL(archivo, import.meta.url), 'utf8')
      const linea = fuente.split('\n').findIndex((l) => GUIONES_PROHIBIDOS.test(l))
      expect(`${archivo}:${linea}`).toBe(`${archivo}:-1`)
    }
  })

  it('no usa lenguaje de recomendación', () => {
    const problemas = []
    for (const term of glossaryTerms) {
      const texto = textoDe(term)
      for (const patron of LENGUAJE_DE_RECOMENDACION) {
        if (patron.test(texto)) problemas.push(`${term.slug}: ${patron}`)
      }
    }
    expect(problemas).toEqual([])
  })

  it('el dato faltante se escribe s/d y el signo menos es U+2212', () => {
    const conMenosAscii = glossaryTerms.filter((term) => / -\d/.test(textoDe(term))).map((t) => t.slug)
    expect(conMenosAscii).toEqual([])
    expect(glossary['dato-de-respaldo'].largo.join(' ')).toContain('s/d')
  })
})

describe('páginas de metodología', () => {
  const PAGINAS = [
    'README.md', 'portafolio.md', 'riesgo.md', 'optimizador.md', 'backtest.md', 'simulador.md',
    'screener-de-factores.md', 'formula-magica.md', 'fibras.md', 'valuacion-dcf.md',
    'fuentes-de-datos.md',
  ]
  const leer = (nombre) => readFileSync(new URL(`../../docs/metodologia/${nombre}`, import.meta.url), 'utf8')

  it.each(PAGINAS)('docs/metodologia/%s existe, tiene título y el aviso de que no es recomendación', (nombre) => {
    const texto = leer(nombre)
    expect(texto.startsWith('# ')).toBe(true)
    expect(GUIONES_PROHIBIDOS.test(texto)).toBe(false)
    // El aviso está redactado distinto en cada página, así que se revisa el sentido y no la letra:
    // tiene que aparecer "recomendación de inversión" con una negación pegada.
    const plano = texto.replace(/\s+/g, ' ')
    const avisos = [...plano.matchAll(/.{0,90}recomendaci[oó]n de inversi[oó]n/gi)].map((m) => m[0])
    expect(avisos.length, `${nombre} no menciona el aviso`).toBeGreaterThan(0)
    expect(avisos.some((a) => /\b(no|nada|ni|nunca)\b/i.test(a)), `${nombre}: ${avisos[0]}`).toBe(true)
  })

  it('los términos que citan las páginas existen en el glosario', () => {
    const rotos = []
    for (const nombre of PAGINAS) {
      const seccion = leer(nombre).split('## Términos relacionados en el glosario')[1]
      if (!seccion) continue
      for (const token of seccion.split(/[\s,.]+/)) {
        if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(token)) continue
        if (token.endsWith('-md') || !(token in glossary)) rotos.push(`${nombre}: ${token}`)
      }
    }
    expect(rotos).toEqual([])
  })
})

describe('slugify', () => {
  it('normaliza acentos, mayúsculas y separadores', () => {
    expect(slugify('Sharpe')).toBe('sharpe')
    expect(slugify('Fórmula mágica')).toBe('formula-magica')
    expect(slugify('P/U')).toBe('p-u')
    expect(slugify('  EV/EBITDA  ')).toBe('ev-ebitda')
    expect(slugify('')).toBe('')
  })

  it('deja los slugs del glosario intactos, que es lo que hace estables las URL', () => {
    for (const slug of glossarySlugs) expect(slugify(slug)).toBe(slug)
  })
})

describe('getTerm', () => {
  it('encuentra por slug exacto', () => {
    expect(getTerm('sharpe').titulo).toBe('Razón de Sharpe')
  })

  it('es tolerante con mayúsculas, acentos y separadores', () => {
    expect(getTerm('SHARPE').slug).toBe('sharpe')
    expect(getTerm('P/U').slug).toBe('p-u')
    expect(getTerm('Fórmula mágica').slug).toBe('formula-magica')
  })

  it('cae a los alias cuando el slug no existe', () => {
    expect(getTerm('desviación estándar').slug).toBe('volatilidad')
    expect(getTerm('expected shortfall').slug).toBe('cvar')
    expect(getTerm('USD/MXN').slug).toBe('tipo-de-cambio-fix')
  })

  it('devuelve null y no truena con entradas inválidas', () => {
    expect(getTerm('no-existe')).toBeNull()
    expect(getTerm('')).toBeNull()
    expect(getTerm(null)).toBeNull()
    expect(getTerm(undefined)).toBeNull()
    expect(hasTerm('sharpe')).toBe(true)
    expect(hasTerm('no-existe')).toBe(false)
  })
})

describe('glossarySearch', () => {
  it('no distingue mayúsculas ni acentos', () => {
    expect(glossarySearch('SHARPE')[0].slug).toBe('sharpe')
    expect(glossarySearch('sharpe')[0].slug).toBe('sharpe')
    expect(glossarySearch('formula magica')[0].slug).toBe('formula-magica')
    expect(glossarySearch('FÓRMULA MÁGICA')[0].slug).toBe('formula-magica')
    expect(glossarySearch('valuacion')[0]).toBeDefined()
  })

  it('pone primero el término cuyo título coincide, no el que solo lo menciona', () => {
    expect(glossarySearch('volatilidad')[0].slug).toBe('volatilidad')
    expect(glossarySearch('beta')[0].slug).toBe('beta')
    expect(glossarySearch('cetes')[0].slug).toBe('cetes')
    expect(glossarySearch('drawdown')[0].slug).toBe('drawdown-maximo')
  })

  it('encuentra por alias', () => {
    expect(glossarySearch('value at risk')[0].slug).toBe('var')
    expect(glossarySearch('risk parity')[0].slug).toBe('paridad-de-riesgo')
    expect(glossarySearch('inflación')[0].slug).toBe('inpc')
  })

  it('exige que aparezcan todas las palabras de la consulta', () => {
    const resultados = glossarySearch('riesgo pais')
    expect(resultados[0].slug).toBe('riesgo-pais')
    expect(glossarySearch('sharpe fibra')).toEqual([])
  })

  it('respeta el límite y devuelve vacío con consulta vacía o basura', () => {
    expect(glossarySearch('a', { limit: 3 }).length).toBeLessThanOrEqual(3)
    expect(glossarySearch('')).toEqual([])
    expect(glossarySearch('   ')).toEqual([])
    expect(glossarySearch(null)).toEqual([])
    expect(glossarySearch('zzzqqq')).toEqual([])
  })

  it('también busca dentro del cuerpo, no solo en el título', () => {
    const resultados = glossarySearch('greenblatt')
    expect(resultados.map((t) => t.slug)).toContain('formula-magica')
  })
})

describe('ligas y tarjetas para la interfaz', () => {
  it('glossaryHref apunta a /aprender', () => {
    expect(glossaryHref('sharpe')).toBe('/aprender/sharpe')
    expect(glossaryHref('P/U')).toBe('/aprender/p-u')
  })

  it('glossaryTip trae lo que cabe en un InfoTip', () => {
    const tip = glossaryTip('sharpe')
    expect(tip).toEqual({
      slug: 'sharpe',
      titulo: 'Razón de Sharpe',
      corto: glossary.sharpe.corto,
      href: '/aprender/sharpe',
    })
    expect(tip.corto.length).toBeLessThanOrEqual(160)
  })

  it('glossaryTip devuelve null cuando el término no existe, para que el componente use su texto', () => {
    expect(glossaryTip('metrica-que-no-existe')).toBeNull()
  })
})
