// Lighthouse de las rutas con sesión, contra el build local (`vite preview` en 4180) y el backend
// en replay (8002). Siembra una sesión de prueba en sessionStorage antes de cada auditoría, con
// disableStorageReset, porque la CLI de Lighthouse no deja pasar el login. Usa el Lighthouse
// global (npm i -g lighthouse) y Brave, porque en esta Mac no hay Chrome.
//
//   node scripts/lighthouse-sesion.mjs /mercados /investigar/WALMEX.MX
//   LH_DETAIL=1 node scripts/lighthouse-sesion.mjs /mercados   # métricas y quién mueve el layout
import { execSync } from 'node:child_process'

const GLOBAL = execSync('npm root -g').toString().trim()
const { default: puppeteer } = await import(`${GLOBAL}/lighthouse/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js`)
const { default: lighthouse } = await import(`${GLOBAL}/lighthouse/core/index.js`)
const { default: desktopConfig } = await import(`${GLOBAL}/lighthouse/core/config/desktop-config.js`)

const BASE = process.env.LH_BASE ?? 'http://localhost:4180'
const BROWSER = process.env.LH_BROWSER ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const routes = process.argv.slice(2)
if (!routes.length) throw new Error('Uso: node scripts/lighthouse-sesion.mjs /ruta [/otra ...]')
const session = JSON.stringify({ token: 'lh-token', expiresAt: '2099-01-01T00:00:00.000Z', user: { username: 'lh', displayName: 'Auditoría' } })

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: 'new', args: ['--no-first-run'] })
for (const form of ['mobile', 'desktop']) {
  for (const route of routes) {
    const page = await browser.newPage()
    await page.evaluateOnNewDocument((s) => sessionStorage.setItem('kaizen.session', s), session)
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('response', (res) => { if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`) })
    const res = await lighthouse(BASE + route, { disableStorageReset: true, output: 'json', logLevel: 'error' }, form === 'desktop' ? desktopConfig : undefined, page)
    const scores = Object.entries(res.lhr.categories)
      .filter(([k]) => k !== 'agentic-browsing' && k !== 'seo')
      .map(([k, v]) => `${k}=${Math.round(v.score * 100)}`)
      .join(' ')
    console.log(form, route, scores, errors.length ? `ERR: ${[...new Set(errors)].slice(0, 4).join(' | ')}` : '')
    if (process.env.LH_DETAIL) {
      const a = res.lhr.audits
      for (const id of ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift']) console.log('   ', id, a[id]?.displayValue)
      for (const it of (a['layout-shifts']?.details?.items ?? []).slice(0, 5)) console.log('    mueve', it.score?.toFixed?.(3), it.node?.selector)
    }
    await page.close()
  }
}
await browser.close()
