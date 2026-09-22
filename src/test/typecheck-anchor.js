// Ancla de `npm run typecheck`: tsc falla con TS18003 si el include de jsconfig.check.json no
// encuentra archivos, y hoy src/lib/ todavía no existe. Este archivo le da al menos una
// entrada y de paso comprueba que checkJs sí está activo (el JSDoc de abajo se verifica).

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function suma(a, b) {
  return a + b
}

/** @type {number} */
export const tres = suma(1, 2)

// Los tipos de vite/client están cargados: import.meta.env se puede usar en src/lib.
export const modo = import.meta.env.MODE
