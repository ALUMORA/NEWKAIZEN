// Términos del glosario de V5TC (gráfica técnica: media móvil, RSI, MACD, Bollinger).
// Mismo esquema que TERMS de src/content/glossary.js (sin `slug`: la llave es el slug) y las mismas
// reglas: español de México, sin guiones largos, sin lenguaje de recomendación, con fuente y con
// `relacionados` que existan. glossary.js une este objeto con los demás y falla si un slug se repite.

/** @type {{ [slug: string]: import('../glossary.js').GlossaryTermInput }} */
const TERMS = {}

export default TERMS
