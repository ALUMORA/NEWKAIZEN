// Esqueleto de la app nueva sobre el build de e2e (VITE_API_URL=http://api.test): rutas
// privadas, login, app legada dentro de LegacyPage, página no encontrada, avisos del servidor y
// accesibilidad. Corre en los proyectos desktop (1440x900) y mobile (390x844).
//
// Toda prueba usa la fixture `guards`: cualquier console.error, excepción, request fallido o
// respuesta >= 400 la tumba. Los errores provocados a propósito (401, 429) se permiten de forma
// explícita y con motivo.
import AxeBuilder from '@axe-core/playwright'
import { test as plainTest } from '@playwright/test'
import { test as base, expect } from './support/guards.js'
import { attachGuards } from './support/guards.js'
import { DEFAULT_SESSION, SESSION_KEY } from './support/auth.js'
import { API_URL_RE, expectedHttpError, loginResponse, setupApp } from './support/app.js'
import { trackNetwork, waitForSettled } from './support/legacy.js'

const test = base
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * Cambia de sección como la persona: la barra lateral del shell (C3) en escritorio y la paleta de
 * comandos en móvil (la barra inferior solo trae cuatro secciones). El legado ya no trae su barra.
 * @param {import('@playwright/test').Page} page
 * @param {string} name nombre de la entrada en src/app/nav.js
 * @param {boolean} mobile
 */
async function goToSection(page, name, mobile) {
  if (!mobile) {
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name, exact: true }).click()
    return
  }
  await page.getByRole('button', { name: 'Buscar emisora o función' }).click()
  await page.getByRole('combobox', { name: 'Buscar emisora o función' }).fill(name)
  await expect(page.getByRole('option').first()).toHaveText(new RegExp(`^${name}`))
  await page.keyboard.press('Enter')
}

/** El h1 de la tab del legado (solo para lector de pantalla cuando va dentro del shell). */
const legacyHeading = (page, name) => page.getByRole('heading', { level: 1, name, exact: true })

/** Espera a que la app legada termine de cargar (shell montado, red quieta, sin spinners). */
async function legacySettled(page, net) {
  await expect(page.locator('.app-shell')).toBeVisible()
  await waitForSettled(page, net)
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
  test('200: guarda la sesión y entra a ?next con la app legada', async ({ page, baseURL }) => {
    // La compuerta de las rutas v1 solo acepta el token que devuelve el login.
    const api = await setupApp(page, {
      baseURL,
      legacyApi: true,
      legacyAuth: loginResponse().token,
      routes: { 'POST /auth/login': { json: loginResponse() } },
    })
    const net = trackNetwork(page, API_URL_RE)
    await page.goto('/portafolio')
    await expect(page).toHaveURL(/\/login\?next=%2Fportafolio$/)
    await page.getByLabel('Usuario').fill('ana')
    await page.getByLabel('Contraseña', { exact: true }).fill('s3creta')
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page).toHaveURL(/\/portafolio$/)
    await legacySettled(page, net)
    await expect(legacyHeading(page, 'Mi portafolio')).toBeAttached()
    expect(api.calls).toContain('POST /auth/login')
    const stored = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) ?? 'null'), SESSION_KEY)
    expect(stored).toMatchObject({ token: 'jwt.e2e', user: { username: 'ana', displayName: 'Ana López' } })
    api.assertAllMatched()
    const gated = api.legacyAuth?.requests ?? []
    expect(gated.length).toBeGreaterThan(0)
    expect(gated.filter((r) => r.authorization !== 'Bearer jwt.e2e')).toEqual([])
  })

  test('manda usuario y contraseña tal cual en el cuerpo', async ({ page, baseURL }) => {
    let body = null
    await setupApp(page, {
      baseURL,
      legacyApi: true,
      legacyAuth: loginResponse().token,
      routes: {
        'POST /auth/login': (ctx) => {
          body = ctx.body
          return { json: loginResponse() }
        },
      },
    })
    const net = trackNetwork(page, API_URL_RE)
    await page.goto('/login')
    await page.getByLabel('Usuario').fill('  ana  ')
    await page.getByLabel('Contraseña', { exact: true }).fill(' con espacios ')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/mercados$/)
    await legacySettled(page, net)
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
    await setupApp(page, { baseURL, session: true, legacyApi: true })
    const net = trackNetwork(page, API_URL_RE)
    await page.goto('/login?next=%2Fscreener')
    await expect(page).toHaveURL(/\/screener$/)
    await legacySettled(page, net)
  })

  test('?next externo se ignora (sin redirección abierta)', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL, session: true, legacyApi: true })
    const net = trackNetwork(page, API_URL_RE)
    await page.goto('/login?next=%2F%2Fevil.example%2Fx')
    await expect(page).toHaveURL(/\/mercados$/)
    await legacySettled(page, net)
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
      await setupApp(page, { baseURL, session: true, legacyApi: true })
      const net = trackNetwork(page, API_URL_RE)
      await page.goto(`/login?next=${next}`)
      await expect(page).toHaveURL(/\/mercados$/)
      await legacySettled(page, net)
      await expect(page.getByText('Algo salió mal')).toHaveCount(0)
      await expect(legacyHeading(page, 'Mercados')).toBeAttached()
    })
  }
})

test.describe('app legada dentro de LegacyPage', () => {
  test('sesión sembrada + API v2: /mercados muestra Noticias del legado', async ({ page, baseURL }) => {
    const api = await setupApp(page, { baseURL, session: true, legacyApi: true })
    /** @type {(string | null)[]} */
    const healthAuth = []
    page.on('request', (req) => {
      if (/^http:\/\/api\.test\/health$/.test(req.url()) && req.method() === 'GET') healthAuth.push(req.headers().authorization ?? null)
    })
    const net = trackNetwork(page, API_URL_RE)
    await page.goto('/mercados')
    await legacySettled(page, net)
    await expect(page).toHaveTitle('Mercados · Kaizen')
    await expect(legacyHeading(page, 'Mercados')).toBeAttached()
    // Datos de las respuestas v1 grabadas: el panorama de mercados y las noticias.
    await expect(page.getByText('Resumen Mañanero').first()).toBeVisible()
    expect(api.calls.filter((c) => c === 'GET /health').length).toBeGreaterThanOrEqual(1)
    api.assertAllMatched()
    // Con authRequired:true el backend v2 exige sesión también en las rutas v1 (setupApp pone la
    // compuerta): el legado solo ve datos porque cada request lleva el token de la sesión.
    const gated = api.legacyAuth?.requests ?? []
    expect(gated.length).toBeGreaterThan(5)
    expect(gated.filter((r) => r.authorization !== `Bearer ${DEFAULT_SESSION.token}`)).toEqual([])
    // /health es pública: ni el sondeo de la app ni la detección del legado mandan el token.
    expect(healthAuth.length).toBeGreaterThanOrEqual(2)
    expect(healthAuth.filter((h) => h !== null)).toEqual([])
  })

  // Dos formas de llegar sin el token que acepta el servidor: uno que ya revocó y una sesión sin
  // token (la de desarrollo). En las dos el legado no llega a mostrar datos: el primer 401 cierra
  // la sesión y RequireAuth manda a /login.
  for (const { label, token, header } of [
    { label: 'token que el servidor ya no acepta', token: 'e2e-token-revocado', header: 'Bearer e2e-token-revocado' },
    { label: 'sesión sin token', token: null, header: null },
  ]) {
    plainTest(`${label}: el 401 del legado cierra la sesión y manda a /login`, async ({ page, baseURL }) => {
      const guards = attachGuards(page, {
        allow: [
          { kind: 'http', match: /^401 GET http:\/\/api\.test\//, reason: 'La compuerta rechaza el request a propósito.' },
          { kind: 'console.error', match: /status of 401\b/, reason: 'Chromium imprime cada 401 provocado como console.error.' },
        ],
      })
      const api = await setupApp(page, {
        baseURL,
        session: { ...DEFAULT_SESSION, token },
        legacyApi: true,
        legacyAuth: DEFAULT_SESSION.token,
      })
      await page.goto('/mercados')
      await expect(page).toHaveURL(/\/login\?next=%2Fmercados$/)
      await expect(page.getByRole('status').filter({ hasText: 'Tu sesión ya no es válida.' })).toBeVisible()
      expect(await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY)).toBeNull()
      await expect(page.getByText('Resumen Mañanero')).toHaveCount(0)
      const gated = api.legacyAuth?.requests ?? []
      expect(gated.length).toBeGreaterThan(0)
      expect(new Set(gated.map((r) => r.authorization))).toEqual(new Set([header]))
      expect(guards.allowed.length).toBeGreaterThan(0)
      guards.assertClean()
    })
  }

  test('servidor viejo (sin sesiones): el legado no manda Authorization', async ({ page, baseURL }) => {
    const api = await setupApp(page, { baseURL, health: 'legacy', session: true, legacyApi: true })
    expect(api.legacyAuth).toBeNull()
    /** @type {(string | null)[]} */
    const sent = []
    page.on('request', (req) => {
      if (API_URL_RE.test(req.url()) && req.method() !== 'OPTIONS') sent.push(req.headers().authorization ?? null)
    })
    const net = trackNetwork(page, API_URL_RE)
    await page.goto('/mercados')
    await legacySettled(page, net)
    await expect(page.getByText('Resumen Mañanero').first()).toBeVisible()
    expect(sent.length).toBeGreaterThan(5)
    expect(sent.filter((h) => h !== null)).toEqual([])
  })

  // La URL sigue a la tab del legado: cambiar de tab navega (push) a la ruta de esa tab, el
  // título cambia, recargar conserva la tab y Atrás regresa. Escritorio usa la barra lateral del
  // shell y móvil la paleta de comandos (goToSection).
  test('cambiar de tab en el legado cambia la URL y el título; recargar la conserva y Atrás regresa', async ({ page, baseURL }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile'
    await setupApp(page, { baseURL, session: true, legacyApi: true })
    const net = trackNetwork(page, API_URL_RE)
    await page.goto('/mercados')
    await legacySettled(page, net)
    await expect(page).toHaveTitle('Mercados · Kaizen')
    const historyBefore = await page.evaluate(() => history.length)

    await goToSection(page, 'Optimizador', mobile)
    await expect(page).toHaveURL(/\/herramientas\/optimizador$/)
    await expect(page).toHaveTitle('Optimizador · Kaizen')
    await expect(legacyHeading(page, 'Optimizador')).toBeAttached()
    await legacySettled(page, net)
    // Una sola entrada nueva en el historial: sin ciclos de navegación.
    expect(await page.evaluate(() => history.length)).toBe(historyBefore + 1)
    await expect(page).toHaveURL(/\/herramientas\/optimizador$/)

    await page.reload()
    await legacySettled(page, net)
    await expect(page).toHaveURL(/\/herramientas\/optimizador$/)
    await expect(page).toHaveTitle('Optimizador · Kaizen')
    await expect(legacyHeading(page, 'Optimizador')).toBeAttached()

    await page.goBack()
    await expect(page).toHaveURL(/\/mercados$/)
    await legacySettled(page, net)
    await expect(page).toHaveTitle('Mercados · Kaizen')
    await expect(legacyHeading(page, 'Mercados')).toBeAttached()
    await expect(page.getByText('Resumen Mañanero').first()).toBeVisible()
  })

  test('Atrás y Adelante dentro de la app mueven la tab del legado sin recargar', async ({ page, baseURL }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile'
    await setupApp(page, { baseURL, session: true, legacyApi: true })
    const net = trackNetwork(page, API_URL_RE)
    await page.goto('/mercados')
    await legacySettled(page, net)
    // Marca en window: si algo recargara la página, se perdería.
    await page.evaluate(() => {
      /** @type {any} */ (window).__sinRecargar = true
    })

    await goToSection(page, 'FIBRAs', mobile)
    await expect(page).toHaveURL(/\/screener\/fibras$/)
    await expect(page).toHaveTitle('FIBRAs · Kaizen')
    await goToSection(page, 'Resumen', mobile)
    await expect(page).toHaveURL(/\/portafolio$/)
    await expect(page).toHaveTitle('Mi portafolio · Kaizen')
    await legacySettled(page, net)

    await page.goBack()
    await expect(page).toHaveURL(/\/screener\/fibras$/)
    await expect(legacyHeading(page, 'FIBRAs')).toBeAttached()
    await page.goBack()
    await expect(page).toHaveURL(/\/mercados$/)
    await expect(legacyHeading(page, 'Mercados')).toBeAttached()
    await page.goForward()
    await expect(page).toHaveURL(/\/screener\/fibras$/)
    await expect(page).toHaveTitle('FIBRAs · Kaizen')
    await legacySettled(page, net)
    expect(await page.evaluate(() => /** @type {any} */ (window).__sinRecargar)).toBe(true)
  })

  test('la raíz con sesión redirige a /mercados', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL, session: true, legacyApi: true })
    const net = trackNetwork(page, API_URL_RE)
    await page.goto('/')
    await expect(page).toHaveURL(/\/mercados$/)
    await legacySettled(page, net)
  })

  test('cerrar sesión desde el shell con el legado montado vuelve a /login', async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'En móvil se sale desde la hoja "Más" (e2e/shell.spec.js).')
    await setupApp(page, { baseURL, session: true, legacyApi: true, fixClock: true })
    const net = trackNetwork(page, API_URL_RE)
    await page.goto('/mercados')
    await legacySettled(page, net)
    // addInitScript volvería a sembrar la sesión al recargar; aquí la navegación es del lado del cliente.
    await page.getByRole('button', { name: /^Cuenta de / }).click()
    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('status').filter({ hasText: 'Cerraste tu sesión.' })).toBeVisible()
    expect(await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY)).toBeNull()
  })
})

test.describe('avisos del servidor', () => {
  test('servidor viejo: aviso "Servidor sin actualizar" en rutas nuevas, no en las del legado', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL, health: 'legacy', session: true, legacyApi: true })
    await page.goto('/portafolio/riesgo')
    await expect(page.getByRole('heading', { level: 1, name: 'Riesgo' })).toBeVisible()
    await expect(page.getByText('Servidor sin actualizar')).toBeVisible()
    await page.getByRole('button', { name: 'Cerrar' }).click()
    await expect(page.getByText('Servidor sin actualizar')).toHaveCount(0)

    const net = trackNetwork(page, API_URL_RE)
    await page.goto('/mercados')
    await legacySettled(page, net)
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

  test('ruta nueva sin feature todavía: "Próximamente"', async ({ page, baseURL }) => {
    await setupApp(page, { baseURL, session: true })
    await page.goto('/investigar/WALMEX.MX')
    await expect(page.getByRole('heading', { level: 1, name: 'Ficha de la emisora' })).toBeVisible()
    await expect(page.getByText('Próximamente')).toBeVisible()
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
