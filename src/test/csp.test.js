// La CSP de vercel.json contra lo que el build de Vite realmente produce (revisión SEC de fase 4).
//
// font-src 'self' no deja cargar fuentes data:, pero Vite incrusta como data: todo recurso de menos
// de 4 KB, y los subconjuntos cirílico-ext de Plus Jakarta Sans y JetBrains Mono pesan entre 2.5 y
// 3.2 KB: el build los metía en el CSS como data:font/woff2 y el navegador los bloqueaba con un
// error de CSP en consola en cuanto una página mostraba uno de esos caracteres (por ejemplo ₴).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import viteConfig from '../../vite.config.js'

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))

function csp() {
  for (const block of vercel.headers ?? []) {
    const header = (block.headers ?? []).find((h) => h.key.toLowerCase() === 'content-security-policy')
    if (header) return header.value
  }
  return ''
}

function directive(name) {
  const part = csp()
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name} `))
  return part ? part.split(/\s+/).slice(1) : []
}

describe('CSP de vercel.json contra el build', () => {
  it('ninguna fuente se incrusta como data: si font-src no lo permite', () => {
    if (directive('font-src').includes('data:')) return
    const limit = viteConfig.build?.assetsInlineLimit
    expect(typeof limit).toBe('function')
    for (const file of ['/x/jetbrains-mono-cyrillic-ext-wght-normal.woff2', '/x/a.woff', '/x/a.ttf', '/x/a.otf']) {
      expect(limit(file, new Uint8Array(100))).toBe(false)
    }
    // Lo demás conserva el comportamiento por omisión de Vite (undefined = decide Vite).
    expect(limit('/x/logo.svg', new Uint8Array(100))).toBeUndefined()
  })

  it('no hay scripts en línea permitidos ni orígenes de más', () => {
    expect(directive('script-src')).toEqual(["'self'"])
    expect(directive('frame-ancestors')).toEqual(["'none'"])
    expect(directive('connect-src')).toEqual(["'self'", 'https://*.onrender.com'])
  })
})
