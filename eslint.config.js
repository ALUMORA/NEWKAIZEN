import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'dist-ssr',
    // Build de e2e: 'npm run e2e' lo deja minificado y sin ignorarlo 'npm run lint' truena.
    'dist-e2e',
    '.venv',
    '.venv-golden',
    'venv',
    'node_modules',
    'playwright-report',
    'test-results',
    'blob-report',
    'coverage',
    'e2e/fixtures',
    // Guiones de la herramienta Workflow: el harness envuelve el cuerpo en una función, así que su
    // 'return' de primer nivel es válido ahí pero no como módulo ES. No son código de la app.
    'docs/overhaul/workflows',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // Scripts de Node (.mjs incluidos, que el bloque de arriba no cubre).
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // Playwright corre en Node, pero lo que va dentro de page.evaluate corre en el navegador:
  // por eso e2e/ se queda con los globals del navegador y además suma los de Node.
  {
    files: ['e2e/**/*.{js,mjs}', '*.config.{js,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.vitest,
    },
  },
])
