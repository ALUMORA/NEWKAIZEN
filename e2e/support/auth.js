// Sesión sembrada para specs de la app nueva. PROVISIONAL: S2 define la forma final de la
// sesión en src/lib/auth/; aquí solo se fija la llave y un valor de ejemplo.
//
//   await seedSession(page)                       // sesión por defecto
//   await seedSession(page, { token: 'x', ... })  // forma propia
//
// Se escribe con addInitScript, o sea antes de que corra cualquier script de la página y en
// cada navegación del mismo `page`.

export const SESSION_KEY = 'kaizen.session'

export const DEFAULT_SESSION = Object.freeze({
  token: 'e2e-token',
  user: { id: 'e2e-user', email: 'e2e@kaizen.test', name: 'Usuario E2E' },
  expiresAt: '2099-01-01T00:00:00.000Z',
})

/**
 * @param {import('@playwright/test').Page} page
 * @param {unknown} [session]
 */
export async function seedSession(page, session = DEFAULT_SESSION) {
  await page.addInitScript(
    ([key, value]) => {
      window.sessionStorage.setItem(key, value)
    },
    [SESSION_KEY, JSON.stringify(session)],
  )
}

/** Borra la sesión en cada navegación (útil para probar la pantalla de login). */
export async function clearSession(page) {
  await page.addInitScript((key) => {
    window.sessionStorage.removeItem(key)
  }, SESSION_KEY)
}
