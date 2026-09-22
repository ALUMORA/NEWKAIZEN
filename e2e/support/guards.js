// Guardas de salud para specs de Playwright. Cualquier console.error, excepción sin atrapar
// (pageerror), request fallido (requestfailed) o respuesta con status >= 400 es un defecto
// bloqueante: la prueba falla y el mensaje los lista todos.
//
// Uso directo:
//   const guards = attachGuards(page)        // antes de page.goto
//   ...
//   guards.assertClean()                      // al final de la prueba
//
// Uso con fixture automática (recomendado en specs nuevos):
//   import { test, expect } from './support/guards.js'
//   test('algo', async ({ page, guards }) => { ... })   // assertClean corre solo al terminar
//
// Si un error viene de un tercero y no se puede arreglar, se permite de forma explícita con
// `allow` y un motivo, nunca bajándole el volumen a la guarda:
//   attachGuards(page, { allow: [{ kind: 'console.error', match: /algo/, reason: '...' }] })
import { test as base, expect } from '@playwright/test'

/**
 * @typedef {'console.error' | 'pageerror' | 'requestfailed' | 'http'} ProblemKind
 * @typedef {{ kind: ProblemKind, text: string }} Problem
 * @typedef {{ kind?: ProblemKind, match: RegExp | string, reason: string }} Allowance
 */

function matches(pattern, text) {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ allow?: Allowance[] }} [options]
 */
export function attachGuards(page, { allow = [] } = {}) {
  /** @type {Problem[]} */
  const problems = []
  /** @type {Problem[]} */
  const allowed = []

  const push = (kind, text) => {
    const rule = allow.find((a) => (!a.kind || a.kind === kind) && matches(a.match, text))
    ;(rule ? allowed : problems).push({ kind, text })
  }

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const loc = msg.location()
    const where = loc?.url ? ` (${loc.url}:${loc.lineNumber})` : ''
    push('console.error', `${msg.text()}${where}`)
  })
  page.on('pageerror', (err) => push('pageerror', err.stack || err.message))
  page.on('requestfailed', (req) => {
    push('requestfailed', `${req.method()} ${req.url()} :: ${req.failure()?.errorText ?? 'desconocido'}`)
  })
  page.on('response', (res) => {
    if (res.status() >= 400) push('http', `${res.status()} ${res.request().method()} ${res.url()}`)
  })

  return {
    problems,
    allowed,
    /** Vacía lo acumulado, p. ej. después de un paso que provoca errores a propósito. */
    reset() {
      problems.length = 0
      allowed.length = 0
    },
    /** Falla la prueba si se acumuló cualquier problema, listándolos. */
    assertClean() {
      const detail = problems.map((p, i) => `  ${i + 1}. [${p.kind}] ${p.text}`).join('\n')
      expect(problems.length, `La página no quedó limpia:\n${detail}\n`).toBe(0)
    },
  }
}

/** `test` con la fixture automática `guards`: toda prueba que use `page` queda vigilada. */
export const test = base.extend({
  guards: [
    async ({ page }, use) => {
      const guards = attachGuards(page)
      await use(guards)
      guards.assertClean()
    },
    { auto: true },
  ],
})

export { expect }
