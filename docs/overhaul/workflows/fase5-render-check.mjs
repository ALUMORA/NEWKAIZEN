// Recorrido real de rutas de NEWKAIZEN sobre la página renderizada (fase 5).
// Se corre DESDE el worktree (usa su node_modules) y contra un frontend y un backend levantados:
//
//   cd "<worktree>" && node <scratchpad>/render-check.mjs --base http://127.0.0.1:5340 \
//     --out <carpeta> [--themes dark,light] [--setup ejemplo] /mercados/tasas /investigar/AAPL
//
// Por ruta, viewport (1440x900 y 390x844) y tema: siembra una sesión de prueba en sessionStorage,
// abre la ruta, espera a que la red se calme, y mide errores de consola, requests fallidos (>=400 o
// requestfailed), scroll horizontal, CLS acumulado y violaciones de axe (WCAG 2.1 AA). Guarda una
// captura de página completa por combinación y escribe resumen.json. Sale con 1 si algo falla.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(path.join(process.cwd(), 'package.json'))
const { chromium } = require('@playwright/test')
const AxeBuilder = require('@axe-core/playwright').default

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return def
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}
const BASE = opt('base', 'http://127.0.0.1:5173').replace(/\/$/, '')
const OUT = opt('out', path.join(process.cwd(), 'render-check'))
const THEMES = opt('themes', 'dark,light').split(',')
const SETUP = opt('setup', '')
const WAIT_MS = Number(opt('wait', '1500'))
const routes = argv.filter((a) => a.startsWith('/'))
if (!routes.length) {
  console.error('Uso: node render-check.mjs --base URL --out DIR /ruta [/otra]')
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]
const SESSION = JSON.stringify({ token: 'rc-token', expiresAt: '2099-01-01T00:00:00.000Z', user: { username: 'rc', displayName: 'Recorrido' } })

const browser = await chromium.launch()
const results = []
let failed = false
try {
  for (const theme of THEMES) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: theme === 'dark' ? 'dark' : 'light' })
      await context.addInitScript(([s, t]) => {
        try {
          sessionStorage.setItem('kaizen.session', s)
          localStorage.setItem('kaizen_theme', t)
        } catch {}
      }, [SESSION, theme])
      await context.addInitScript(() => {
        // CLS acumulado de la página, sin las entradas con input reciente.
        globalThis.__cls = 0
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) if (!e.hadRecentInput) globalThis.__cls += e.value
          }).observe({ type: 'layout-shift', buffered: true })
        } catch {}
      })
      if (SETUP === 'ejemplo') {
        const p = await context.newPage()
        await p.goto(BASE + '/bienvenida', { waitUntil: 'networkidle' }).catch(() => {})
        const b = p.getByRole('button', { name: 'Usar el ejemplo' })
        if (await b.count()) await b.first().click()
        await p.waitForTimeout(800)
        await p.close()
      }
      for (const route of routes) {
        const page = await context.newPage()
        const consoleErrors = []
        const badRequests = []
        page.on('console', (m) => {
          if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
        })
        page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 300)))
        page.on('requestfailed', (r) => {
          const why = r.failure()?.errorText ?? ''
          if (!/ERR_ABORTED/.test(why)) badRequests.push(`${r.method()} ${r.url()} ${why}`)
        })
        page.on('response', (r) => {
          if (r.status() >= 400) badRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`)
        })
        let navError = null
        try {
          await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45_000 })
        } catch (e) {
          navError = String(e).slice(0, 200)
        }
        await page.waitForTimeout(WAIT_MS)
        const layout = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: globalThis.innerWidth,
          h1: document.querySelector('h1')?.textContent?.trim() ?? null,
          title: document.title,
          cls: globalThis.__cls ?? null,
          dataTheme: document.documentElement.getAttribute('data-theme'),
        }))
        let axe = []
        try {
          const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
          axe = r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') }))
        } catch (e) {
          axe = [{ id: 'axe-error', impact: 'n/a', nodes: 0, sample: String(e).slice(0, 200) }]
        }
        const slug = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'raiz'
        const shot = path.join(OUT, `${slug}-${vp.name}-${theme}.png`)
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
        const hScroll = layout.scrollWidth > layout.innerWidth
        const ok = !navError && !consoleErrors.length && !badRequests.length && !hScroll && !axe.length && (layout.cls ?? 0) < 0.1
        if (!ok) failed = true
        results.push({ route, viewport: vp.name, theme, ok, navError, h1: layout.h1, title: layout.title, dataTheme: layout.dataTheme, hScroll, scrollWidth: layout.scrollWidth, cls: Number((layout.cls ?? 0).toFixed(4)), consoleErrors, badRequests: [...new Set(badRequests)], axe, shot })
        await page.close()
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
}
writeFileSync(path.join(OUT, 'resumen.json'), JSON.stringify(results, null, 1))
for (const r of results) {
  const issues = [
    r.navError && `nav: ${r.navError}`,
    r.consoleErrors.length && `consola: ${r.consoleErrors.length}`,
    r.badRequests.length && `requests: ${r.badRequests.slice(0, 3).join(' | ')}`,
    r.hScroll && `scroll horizontal ${r.scrollWidth}px`,
    r.axe.length && `axe: ${r.axe.map((a) => `${a.id}(${a.nodes})`).join(', ')}`,
    r.cls >= 0.1 && `CLS ${r.cls}`,
  ].filter(Boolean)
  console.log(`${r.ok ? 'OK ' : 'MAL'} ${r.route} ${r.viewport} ${r.theme} h1="${r.h1}" cls=${r.cls}${issues.length ? '  ' + issues.join('; ') : ''}`)
}
console.log(`resumen: ${path.join(OUT, 'resumen.json')}`)
process.exit(failed ? 1 : 0)
