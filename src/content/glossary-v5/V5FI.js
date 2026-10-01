// Términos del glosario de V5FI (ficha: sorpresa de resultados, tenencia institucional, 8-K, 10-K, 10-Q, 20-F, 6-K).
// Mismo esquema que TERMS de src/content/glossary.js (sin `slug`: la llave es el slug) y las mismas
// reglas: español de México, sin guiones largos, sin lenguaje de recomendación, con fuente y con
// `relacionados` que existan. glossary.js une este objeto con los demás y falla si un slug se repite.

/** @type {{ [slug: string]: import('../glossary.js').GlossaryTermInput }} */
const TERMS = {}

export default TERMS
