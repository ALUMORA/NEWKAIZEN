// Sesión sembrada para specs de la app nueva. La forma es la de src/lib/auth/session.js:
//   { token, expiresAt (ISO), user: { username, displayName } }
// y la llave "kaizen.session" de sessionStorage.
//
//   await seedSession(page)                       // sesión por defecto
//   await seedSession(page, { ...DEFAULT_SESSION, expiresAt: '2026-09-22T15:00:00Z' })
//
// Se escribe con addInitScript, o sea antes de que corra cualquier script de la página y en
// cada navegación del mismo `page`.

export const SESSION_KEY = 'kaizen.session'

export const DEFAULT_SESSION = Object.freeze({
  token: 'e2e-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: Object.freeze({ username: 'e2e', displayName: 'Usuario E2E' }),
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
