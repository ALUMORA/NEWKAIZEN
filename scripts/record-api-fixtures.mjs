#!/usr/bin/env node
// Fixtures del API para e2e/app.spec.js (npm run fixtures:api). No usa la red: deriva un HAR a
// partir del que grabó el baseline del legado (e2e/fixtures/legacy/legacy-desktop.har) para que
// la app nueva, compilada con VITE_API_URL=http://api.test, pueda mostrar la app legada dentro de
// LegacyPage con las mismas respuestas v1:
//
// - cambia el origen http://127.0.0.1:8002 por http://api.test;
// - quita las entradas de Google Fonts (la app ya sirve sus fuentes) y las de /health, que cada
//   prueba mockea con mockApi para elegir entre API v2, legado o servidor dormido;
// - deja una sola respuesta por URL (StrictMode pide todo dos veces y el replay sirve la primera).
//
// Variables: API_FIXTURE_ORIGIN (http://api.test).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = `${ROOT}e2e/fixtures/legacy/legacy-desktop.har`
const OUT_DIR = `${ROOT}e2e/fixtures/app/`
const OUT = `${OUT_DIR}legacy-api.har`
const FROM = 'http://127.0.0.1:8002'
const TO = (process.env.API_FIXTURE_ORIGIN ?? 'http://api.test').replace(/\/$/, '')

const har = JSON.parse(readFileSync(SOURCE, 'utf8'))
const seen = new Set()
const entries = []
for (const entry of har.log.entries) {
  const url = entry.request.url
  if (!url.startsWith(`${FROM}/`)) continue
  const path = url.slice(FROM.length)
  if (path === '/health' || path.startsWith('/health?')) continue
  const key = `${entry.request.method} ${path}`
  if (seen.has(key)) continue
  seen.add(key)
  const copy = structuredClone(entry)
  copy.request.url = `${TO}${path}`
  copy.request.headers = (copy.request.headers ?? []).filter((h) => !/^(origin|referer|host)$/i.test(h.name))
  // El replay responde a un origen distinto (127.0.0.1:<puerto>): CORS abierto como el backend viejo.
  const headers = (copy.response.headers ?? []).filter((h) => !/^access-control-allow-origin$/i.test(h.name))
  headers.push({ name: 'Access-Control-Allow-Origin', value: '*' })
  copy.response.headers = headers
  entries.push(copy)
}

mkdirSync(OUT_DIR, { recursive: true })
const out = { log: { ...har.log, pages: [], entries } }
writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`)
console.log(`✓ ${entries.length} respuestas del API viejo en ${OUT.slice(ROOT.length)} (origen ${TO})`)
for (const e of entries) console.log(`  ${e.request.method} ${e.request.url.slice(TO.length)}  ${e.response.status}`)
