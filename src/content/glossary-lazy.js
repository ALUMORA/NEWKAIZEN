// Carga diferida del glosario.
//
// src/content/glossary.js son unos 150 KB de texto: si el shell o un InfoTip lo importan de forma
// estática, todo ese texto se va al bundle de la primera ruta y nadie lo va a leer en esa pantalla.
// Este módulo lo carga con import() dinámico, así que Vite lo deja en su propio chunk y solo se
// descarga cuando alguien abre un InfoTip, entra a /aprender o busca un término.
//
// La promesa se guarda, así que el chunk se descarga una sola vez por sesión aunque se pidan
// veinte términos.
//
// Uso típico en un componente:
//
//   const [tip, setTip] = useState(null)
//   useEffect(() => { let vivo = true; loadTip(slug).then((t) => vivo && setTip(t)); return () => { vivo = false } }, [slug])
//
// Si el término no existe, todo esto devuelve null o una lista vacía, nunca truena: el componente
// cae a su propio texto.

/** @typedef {import('./glossary.js').GlossaryTerm} GlossaryTerm */

/** @type {Promise<typeof import('./glossary.js')>|null} */
let pendiente = null

/**
 * Carga el módulo completo del glosario. La primera llamada descarga el chunk; las siguientes
 * reusan la misma promesa.
 * @returns {Promise<typeof import('./glossary.js')>}
 */
export function loadGlossary() {
  if (!pendiente) pendiente = import('./glossary.js')
  return pendiente
}

/**
 * Un término por slug, alias o texto suelto ("P/U", "Sharpe").
 * @param {string} slug
 * @returns {Promise<GlossaryTerm|null>}
 */
export async function loadTerm(slug) {
  const mod = await loadGlossary()
  return mod.getTerm(slug)
}

/**
 * Lo mínimo para pintar un InfoTip: título, una línea y la liga a /aprender.
 * @param {string} slug
 * @returns {Promise<{slug: string, titulo: string, corto: string, href: string}|null>}
 */
export async function loadTip(slug) {
  const mod = await loadGlossary()
  return mod.glossaryTip(slug)
}

/**
 * Búsqueda sin acentos ni mayúsculas, para el ⌘K y para la página de aprender.
 * @param {string} query
 * @param {{limit?: number}} [options]
 * @returns {Promise<GlossaryTerm[]>}
 */
export async function searchGlossary(query, options) {
  const mod = await loadGlossary()
  return mod.glossarySearch(query, options)
}

/**
 * Todos los términos ordenados por título, para el índice de /aprender.
 * @returns {Promise<readonly GlossaryTerm[]>}
 */
export async function loadAllTerms() {
  const mod = await loadGlossary()
  return mod.glossaryTerms
}
