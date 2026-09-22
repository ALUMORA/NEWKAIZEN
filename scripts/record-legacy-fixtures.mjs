#!/usr/bin/env node
// Graba UNA vez el tráfico del API de la app legada para el baseline visual (npm run fixtures:legacy).
//
// Levanta el dev server de Vite (VITE_API_URL=http://127.0.0.1:8002, VITE_SKIP_LOGIN=true),
// abre Chromium en escritorio (1440x900) y en móvil (390x844), recorre las 8 tabs sin apretar
// botones de cálculo y guarda con routeFromHAR({ update: true }) todo lo que la app pidió al
// backend y a Google Fonts en e2e/fixtures/legacy/legacy-<viewport>.har, más la hora de la
// grabación en meta.json (el spec fija el reloj a esa hora al reproducir).
//
// Requiere el backend legado corriendo en http://127.0.0.1:8002 (python backend.py). Solo se usa
// al grabar; el baseline después corre sin red.
//
// Variables: E2E_BASELINE_PORT (5290), RECORD_VIEWPORTS=desktop,mobile, RECORD_HEADED=1.
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  LEGACY_API_ORIGIN,
  LEGACY_FIXTURES_DIR,
  LEGACY_HAR_URL,
  LEGACY_META_PATH,
  LEGACY_TABS,
  legacyHarPath,
  openLegacyTab,
  scrollToTop,
  trackNetwork,
  waitForSettled,
} from '../e2e/support/legacy.js'
import { COMMON_CONTEXT, DESKTOP, MOBILE } from '../e2e/support/viewports.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.E2E_BASELINE_PORT ?? 5290)
const VIEWPORTS = { desktop: DESKTOP, mobile: MOBILE }
const selected = (process.env.RECORD_VIEWPORTS ?? 'desktop,mobile').split(',').map((s) => s.trim()).filter(Boolean)

async function assertBackend() {
  try {
    const res = await fetch(`${LEGACY_API_ORIGIN}/health`, { signal: AbortSignal.timeout(10_000) })
    const body = await res.json()
    if (body?.status !== 'ok') throw new Error(JSON.stringify(body))
  } catch (err) {
    console.error(`✗ El backend legado no responde en ${LEGACY_API_ORIGIN}/health: ${err.message}`)
    console.error('  Levántalo con: .venv/bin/python backend.py')
    process.exit(1)
  }
}

async function record(browser, name, baseURL) {
  const harPath = legacyHarPath(name)
  rmSync(harPath, { force: true })
  const context = await browser.newContext({ ...COMMON_CONTEXT, ...VIEWPORTS[name], baseURL })
  await context.routeFromHAR(harPath, {
    url: LEGACY_HAR_URL,
    update: true,
    updateContent: 'embed',
    updateMode: 'minimal',
  })
  const page = await context.newPage()
  const problems = []
  page.on('console', (m) => m.type() === 'error' && problems.push(`[console.error] ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`[requestfailed] ${r.method()} ${r.url()} ${r.failure()?.errorText}`))
  page.on('response', (r) => r.status() >= 400 && problems.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`))
  const seen = []
  page.on('requestfinished', (r) => LEGACY_HAR_URL.test(r.url()) && seen.push(r.url()))

  // Reloj fijo también al grabar: lo que la app calcule con Date.now() (p. ej. "hace 3 h" en
  // las noticias) queda igual que en el replay, que fija el reloj a esta misma hora.
  const recordedAt = new Date(Math.floor(Date.now() / 1000) * 1000)
  await page.clock.setFixedTime(recordedAt)

  const net = trackNetwork(page)
  const isMobile = Boolean(VIEWPORTS[name].isMobile)
  const t0 = Date.now()
  await page.goto('/')
  // En vivo yfinance tarda: se da margen amplio y más silencio de red que en el replay.
  const live = { quietMs: 2500, timeout: 240_000 }
  for (const tab of LEGACY_TABS) {
    const before = seen.length
    if (tab.id !== 'news') await openLegacyTab(page, tab, isMobile)
    await waitForSettled(page, net, live)
    await scrollToTop(page)
    const extra = seen.slice(before).map((u) => u.replace(LEGACY_API_ORIGIN, '')).filter((u) => !u.startsWith('https://fonts'))
    console.log(`  ${name} · ${tab.slug.padEnd(15)} ${((Date.now() - t0) / 1000).toFixed(1)} s · ${extra.length} req nuevos${extra.length ? `: ${extra.join(' ')}` : ''}`)
  }
  await context.close() // aquí se escribe el HAR
  const har = JSON.parse(readFileSync(harPath, 'utf8'))
  const size = statSync(harPath).size
  console.log(`  ${name} · ${har.log.entries.length} entradas, ${(size / 1024).toFixed(0)} KB → ${harPath.replace(ROOT, '')}`)
  return { recordedAt: recordedAt.toISOString(), problems, entries: har.log.entries.length }
}

async function main() {
  await assertBackend()
  mkdirSync(LEGACY_FIXTURES_DIR, { recursive: true })
  process.env.VITE_API_URL = LEGACY_API_ORIGIN
  process.env.VITE_SKIP_LOGIN = 'true'
  const server = await createServer({
    root: ROOT,
    logLevel: 'warn',
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
  })
  await server.listen()
  const baseURL = `http://127.0.0.1:${PORT}`
  console.log(`Vite dev en ${baseURL} → API ${LEGACY_API_ORIGIN}`)
  const browser = await chromium.launch({ headless: !process.env.RECORD_HEADED })
  const meta = existsSync(LEGACY_META_PATH) ? JSON.parse(readFileSync(LEGACY_META_PATH, 'utf8')) : { recordedAt: {} }
  let failed = false
  try {
    for (const name of selected) {
      if (!VIEWPORTS[name]) throw new Error(`Viewport desconocido: ${name}`)
      const result = await record(browser, name, baseURL)
      meta.recordedAt[name] = result.recordedAt
      if (result.problems.length) {
        failed = true
        console.error(`✗ ${name}: la app registró ${result.problems.length} problema(s) durante la grabación:`)
        for (const p of result.problems) console.error(`    ${p}`)
      }
    }
    meta.api = LEGACY_API_ORIGIN
    meta.note = 'Grabado con npm run fixtures:legacy. El spec e2e/baseline.spec.js fija el reloj a recordedAt[viewport].'
    writeFileSync(LEGACY_META_PATH, `${JSON.stringify(meta, null, 2)}\n`)
  } finally {
    await browser.close()
    await server.close()
  }
  if (failed) {
    console.error('La grabación quedó escrita, pero con errores: revísalos antes de generar el baseline.')
    process.exit(1)
  }
  console.log('✓ Fixtures del legado grabados.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
