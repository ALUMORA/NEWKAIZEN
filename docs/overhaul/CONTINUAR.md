# CONTINUAR: rehacer NEWKAIZEN como "Bloomberg-lite"

Actualizado el **22 de septiembre de 2026**, al cerrar la fase 1 y el punto de merge M1. Este archivo
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
  - [specs/finance-spec.md](specs/finance-spec.md): librería financiera con respuestas conocidas, y al
    final las respuestas conocidas del backend (DCF, factores, fórmula mágica, momentum)
  - [specs/design-brief.md](specs/design-brief.md): dirección visual, tokens, componentes, shell e IA
- Notas de entrega de cada stream: [notas/](notas/)
- Scripts de workflow usados (sirven de plantilla): [workflows/](workflows/)
- Reglas de trabajo en paralelo: [../OWNERSHIP.md](../OWNERSHIP.md) y `scripts/ownership.json`

## Estado exacto

### Fases 0 y 1 terminadas y publicadas en `analizavende`

| Commit | Qué |
| --- | --- |
| 641cc1b, 50a9d2b | Dependencias fijadas (react-router 7, TanStack Query 5, fuentes locales, Vitest 4, Playwright **1.62.1** por los navegadores en caché, FastAPI, PyJWT, pytest...), scripts npm, reglas de propiedad |
| 47ba83a (merge Q0) | Vitest, Playwright con familias `baseline-*` y `desktop/mobile`, guardas, reloj fijo, mock del API, **baseline visual del legado** (16 capturas), presupuesto de bundle, CI en `.github/workflows/check.yml` |
| e6424d0 (merge R0) | Grabación y replay de proveedores, fixtures del 22 sep, **122 goldens** del backend viejo, servidor de replay |
| 614714f (merge S1) | `backend.py` pasa a ser un shim del paquete `kaizen_api/` con FastAPI: rutas v1 idénticas probadas contra los 122 goldens, contrato v2 en `schemas.py` con rutas registradas (501 hasta la fase 2), `/health` v2, login con scrypt y JWT, límite de tasa, CORS por allowlist y el servicio nuevo en `render.yaml` |
| 3d58608 (merge S2) | Esqueleto del frontend: router, `RequireAuth`, `ErrorBoundary`, avisos del servidor, `lib/api` con arranque en frío, sesión, `format.js`, `storage.js` v2 con migración, `csv.js`, `vercel.json` con CSP. El legado vive en `src/legacy/App.legacy.jsx` **sin la contraseña fija "Investments"**, montado por `LegacyPage`, manda el token de la sesión en todos sus requests y la URL sigue a su tab |
| d6117c0 (merge M1) | Fixtures en capas, un router por stream de fase 2, cobertura y traslapes en `check-ownership.mjs`, ignores de ESLint |
| 7c1cc41 | El contrato solo acepta ligas `http(s)` y documenta cómo se normalizan GBp y ZAc |

Compuerta **G1 en verde**, verificada por el orquestador después de los merges:

- `npm run lint` (0 errores, 3 avisos heredados del legado), `npm run typecheck`, `npm run test`
  (373), `npm run build`, `npm run bundle` (106.61 KB gzip contra 180 de presupuesto, 59 %).
- `pytest` 482 pruebas sin red, 1 omitida (la que necesita red), `ruff check .` limpio.
- `npm run e2e:baseline` 16 de 16 **sin actualizar capturas**, `npm run e2e` 75 de 75 con 1 omitida.
- `node scripts/check-ownership.mjs --coverage <los 14 streams de fase 2>`: `kaizen_api/` con dueño
  único para cada archivo y sin traslapes.
- `/health` servido con `preview_start` (entrada `newkaizen-replay` del `launch.json`) responde
  `apiVersion: 2`, y la app en 1440x900 y 390x844 dibuja datos reales, sin errores de consola, sin
  requests fallidos y sin scroll horizontal. Al hacer clic en una tab del legado la URL y el título
  la siguen, y Atrás regresa.

### Lo que sigue: fase 2

El script está en [workflows/fase2.js](workflows/fase2.js). Son 14 streams, cada uno en su worktree
`05 NEWKAIZEN.wt/<id>` sobre `ws/<id>`, y cada uno pasa por constructor, revisor independiente y
corrección:

- **A1 a A4**: la librería financiera (`src/lib/finance/*`), con los goldens de `.venv-golden`.
- **A5**: el glosario de más de 60 términos y `docs/metodologia/`.
- **B1**: seguridad y plataforma encima de lo que dejó S1.
- **B2a**: precios, historia con fechas, panel alineado, FX, búsqueda, panorama y calendario BMV/NYSE.
- **B2b**: Banxico, FRED, tasas MX, rf CETES 28, macro EE.UU. en pb, noticias y tono.
- **B3a**: fundamentales con monedas correctas, estados financieros reales, dividendos, insiders, beta local.
- **B3b**: valuación (múltiplos con fuente y DCF FCFF) y momentum 12-1.
- **B3c**: screener de factores, fórmula mágica honesta y FIBRAs.
- **C1**: tokens, primitivas y `/dev/ui`. Cuando termina, su API queda congelada y arrancan **C2**
  (gráficas SVG) y **C3** (shell, navegación, ⌘K), que parten de la rama de C1.

Después viene **M2** (mergear en orden B1, B2, B3, A, C; grabar fixtures v2; compuerta G2 del PLAN),
la **fase 3** con las features F1 a F5, **M3** (borrar `src/legacy`), la **fase 4** de revisores
(finanzas, seguridad, UX/a11y, copy) y la **fase 5** (push, preview y reporte final).

## Cómo trabajar aquí

1. **git** solo funciona así en esta Mac (licencia de Xcode sin aceptar):
   `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` y luego `git ...` normal.
   El `isolation: 'worktree'` del harness NO sirve; los worktrees se crean a mano con `git worktree add`
   y se les copia `node_modules` con `cp -cR` (clon de APFS, es instantáneo).
2. Revisar que Arturo no haya movido nada: `git fetch && git log --oneline origin/alumora -3`.
   El 22 sep seguía en `5dd569b`, ya contenido en `main`. Si toca `App.jsx`, hay que portarlo a
   `src/legacy/App.legacy.jsx` o a la feature correspondiente.
3. Cada stream corre `node scripts/check-ownership.mjs <id>` antes de entregar, y el orquestador
   corre el modo `--coverage` con la lista de streams vivos antes de arrancar una fase.
4. Puertos por stream: web 5300+2i, API 8100+i. Nunca 8002, 5180 ni 4180, que son los del dueño.
   Máximo 3 agentes con navegador a la vez (24 GB de RAM).

## Decisiones ya tomadas (no re-discutir)

- **Todo va a `analizavende`. Nada a `main`** hasta que exista el servicio nuevo de Render con el
  backend v2, porque el login nuevo depende de él y Vercel publica `main` solo.
- Se construye nuevo feature por feature. El legado se monta con `LegacyPage` mientras tanto y se
  borra en M3; no se parte `App.jsx`.
- El frontend se queda en JS, con JSDoc y `tsc --checkJs` solo en `src/lib`. Las gráficas son SVG
  propias, sin librería.
- **Backend:** FastAPI + uvicorn, un worker, endpoints síncronos; scrypt de la stdlib para
  contraseñas y JWT HS256 para la sesión.
- **Convención de unidades del API v2:** todo porcentaje va como fracción, los cambios de tasa en pb,
  y cada respuesta trae `meta` con `asOf`, `source`, `stale` y `fallback`. Ya no hay 17.5 ni 8.6 %
  silenciosos.
- **Texto visible:** español de México, sin guiones largos (— ni –) y sin lenguaje de compra/venta
  como recomendación. Los datos faltantes se muestran como `s/d`, y el signo menos es U+2212.
- Se descartó el léxico Loughran-McDonald: solo existe en inglés y su licencia comercial no está clara.
- Monte Carlo: 176,729.14 es con aportación constante; con aportación que crece 1 % al mes da
  180,292.00. El CETES efectivo anual correcto es .117455.

## Trampas conocidas

- La herramienta Write está bloqueada para subagentes cuando escriben reportes; que usen heredoc.
- Playwright tiene que quedarse en 1.62.1: la 1.63 pide un Chromium que no está en caché.
- Yahoo limita por tasa: grabar una vez y reproducir en replay para todo lo demás.
- **Fixtures en capas:** `--set a,b` es el ORDEN de búsqueda y `--grabar-en b` es a dónde se GRABA.
  Para corregir una llamada que la base grabó vacía, la capa del stream va primero y se nombra como
  destino: `--set 2026-09-22-b3a,2026-09-22 --grabar-en 2026-09-22-b3a`. Escribir en el set base
  necesita `--permitir-base`. El set base tiene 444 llamadas, 34 de ellas vacías a propósito o por
  fallo del proveedor; la tabla por stream está en `docs/OWNERSHIP.md`.
- **Rutas stub:** llevan el decorador `@stub` y su router no anuncia la capacidad. Al implementar una
  se borran las dos líneas; las pruebas de contrato fallan por dato si te falta una.
- **Vitest no hereda `.env.local`**: se le vacían `VITE_SKIP_LOGIN` y `VITE_ALLOW_LEGACY` en
  `vitest.config.js`, porque esta Mac tiene `VITE_SKIP_LOGIN=true` y sin eso 6 pruebas de sesión y
  router fallan solo aquí.
- Los PNG del baseline llevan sufijo `-darwin`. En Linux (CI) se generan desde el mismo HAR con
  `--update-snapshots=all`, nunca regrabando.
- Hay bugs del backend viejo que los goldens conservan a propósito para la paridad: `^MXX` etiquetado
  como USD, el DXY de Stooq siempre falla, los empates del ranking de fórmula mágica y los guiones
  largos del texto v1. Se corrigen en v2, no en v1. El legado dibuja 76 guiones em visibles y usa
  `—` como dato faltante: eso se va con `src/legacy` en M3.
- El Render viejo (`app-4-everyone.onrender.com`) NO despliega desde este repo y sigue con código viejo.

## Lo que solo el usuario puede hacer

1. Pedirle a Arturo que no edite `App.jsx` por ahora y que después rebasee sobre `analizavende`.
2. Sacar un token gratis de Banxico SIE (la llave de FRED es opcional). Sin él, B2b deja las series
   marcadas como no verificadas y las tasas MX salen por el respaldo de FRED, señalado como respaldo.
3. Crear el servicio nuevo en Render desde `render.yaml` (rama `analizavende`, health check en
   `/health`) con `SECRET_KEY`, `USERS` (hashes de `scripts/hash_password.py`), `ALLOWED_ORIGINS`,
   `BANXICO_TOKEN` y `AUTH_REQUIRED=true`.
4. Poner `VITE_API_URL` en Vercel: primero en Preview y, al hacer el corte, en Production. Después,
   merge a `main`.
5. Antes de cobrarle a alguien: revisión legal (avisos, privacidad, fuentes de noticias), cotización
   comercial de EODHD y decidir Supabase para cuentas, sincronización y empresas.
