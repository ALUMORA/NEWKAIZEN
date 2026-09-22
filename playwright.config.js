// Dos familias de proyectos:
//
// - baseline-desktop / baseline-mobile: captura visual de la app LEGADA (src/App.jsx) corriendo
//   en el dev server de Vite, con el API servido desde HAR grabados (e2e/fixtures/legacy/).
//   Solo corren e2e/baseline.spec.js. `npm run e2e:baseline`.
// - desktop / mobile: la app nueva, sobre `vite build --mode e2e` + `vite preview`, con el API
//   en http://api.test (.env.e2e), que siempre se mockea (e2e/support/mockApi.js). `npm run e2e`.
//
// Solo se levanta el servidor de la familia elegida. La familia se decide por E2E_SUITE
// (baseline | app | all); si no está, por los --project de la línea de comandos (todos
// baseline-* → baseline) y si no, app. La decisión se escribe en process.env para que los
// workers, que vuelven a cargar este archivo con otro argv, armen la misma lista de proyectos.
import { defineConfig } from '@playwright/test'
import { COMMON_CONTEXT, DESKTOP, MOBILE } from './e2e/support/viewports.js'

const BASELINE_PORT = Number(process.env.E2E_BASELINE_PORT ?? 5290)
const APP_PORT = Number(process.env.E2E_PORT ?? 5291)

function detectSuite(argv) {
  const projects = []
  argv.forEach((arg, i) => {
    if (arg.startsWith('--project=')) projects.push(arg.slice('--project='.length))
    else if (arg === '--project' && argv[i + 1]) projects.push(argv[i + 1])
  })
  const files = argv.filter((a) => /\.spec\.[jt]s/.test(a))
  if (projects.length) {
    const baseline = projects.filter((p) => p.startsWith('baseline'))
    if (baseline.length === projects.length) return 'baseline'
    return baseline.length ? 'all' : 'app'
  }
  if (files.length && files.every((f) => f.includes('baseline'))) return 'baseline'
  return 'app'
}

const SUITE = process.env.E2E_SUITE ?? detectSuite(process.argv)
if (!['baseline', 'app', 'all'].includes(SUITE)) {
  throw new Error(`E2E_SUITE inválido: ${SUITE} (baseline | app | all)`)
}
process.env.E2E_SUITE = SUITE
const withBaseline = SUITE === 'baseline' || SUITE === 'all'
const withApp = SUITE === 'app' || SUITE === 'all'

const baselineURL = `http://127.0.0.1:${BASELINE_PORT}`
const appURL = `http://127.0.0.1:${APP_PORT}`

const baselineProjects = [
  {
    name: 'baseline-desktop',
    testMatch: 'baseline.spec.js',
    use: { ...COMMON_CONTEXT, ...DESKTOP, baseURL: baselineURL },
  },
  {
    name: 'baseline-mobile',
    testMatch: 'baseline.spec.js',
    use: { ...COMMON_CONTEXT, ...MOBILE, baseURL: baselineURL },
  },
]

const appProjects = [
  {
    name: 'desktop',
    testIgnore: 'baseline.spec.js',
    use: { ...COMMON_CONTEXT, ...DESKTOP, baseURL: appURL },
  },
  {
    name: 'mobile',
    testIgnore: 'baseline.spec.js',
    use: { ...COMMON_CONTEXT, ...MOBILE, baseURL: appURL },
  },
]

const webServer = []
if (withBaseline) {
  webServer.push({
    // Dev server de la app legada. Pedir /src/App.jsx como sonda de arranque obliga a Vite a
    // transformar el módulo más pesado antes de la primera prueba.
    command: `npx vite --port ${BASELINE_PORT} --strictPort --host 127.0.0.1`,
    url: `${baselineURL}/src/App.jsx`,
    env: { VITE_API_URL: 'http://127.0.0.1:8002', VITE_SKIP_LOGIN: 'true' },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  })
}
if (withApp) {
  webServer.push({
    command: `npm run build:e2e && npx vite preview --outDir dist-e2e --port ${APP_PORT} --strictPort --host 127.0.0.1`,
    url: appURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  })
}

export default defineConfig({
  testDir: './e2e',
  timeout: 15_000,
  retries: 0,
  workers: 2,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [...(withBaseline ? baselineProjects : []), ...(withApp ? appProjects : [])],
  webServer,
})
