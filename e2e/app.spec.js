// Esqueleto de la app nueva sobre el build de e2e (VITE_API_URL=http://api.test): rutas
// privadas, login, sesión en el shell, página no encontrada, avisos del servidor y
// accesibilidad. Corre en los proyectos desktop (1440x900) y mobile (390x844).
//
// Toda prueba usa la fixture `guards`: cualquier console.error, excepción, request fallido o
// respuesta >= 400 la tumba. Los errores provocados a propósito (401, 429) se permiten de forma
// explícita y con motivo.
import AxeBuilder from '@axe-core/playwright'
import { test as plainTest } from '@playwright/test'
import { test as base, expect } from './support/guards.js'
import { attachGuards } from './support/guards.js'
import { SESSION_KEY } from './support/auth.js'
import { expectedHttpError, loginResponse, setupApp } from './support/app.js'

const test = base
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** Espera a que la ruta termine de montar dentro del shell: su h1 visible. */
async function appSettled(page) {
  await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible()
}

test.describe('rutas privadas', () => {
  test('sin sesión, /portafolio manda a /login?next=/portafolio', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL })
    await page.goto('/portafolio')
    await expect(page).toHaveURL(/\/login\?next=%2Fportafolio$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Entra a Kaizen' })).toBeVisible()
    await expect(page).toHaveTitle('Iniciar sesión · Kaizen')
  })

  test('la raíz sin sesión manda a /login sin next', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL })
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('login', () => {
  test('200: guarda la sesión y entra a ?next', async ({ page, baseURL }) => {
    // La compuerta de las rutas v1 solo acepta el token que devuelve el login.
    const api = await setupApp(page, {
      baseURL,
      routes: { 'POST /auth/login': { json: loginResponse() } },
    })
    await page.goto('/portafolio')
    await expect(page).toHaveURL(/\/login\?next=%2Fportafolio$/)
    await page.getByLabel('Usuario').fill('ana')
    await page.getByLabel('Contraseña', { exact: true }).fill('s3creta')
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page).toHaveURL(/\/portafolio$/)
    await appSettled(page)
    expect(api.calls).toContain('POST /auth/login')
    const stored = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) ?? 'null'), SESSION_KEY)
    expect(stored).toMatchObject({ token: 'jwt.e2e', user: { username: 'ana', displayName: 'Ana López' } })
    api.assertAllMatched()
  })

  test('manda usuario y contraseña tal cual en el cuerpo', async ({ page, baseURL }) => {
    let body = null
    await setupApp(page, {
      baseURL,
      routes: {
        'POST /auth/login': (ctx) => {
          body = ctx.body
          return { json: loginResponse() }
        },
      },
    })
    await page.goto('/login')
    await page.getByLabel('Usuario').fill('  ana  ')
    await page.getByLabel('Contraseña', { exact: true }).fill(' con espacios ')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/mercados$/)
    await appSettled(page)
    expect(body).toEqual({ username: 'ana', password: ' con espacios ' })
  })

  // Sin la fixture automática: estas dos pruebas adjuntan sus guardas con permisos explícitos.
  plainTest('401: "Usuario o contraseña incorrectos"', async ({ page, baseURL }) => {
    const guards = attachGuards(page, { allow: expectedHttpError(401, 'POST', '/auth/login', 'la prueba manda credenciales malas a propósito') })
    await setupApp(page, {
      baseURL,
      routes: { 'POST /auth/login': { status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Credenciales inválidas.' } } } },
    })
    await page.goto('/login')
    await page.getByLabel('Usuario').fill('ana')
    await page.getByLabel('Contraseña', { exact: true }).fill('mal')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos.')
    await expect(page).toHaveURL(/\/login$/)
    expect(await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY)).toBeNull()
    guards.assertClean()
    expect(guards.allowed.map((p) => p.kind).sort()).toEqual(['console.error', 'http'])
  })

  plainTest('429: pide esperar el tiempo de Retry-After', async ({ page, baseURL }) => {
    const guards = attachGuards(page, { allow: expectedHttpError(429, 'POST', '/auth/login', 'la prueba simula el límite de intentos') })
    await setupApp(page, {
      baseURL,
      routes: {
        'POST /auth/login': {
          status: 429,
          // Sin Access-Control-Expose-Headers el navegador no deja leer Retry-After desde otro
          // origen: el API real tiene que mandarlo (B1).
          headers: { 'retry-after': '120', 'access-control-expose-headers': 'Retry-After' },
          json: { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos.' } },
        },
      },
    })
    await page.goto('/login')
    await page.getByLabel('Usuario').fill('ana')
    await page.getByLabel('Contraseña', { exact: true }).fill('x')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('alert')).toHaveText('Demasiados intentos. Espera 2 minutos e intenta de nuevo.')
    guards.assertClean()
  })

  test('campos vacíos: pide llenarlos sin llamar al API', async ({ page, baseURL }) => {
    const api = await setupApp(page, { baseURL })
    await page.goto('/login')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('alert')).toHaveText('Escribe tu usuario y tu contraseña.')
    expect(api.calls.filter((c) => c.startsWith('POST'))).toEqual([])
  })

  test('mostrar y ocultar la contraseña', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL })
    await page.goto('/login')
    const field = page.getByLabel('Contraseña', { exact: true })
    await expect(field).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Mostrar contraseña' }).click()
    await expect(field).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: 'Ocultar contraseña' }).click()
    await expect(field).toHaveAttribute('type', 'password')
  })

  test('con sesión, /login lleva directo a ?next', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL, session: true })
    await page.goto('/login?next=%2Faprender')
    await expect(page).toHaveURL(/\/aprender$/)
    await appSettled(page)
  })

  test('?next externo se ignora (sin redirección abierta)', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL, session: true })
    await page.goto('/login?next=%2F%2Fevil.example%2Fx')
    await expect(page).toHaveURL(/\/mercados$/)
    await appSettled(page)
  })

  // Tres maneras de armar un ?next que el parser de URL convierte en "//otro-sitio": caracteres
  // de control (borra tab y saltos de línea), diagonal invertida (la trata como "/") y segmentos
  // de punto (normaliza "/..//example.com" al pathname "//example.com" sin cambiar el origen).
  // Sin filtrarlos, React Router se niega a navegar ("External navigation is not allowed") y el
  // login cae en la pantalla de error.
  for (const next of [
    '%2F%09%2Fexample.com',
    '%2F%0A%2Fexample.com',
    '%2F%5Cexample.com',
    '%2F%250D%2Fexample.com',
    '%2F..%2F%2Fexample.com',
    '%2F%252e%252e%2F%2Fexample.com',
    '%2Fa%2F..%2F..%2F%2Fexample.com',
  ]) {
    test(`?next=${next} (destino de otro sitio disfrazado) cae en /mercados sin pantalla de error`, async ({ page, baseURL }) => {
      await setupApp(page, { baseURL, session: true })
      await page.goto(`/login?next=${next}`)
      await expect(page).toHaveURL(/\/mercados$/)
      await appSettled(page)
      await expect(page.getByText('Algo salió mal')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1, name: 'Mercados' })).toBeVisible()
    })
  }
})

test.describe('sesión en el shell', () => {
  test('la raíz con sesión redirige a /mercados', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL, session: true })
    await page.goto('/')
    await expect(page).toHaveURL(/\/mercados$/)
    await appSettled(page)
    await expect(page).toHaveTitle('Mercados · Kaizen')
  })

  test('cerrar sesión desde el shell vuelve a /login', async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'En móvil se sale desde la hoja "Más" (e2e/shell.spec.js).')
    await setupApp(page, { baseURL, session: true, fixClock: true })
    await page.goto('/mercados')
    await appSettled(page)
    // addInitScript volvería a sembrar la sesión al recargar; aquí la navegación es del lado del cliente.
    await page.getByRole('button', { name: /^Cuenta de / }).click()
    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('status').filter({ hasText: 'Cerraste tu sesión.' })).toBeVisible()
    expect(await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY)).toBeNull()
  })
})

test.describe('avisos del servidor', () => {
  test('servidor viejo: aviso "Servidor sin actualizar" que se puede cerrar', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL, health: 'legacy', session: true })
    await page.goto('/portafolio/riesgo')
    await expect(page.getByRole('heading', { level: 1, name: 'Riesgo' })).toBeVisible()
    await expect(page.getByText('Servidor sin actualizar')).toBeVisible()
    await page.getByRole('button', { name: 'Cerrar' }).click()
    await expect(page.getByText('Servidor sin actualizar')).toHaveCount(0)
  })

  test('servidor dormido: "Despertando el servidor…" sin bloquear la página', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL, health: 'v2', healthDelayMs: 4_500 })
    await page.goto('/login')
    // La página se puede usar mientras tanto.
    await page.getByLabel('Usuario').fill('ana')
    await expect(page.getByRole('status').filter({ hasText: 'Despertando el servidor…' })).toBeVisible({ timeout: 4_000 })
    await expect(page.getByLabel('Usuario')).toHaveValue('ana')
    await expect(page.getByText('Despertando el servidor…')).toHaveCount(0, { timeout: 5_000 })
  })
})

test.describe('página no encontrada', () => {
  test('ruta desconocida muestra NotFound (sin sesión)', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL })
    await page.goto('/esto-no-existe')
    await expect(page.getByRole('heading', { level: 1, name: 'No encontramos esta página' })).toBeVisible()
    await expect(page.getByText('/esto-no-existe')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ir a iniciar sesión' })).toHaveAttribute('href', '/login')
    await expect(page).toHaveTitle('Página no encontrada · Kaizen')
  })

  test('con sesión ofrece ir a Mercados', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL, session: true })
    await page.goto('/investigar/AAPL/de-mas')
    await expect(page.getByRole('heading', { level: 1, name: 'No encontramos esta página' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ir a Mercados' })).toHaveAttribute('href', '/mercados')
  })
})

test.describe('accesibilidad (WCAG 2.1 AA)', () => {
  test('/login sin violaciones', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL })
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })

  test('/login con error visible sin violaciones', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL })
    await page.goto('/login')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })

  test('NotFound sin violaciones', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL })
    await page.goto('/no-existe')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
})
