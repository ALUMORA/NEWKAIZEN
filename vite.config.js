import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const FONT_FILE = /\.(woff2?|ttf|otf|eot)$/i

export default defineConfig({
  plugins: [react()],
  build: {
    // Sin mapas de fuente en producción: no se publica el código original.
    sourcemap: false,
    // Las fuentes siempre van como archivo: la CSP de vercel.json (font-src 'self') bloquea las
    // data:, y Vite incrusta todo lo de menos de 4 KB (los subconjuntos cirílico-ext pesan ~3 KB).
    // undefined deja que Vite decida lo demás como siempre. Prueba: src/test/csp.test.js.
    assetsInlineLimit: (file) => (FONT_FILE.test(file) ? false : undefined),
  },
})
