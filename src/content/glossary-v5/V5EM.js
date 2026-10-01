// Términos del glosario de V5EM (empresas: factor de actualización, UMA, costo de capital, Z de Altman, cobertura de intereses).
// Mismo esquema que TERMS de src/content/glossary.js (sin `slug`: la llave es el slug) y las mismas
// reglas: español de México, sin guiones largos, sin lenguaje de recomendación, con fuente y con
// `relacionados` que existan. glossary.js une este objeto con los demás y falla si un slug se repite.

/** @type {{ [slug: string]: import('../glossary.js').GlossaryTermInput }} */
const TERMS = {}

export default TERMS
