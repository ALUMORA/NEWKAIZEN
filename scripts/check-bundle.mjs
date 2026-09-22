#!/usr/bin/env node
// Presupuesto de peso del bundle inicial (npm run bundle, después de npm run build).
//
// Lee dist/index.html y toma lo que el navegador descarga en la primera carga: el <script
// type="module"> de entrada, los <link rel="modulepreload"> y las hojas de estilo. Comprime
// cada archivo con gzip (zlib, nivel por defecto, como el reporte de Vite) y falla si el JS
// inicial comprimido pasa de BUNDLE_BUDGET_KB (180 por defecto; kB = 1000 bytes, igual que Vite).
// Los chunks que solo se cargan con import() dinámico se listan aparte y no cuentan.
//
// Variables: BUNDLE_BUDGET_KB (180), BUNDLE_DIST (dist).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = path.resolve(ROOT, process.env.BUNDLE_DIST ?? 'dist')
const BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB ?? 180)

if (!Number.isFinite(BUDGET_KB) || BUDGET_KB <= 0) {
  console.error(`✗ BUNDLE_BUDGET_KB inválido: ${process.env.BUNDLE_BUDGET_KB}`)
  process.exit(2)
}
const indexPath = path.join(DIST, 'index.html')
if (!existsSync(indexPath)) {
  console.error(`✗ No existe ${indexPath}. Corre primero npm run build.`)
  process.exit(2)
}

const html = readFileSync(indexPath, 'utf8')

// Atributos de una etiqueta, sin depender del orden ni del tipo de comillas.
function attrs(tag) {
  const out = {}
  for (const m of tag.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

const initial = [] // { kind, href }
for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
  const a = attrs(m[0].slice(7, -1))
  if (a.src && a.type === 'module') initial.push({ kind: 'entry', href: a.src })
}
for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
  const a = attrs(m[0].slice(5, -1))
  const rel = (a.rel ?? '').toLowerCase().split(/\s+/)
  if (!a.href) continue
  if (rel.includes('modulepreload')) initial.push({ kind: 'preload', href: a.href })
  else if (rel.includes('stylesheet')) initial.push({ kind: 'css', href: a.href })
}

if (!initial.some((f) => f.kind === 'entry')) {
  console.error('✗ dist/index.html no tiene <script type="module" src>: ¿el build salió vacío?')
  process.exit(1)
}

const isExternal = (href) => /^(https?:)?\/\//.test(href)
const toFile = (href) => path.join(DIST, decodeURIComponent(href.split(/[?#]/)[0]).replace(/^\//, ''))
const kb = (bytes) => (bytes / 1000).toFixed(2).padStart(9)

function measure(file) {
  const raw = readFileSync(file)
  return { raw: raw.length, gz: gzipSync(raw).length }
}

const rows = []
const seen = new Set()
for (const f of initial) {
  if (isExternal(f.href)) {
    console.error(`✗ Recurso externo en index.html (${f.href}): no se puede medir, el bundle inicial debe ser propio.`)
    process.exit(1)
  }
  const file = toFile(f.href)
  if (seen.has(file)) continue
  seen.add(file)
  if (!existsSync(file)) {
    console.error(`✗ index.html apunta a ${f.href} pero ${file} no existe.`)
    process.exit(1)
  }
  rows.push({ ...f, file, ...measure(file) })
}

// JS que no está en el HTML: chunks diferidos (import dinámico). Informativo.
const lazy = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.m?js$/.test(name) && !seen.has(p)) lazy.push({ file: p, ...measure(p) })
  }
}
walk(DIST)

const rel = (p) => path.relative(path.dirname(DIST), p)
console.log(`Bundle inicial (${rel(indexPath)})`.padEnd(52) + '     bytes     gzip kB')
for (const r of rows) {
  console.log(`  ${r.kind.padEnd(8)} ${rel(r.file).padEnd(40)} ${String(r.raw).padStart(9)}  ${kb(r.gz)}`)
}
const jsGz = rows.filter((r) => r.kind !== 'css').reduce((s, r) => s + r.gz, 0)
const cssGz = rows.filter((r) => r.kind === 'css').reduce((s, r) => s + r.gz, 0)
if (lazy.length) {
  console.log('Chunks diferidos (no cuentan para el presupuesto)')
  for (const r of lazy) console.log(`  lazy     ${rel(r.file).padEnd(40)} ${String(r.raw).padStart(9)}  ${kb(r.gz)}`)
}
console.log(`JS inicial gzip:  ${kb(jsGz).trim()} kB (presupuesto ${BUDGET_KB} kB)`)
console.log(`CSS inicial gzip: ${kb(cssGz).trim()} kB`)
if (lazy.length) console.log(`JS diferido gzip: ${kb(lazy.reduce((s, r) => s + r.gz, 0)).trim()} kB`)

if (jsGz > BUDGET_KB * 1000) {
  console.error(`✗ El JS inicial pesa ${kb(jsGz).trim()} kB gzip y pasa el presupuesto de ${BUDGET_KB} kB por ${kb(jsGz - BUDGET_KB * 1000).trim()} kB.`)
  process.exit(1)
}
console.log(`✓ Dentro del presupuesto (${((jsGz / (BUDGET_KB * 1000)) * 100).toFixed(0)} % usado).`)
