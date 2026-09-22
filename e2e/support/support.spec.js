// Autoprueba de los helpers de e2e/support (guardas, mockApi, sesión, reloj). No necesita el
// servidor de la app: sirve HTML propio en http://app.test con page.route. Corre dentro de la
// familia "app" (npm run e2e), en desktop y mobile.
import { test as base, expect } from '@playwright/test'
import { attachGuards, test as guardedTest } from './guards.js'
import { mockApi, blockExternalRequests } from './mockApi.js'
import { seedSession, SESSION_KEY, DEFAULT_SESSION } from './auth.js'
import { fixTime } from './clock.js'

const APP = 'http://app.test'
async function serveApp(page, html) {
  await page.route(`${APP}/**`, (r) => r.fulfill({ contentType: 'text/html', body: html }))
}

base('guardas: detectan console.error, pageerror, 404 y requestfailed', async ({ page }) => {
  const guards = attachGuards(page)
  await blockExternalRequests(page, [APP])
  await serveApp(page, `<script>
    console.error('boom');
    fetch('/missing');
    fetch('https://example.com/x').catch(() => {});
    setTimeout(() => { throw new Error('kaput') }, 0);
  </script>`)
  await page.route(`${APP}/missing`, (r) => r.fulfill({ status: 404, body: 'no' }))
  await page.goto(`${APP}/`)
  await page.waitForTimeout(500)
  const kinds = guards.problems.map((p) => p.kind).sort()
  expect(kinds).toContain('console.error')
  expect(kinds).toContain('pageerror')
  expect(kinds).toContain('http')
  expect(kinds).toContain('requestfailed')
  expect(() => guards.assertClean()).toThrow(/La página no quedó limpia/)
})

base('guardas: allow con motivo mueve el problema a allowed', async ({ page }) => {
  const guards = attachGuards(page, { allow: [{ kind: 'console.error', match: /tercero/, reason: 'prueba' }] })
  await serveApp(page, `<script>console.error('error de tercero')</script>`)
  await page.goto(`${APP}/`)
  await page.waitForTimeout(200)
  guards.assertClean()
  expect(guards.allowed).toHaveLength(1)
})

base('mockApi: rutas, params, query, POST con preflight y 501 ruidoso', async ({ page }) => {
  const guards = attachGuards(page)
  await serveApp(page, '<p>ok</p>')
  const api = await mockApi(page, {
    'GET /health': { json: { status: 'ok' } },
    'GET /quotes/:symbol': ({ params }) => ({ json: { symbol: params.symbol } }),
    'GET /search?q=walmex': { json: { hits: 1 } },
    'POST /auth/login': ({ body }) => ({ status: body.password === 'x' ? 200 : 401, json: { ok: body.password === 'x' } }),
  })
  await page.goto(`${APP}/`)
  const out = await page.evaluate(async () => {
    const j = (r) => r.json()
    return {
      health: await fetch('http://api.test/health').then(j),
      quote: await fetch('http://api.test/quotes/WALMEX.MX').then(j),
      search: await fetch('http://api.test/search?q=walmex').then(j),
      login: await fetch('http://api.test/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify({ password: 'x' }), credentials: 'include' }).then((r) => r.status),
      missing: await fetch('http://api.test/nope').then((r) => r.status),
    }
  })
  expect(out).toEqual({ health: { status: 'ok' }, quote: { symbol: 'WALMEX.MX' }, search: { hits: 1 }, login: 200, missing: 501 })
  expect(api.unmatched).toEqual(['GET /nope'])
  expect(() => api.assertAllMatched()).toThrow(/sin mock/)
  expect(guards.problems.map((p) => p.text)).toContain('501 GET http://api.test/nope')
  api.on('GET /nope', { json: { late: true } })
  expect(await page.evaluate(() => fetch('http://api.test/nope').then((r) => r.json()))).toEqual({ late: true })
})

base('seedSession y fixTime', async ({ page }) => {
  await seedSession(page)
  await fixTime(page, '2026-09-22T14:42:55.000Z')
  await serveApp(page, '<p>ok</p>')
  await page.goto(`${APP}/`)
  const got = await page.evaluate((k) => [sessionStorage.getItem(k), new Date().toISOString(), Date.now()], SESSION_KEY)
  expect(JSON.parse(got[0])).toEqual(DEFAULT_SESSION)
  expect(got[1]).toBe('2026-09-22T14:42:55.000Z')
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => Date.now())).toBe(got[2])
})

// La fixture automática vigila `page` sin llamarla: aquí se comprueba que capturó el error y se
// limpia con reset() para que su assertClean() del final pase. Sin el reset la prueba fallaría.
guardedTest('guardas: la fixture automática vigila la página', async ({ page, guards }) => {
  await serveApp(page, `<script>console.error('ups')</script>`)
  await page.goto(`${APP}/`)
  await expect.poll(() => guards.problems.length).toBe(1)
  expect(guards.problems[0]).toMatchObject({ kind: 'console.error' })
  guards.reset()
})
