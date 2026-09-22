// Vitest 4 ya no tiene environmentMatchGlobs: el entorno por archivo se resuelve con dos
// proyectos. *.test.js corre en node (lógica pura, más rápido) y *.test.jsx en jsdom
// (componentes). Los dos heredan plugins, alias y setupFiles de la raíz con extends: true.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const setupFiles = ['./src/test/setup.js']

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles,
    // Vitest carga .env.local igual que vite dev, y en esta máquina trae VITE_SKIP_LOGIN=true:
    // sin esto, las pruebas corren con la sesión sintética de desarrollo y 6 de sesión y router
    // fallan solo en la copia del dueño, no en los worktrees. Las pruebas piden su entorno.
    env: { VITE_SKIP_LOGIN: '', VITE_ALLOW_LEGACY: '' },
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.js', 'tests/golden/*.test.js'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.jsx'],
        },
      },
    ],
  },
})
