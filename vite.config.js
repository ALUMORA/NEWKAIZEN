import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Sin mapas de fuente en producción: no se publica el código original.
    sourcemap: false,
  },
})
