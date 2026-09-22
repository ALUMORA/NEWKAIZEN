# CONTINUAR: rehacer NEWKAIZEN como "Bloomberg-lite"

Sesión detenida por el usuario el **22 de septiembre de 2026**, a mitad de la **fase 1**. Este archivo
es el punto de entrada para la siguiente sesión. Todo lo que hace falta está en `docs/overhaul/`.

## Qué es esto

El usuario pidió revisar el repo `ALUMORA/NEWKAIZEN` y mejorarlo todo (UI, UX, finanzas bien hechas,
funciones nuevas) para que sea un "Bloomberg barato" para inversionistas de a pie en México y EE.UU. y
para empresas chicas que se lo den a sus empleados. Se hizo una auditoría (113 hallazgos verificados)
y se aprobó un plan por fases con agentes en paralelo.

- Plan aprobado, completo: [PLAN.md](PLAN.md)
- Auditoría: [auditoria/indice-hallazgos.txt](auditoria/indice-hallazgos.txt) (una línea por hallazgo) y
  [auditoria/audit.json](auditoria/audit.json) (evidencia, por qué y corrección de cada uno; si el
  veredicto es "partially", usar `corrected_fix` en vez de `fix`).
- Specs que alimentan a los agentes (autoritativas):
  - [specs/api-v2-spec.md](specs/api-v2-spec.md): contrato del API v2 (unidades, errores, endpoints)
  - [specs/frontend-spec.md](specs/frontend-spec.md): rutas, providers, cliente API, sesión, formato, storage
  - [specs/finance-spec.md](specs/finance-spec.md): librería financiera con respuestas conocidas (verificadas con numpy/scipy)
  - [specs/design-brief.md](specs/design-brief.md): dirección visual, tokens, componentes, shell e IA
- Notas de entrega de cada stream: [notas/](notas/)
- Scripts de workflow usados (sirven de plantilla): [workflows/](workflows/)
- Reglas de trabajo en paralelo: [../OWNERSHIP.md](../OWNERSHIP.md) y `scripts/ownership.json`

## Estado exacto al detenerse

### Hecho y publicado en `analizavende` (origin)

| Commit | Qué |
| --- | --- |
| 641cc1b, 50a9d2b | Dependencias fijadas (react-router 7, TanStack Query 5, fuentes locales, Vitest 4, Playwright **1.62.1** por los navegadores en caché, FastAPI, PyJWT, pytest...), scripts npm, reglas de propiedad |
| 47ba83a (merge Q0) | Vitest (proyectos node y jsdom), typecheck de `src/lib`, Playwright con familias `baseline-*` y `desktop/mobile`, guardas, reloj fijo, mock del API, **baseline visual del legado** (16 capturas, HAR grabado), presupuesto de bundle, CI en `.github/workflows/check.yml` |
| e6424d0 (merge R0) | Grabación y replay de proveedores (yfinance y HTTP) en `tests/replay/`, fixtures del 22 sep en `tests/fixtures/recorded/2026-09-22/`, **122 goldens** del backend viejo en `tests/goldens_legacy/`, servidor de replay `scripts/run_replay_backend.py` |
| 7c7964e | Correcciones de las revisiones de fase 0: goldens sin enmascarar campos (el replay congela reloj y datos), baseline con presupuesto de 150 píxeles, build de e2e en `dist-e2e/` |
| 17fe470, ee6056f | Ajustes de propiedad para fase 1 y sub-streams de fase 2 |

Compuerta **G0 en verde**: lint, typecheck, Vitest, 165 pruebas de Python sin red, 16 capturas del baseline (dos corridas), suite e2e de la app.

### Fase 1: trabajo local en worktrees, SIN mergear

Los worktrees viven fuera del repo, en `~/Desktop/CLAUDE/05 NEWKAIZEN.wt/<stream>`, cada uno en su rama local `ws/<stream>` (no están en GitHub).

- **S1 (`ws/S1`, terminado):** `backend.py` pasó a ser un shim del paquete `kaizen_api/` con FastAPI.
  - Tiene rutas v1 idénticas, probadas contra los 122 goldens, más el contrato v2 con `schemas.py`, `docs/api-v2.md`, rutas v2 registradas (501 hasta que las implemente la fase 2), `/health` v2, login con scrypt + JWT + límite de tasa, CORS por allowlist y el servicio nuevo en `render.yaml`.
  - Una revisión independiente dio **pass_with_issues** y S1 ya corrigió esos defectos: 455 pruebas en verde sin red y ruff limpio.
  - Detalle y pendientes: [notas/fase1-S1.md](notas/fase1-S1.md).
- **S2 (`ws/S2`, casi terminado):** el esqueleto del frontend ya existe.
  - `src/app/` (router, RequireAuth, ErrorBoundary, avisos del servidor), `src/lib/api`, sesión, `format.js`, `storage.js` con migración v1 → v2, `csv.js`, stub de `ledger.js` y `vercel.json` con CSP.
  - El legado se movió a `src/legacy/App.legacy.jsx` **sin la contraseña fija "Investments"**.
  - La revisión dio **pass_with_issues**. La corrección se interrumpió y quedó en el commit **`464cd79` (wip)**: hay que revisar ese diff, terminarlo y volver a correr las compuertas.
  - Defectos por cerrar, en [notas/fase1-S2.md](notas/fase1-S2.md) (sección "Revisión independiente"):
    1. **[major]** El legado dentro de LegacyPage no manda el token de sesión: con `AUTH_REQUIRED` activo, sus 23 requests v1 salen sin `Authorization`. El wip ya tocaba `src/legacy/App.legacy.jsx`, `LegacyPage.jsx` y `client.js` para esto.
    2. `safeNext()` en `src/app/paths.js` no rechaza caracteres de control (`%09`, `%0A`).
    3. La URL no sigue al tab cuando se cambia de tab dentro del legado.
    4. Reintentos apilados: `apiFetch` ya reintenta ~67 s y TanStack Query reintenta otra vez. Desactivar el retry de Query para errores de arranque en frío.
    5. `fmtDate('2026-02-31')` debe dar `s/d`.
    6. `storage.load()` no debe tratar un `v:3` futuro como corrupto.
    7. Documentar que la migración v1 → v2 es una foto única. Opcional: re-migrar mientras el legado siga escribiendo.
    8. `eslint.config.js` debe ignorar `dist-e2e` (después de `npm run e2e`, `npm run lint` truena con 155 errores).

## Cómo retomar, paso a paso

1. **git** solo funciona así en esta Mac (licencia de Xcode sin aceptar):
   `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` y luego `git ...` normal.
   El `isolation: 'worktree'` del harness NO sirve; los worktrees se crean a mano con `git worktree add`.
2. Revisar que Arturo no haya movido nada: `git fetch && git log --oneline origin/alumora -3`.
   El 22 sep estaba en `5dd569b`, ya contenido en `main`. Si hubo cambios en `App.jsx`, hay que
   portarlos a `src/legacy/App.legacy.jsx` o a la feature correspondiente.
3. **Terminar S2:** en `05 NEWKAIZEN.wt/S2`, revisar el diff de `464cd79`, cerrar los 8 defectos de
   arriba y correr sus compuertas:
   ```
   npm run lint && npm run typecheck && npm run test && npm run build && npm run bundle
   grep -c Investments dist/assets/*.js                        # debe ser 0
   npm run e2e:baseline                                        # sin actualizar capturas
   npm run e2e
   node scripts/check-ownership.mjs S2
   ```
   Commits de una línea, en español con acentos, sin Co-Authored-By.
4. **M1 (merge):** en `05 NEWKAIZEN`, `git merge --no-ff ws/S1`, luego `ws/S2`. Compuerta G1:
   - `npm run lint && npm run typecheck && npm run test && npm run build && npm run bundle`
   - `.venv/bin/python -m pytest -q` (sin red; la paridad con los goldens tiene que pasar)
   - `.venv/bin/ruff check .`
   - `/health` con `apiVersion: 2`: levantar `.venv/bin/python scripts/run_replay_backend.py --module kaizen_api.main --port 8190` y abrirlo con `preview_start`, o con curl.
   - Revisar la app en el Browser pane a 1440x900 y 390x844 (regla 4 del CLAUDE.md).
   - `git push origin analizavende`.
   - Borrar los worktrees `S1` y `S2`.
5. **Pendientes de M1 que el orquestador iba a hacer antes de la fase 2:**
   - **Fixtures en capas:** que `tests/replay` acepte varios sets (p. ej. `"2026-09-22,2026-09-22-b2a"`, buscando en orden y grabando en el último). Así cada stream de backend graba sus llamadas nuevas en su propio set sin chocar en `index.json`.
   - **Propiedad de routers:** leer `kaizen_api/routers/` y `docs/api-v2.md` de S1 para ver en qué archivo quedó cada endpoint (por ejemplo, macro/us, valuation y momentum). Ajustar `scripts/ownership.json` para que cada router lo tenga el stream que lo implementa (B2a, B2b, B3a, B3b o B3c). Si un archivo mezcla endpoints de dos streams, partirlo antes de arrancar.
   - Agregar `dist-e2e` a los ignores de ESLint, si S2 no lo hizo.
6. **Fase 2:** un workflow con un worktree por stream. Cada stream pasa por builder → revisor independiente → corrección, igual que [workflows/fase1.js](workflows/fase1.js).
   - En paralelo: A1, A2, A3, A4, A5, B1, B2a, B2b, B3a, B3b, B3c y C1.
   - Cuando C1 congela las primitivas: C2 (gráficas) y C3 (shell, navegación, ⌘K).
   - La propiedad de cada sub-stream ya está en `scripts/ownership.json`. Qué hace cada uno:
     - A1-A4: la librería financiera. Módulos y respuestas conocidas en [specs/finance-spec.md](specs/finance-spec.md).
     - A5: el glosario de más de 60 términos y `docs/metodologia/`.
     - B1: seguridad y plataforma, encima de lo que dejó S1.
     - B2a: precios, historia con fechas, panel alineado, FX, quotes, búsqueda, overview de mercados y calendario BMV/NYSE.
     - B2b: Banxico (necesita `BANXICO_TOKEN`; sin él, respaldo de FRED marcado), FRED (CSV sin llave), tasas MX, rf CETES 28 como serie, macro EE.UU. en pb, noticias con fuentes en español y tono heurístico.
     - B3a: fundamentales con monedas correctas (`financialCurrency`), estados financieros reales, dividendos, eventos, insiders y beta contra benchmark local en la misma moneda.
     - B3b: valuación. Múltiplos con fuente y fecha (Damodaran EM/US), un DCF FCFF de dos etapas con CAPM + riesgo país + sensibilidad, P/VL justificado para bancos y momentum 12-1.
     - B3c: screener de factores relativo al sector (sin BUY/SELL), fórmula mágica honesta (universo real, caché y lote) y FIBRAs con métricas correctas y spread contra CETES.
     - C1-C3: según [specs/design-brief.md](specs/design-brief.md).
   - Puertos por stream: web 5200+i, API 8100+i. Nunca 8002, 5180 ni 4180.
   - Máximo 3 agentes con navegador a la vez (24 GB de RAM).
7. **M2:** mergear en orden B1 → B2 → B3 → A → C; grabar fixtures v2 desde el backend en replay (`npm run fixtures:api`); compuerta G2 (ver PLAN.md).
8. **Fase 3 (features):**
   - F1 portafolio: ledger, P&L precio vs tipo de cambio, TWR/XIRR, ISR, riesgo, rebalanceo en acciones enteras.
   - F2 mercados: México y tasas, calculadora CETES, VIX en percentil en vez de "Fear & Greed".
   - F3 investigar: emisora, comparar, screener, fórmula mágica, FIBRAs.
   - F4 herramientas: optimizador con frontera y walk-forward, backtest honesto, simulador y metas.
   - F5: aprender, watchlist, onboarding, login, legal, manifest.
   - Después: **M3** (borrar `src/legacy`), **fase 4** (revisores de finanzas, seguridad, UX/a11y y copy) y **fase 5** (commits, push, preview, reporte final). Todo el detalle está en [PLAN.md](PLAN.md).

## Decisiones ya tomadas (no re-discutir)

- **Todo va a `analizavende`. Nada a `main`** hasta que exista el servicio nuevo de Render con el backend v2, porque el login nuevo depende de él y Vercel publica `main` solo.
- Se construye nuevo feature por feature. El legado se monta con `LegacyPage` mientras tanto y se borra en M3; no se parte `App.jsx`.
- El frontend se queda en JS, con JSDoc y `tsc --checkJs` solo en `src/lib`. Las gráficas son SVG propias, sin librería.
- **Backend:** FastAPI + uvicorn, un worker, endpoints síncronos; scrypt de la stdlib para contraseñas y JWT HS256 para la sesión.
- **Convención de unidades del API v2:** todo porcentaje va como fracción, los cambios de tasa en pb, y cada respuesta trae `meta` con `asOf`, `source`, `stale` y `fallback`. Ya no hay 17.5 ni 8.6% silenciosos.
- **Texto visible:** español de México, sin guiones largos (— ni –) y sin lenguaje de compra/venta como recomendación. Los datos faltantes se muestran como `s/d`, y el signo menos es U+2212.
- Se descartó el léxico Loughran-McDonald: solo existe en inglés y su licencia comercial no está clara.
- Monte Carlo: 176,729.14 es con aportación constante; con aportación que crece 1% al mes da 180,292.00 (ya corregido en finance-spec). El CETES efectivo anual correcto es .117455.

## Trampas conocidas

- La herramienta Write está bloqueada para subagentes cuando escriben reportes; que usen heredoc desde bash.
- Playwright tiene que quedarse en 1.62.1: la 1.63 pide un Chromium que no está en caché.
- Yahoo limita por tasa: grabar una vez y reproducir en replay para todo lo demás.
- El Render viejo (`app-4-everyone.onrender.com`) NO despliega desde este repo y sigue con código viejo.
- Los PNG del baseline llevan sufijo `-darwin`. En Linux (CI) se generan desde el mismo HAR con `--update-snapshots=all`, nunca regrabando.
- Hay bugs del backend viejo que los goldens conservan a propósito para la paridad: `^MXX` etiquetado como USD, el DXY de Stooq siempre falla, los empates del ranking de fórmula mágica y los guiones largos del texto v1. Se corrigen en v2, no en v1.

## Lo que solo el usuario puede hacer

1. Pedirle a Arturo que no edite `App.jsx` por ahora y que después rebasee sobre `analizavende`.
2. Sacar un token gratis de Banxico SIE (la llave de FRED es opcional).
3. Crear el servicio nuevo en Render desde `render.yaml` (rama `analizavende`, health check en `/health`) con `SECRET_KEY`, `USERS` (hashes de `scripts/hash_password.py`), `ALLOWED_ORIGINS`, `BANXICO_TOKEN` y `AUTH_REQUIRED=true`.
4. Poner `VITE_API_URL` en Vercel: primero en Preview y, al hacer el corte, en Production. Después, merge a `main`.
5. Antes de cobrarle a alguien: revisión legal (avisos, privacidad, fuentes de noticias), cotización comercial de EODHD y decidir Supabase para cuentas, sincronización y empresas.
