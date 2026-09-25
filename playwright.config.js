// Proyectos desktop (1440x900) y mobile (390x844) de la app, sobre `vite build --mode e2e` +
// `vite preview`, con el API en http://api.test (.env.e2e), que siempre se mockea
// (e2e/support/mockApi.js). `npm run e2e`. Con varios agentes a la vez, cada uno usa su puerto:
// `E2E_PORT=5301 npx playwright test e2e/portfolio.spec.js`.
import { defineConfig } from '@playwright/test'
import { COMMON_CONTEXT, DESKTOP, MOBILE } from './e2e/support/viewports.js'

const APP_PORT = Number(process.env.E2E_PORT ?? 5291)
const appURL = `http://127.0.0.1:${APP_PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 15_000,
  retries: 0,
  workers: 2,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...COMMON_CONTEXT, ...DESKTOP, baseURL: appURL } },
    { name: 'mobile', use: { ...COMMON_CONTEXT, ...MOBILE, baseURL: appURL } },
  ],
  webServer: {
    command: `npm run build:e2e && npx vite preview --outDir dist-e2e --port ${APP_PORT} --strictPort --host 127.0.0.1`,
    url: appURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
