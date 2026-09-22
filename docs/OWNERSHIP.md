# Reglas de trabajo en paralelo

Este repo se está rehaciendo por streams que trabajan al mismo tiempo, cada uno en su propio
worktree (`05 NEWKAIZEN.wt/<stream>`, rama `ws/<stream>`). Para que los merges salgan limpios:

1. **Cada stream toca solo sus archivos.** Los globs están en `scripts/ownership.json`.
   Antes de terminar corre `node scripts/check-ownership.mjs <stream>`; si falla, no se mergea.
2. **Solo el orquestador (O) toca dependencias**: `package.json`, `package-lock.json`,
   `requirements*.txt`. Si te falta una dependencia, pídela en `docs/requests/<stream>.md`.
3. **Primitivas congeladas.** Después del checkpoint C1, `src/components/ui/index.js` y
   `src/components/charts/index.js` no cambian de firma. Si una feature necesita algo nuevo,
   lo pide en `docs/requests/<stream>.md` con `{necesidad, por qué, API propuesta}` y mientras
   usa un componente local dentro de su carpeta.
4. **Contrato congelado.** Después de M1, `kaizen_api/schemas.py` y `docs/api-v2.md` solo
   cambian vía request al orquestador.
5. **git** se corre siempre como `DEVELOPER_DIR=/Library/Developer/CommandLineTools git ...`
   (la licencia de Xcode no está aceptada en esta Mac).
6. **Puertos por stream** para no pisarse: web `5200+i`, API `8100+i` (i = índice del stream).
7. **Nada de BUY/SELL/COMPRAR/VENDER** como recomendación, y todo texto visible en español de
   México, natural, sin guiones largos (— ni –).
8. **Colores solo por token** (`var(--...)`), definidos en los dos temas. Nada de hex sueltos.
9. **Verificar en la página renderizada**, no leyendo código: errores de consola o requests
   ≥400 son defectos bloqueantes.

## Mapa de streams

| Stream | Qué hace |
| --- | --- |
| O | Orquestador: git, dependencias, merges, gates |
| Q0 | Configuración de Vitest, Playwright, ESLint; baseline visual del legado |
| R0 | Grabación y replay de proveedores (yfinance/HTTP) y goldens del backend viejo |
| S1 | Backend como paquete `kaizen_api/` con FastAPI, mismo comportamiento |
| S2 | Esqueleto del frontend: router, cliente API, sesión, formato, storage |
| A | Librería financiera `src/lib/finance/` con pruebas de respuesta conocida |
| B1, B2, B3 | Backend: seguridad y plataforma; tasas, FX, historia y mercado; fundamentales, valuación y screeners |
| C | Tokens, primitivas, gráficas, shell y navegación |
| F1 a F5 | Features: portafolio, mercados, investigar, herramientas, aprender/watchlist/onboarding/auth/legal |
