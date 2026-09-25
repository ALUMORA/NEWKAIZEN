# Revisión de seguridad de fase 4, frontend y backend (stream SEC, 25 de septiembre de 2026)

Sobre `00a09e9` (rama `ws/SEC`). Sin navegador: todo se verificó con pytest, Vitest, el build de Vite
y lectura del historial de git. No se re-discutió nada de "Decisiones ya tomadas" de `CONTINUAR.md`
(scrypt, JWT HS256, un worker, sin tope global por usuario).

| Área | Veredicto |
| --- | --- |
| Backend: sesión, JWT, límite de tasa, CORS | **pass_with_issues** (1 major corregido) |
| Backend: validación, SSRF, traversal, errores, bitácora | **pass_with_issues** (1 major y 1 minor corregidos) |
| Configuración de despliegue (`render.yaml`, `vercel.json`, CSP) | **pass_with_issues** (1 minor corregido, 1 abierto para el dueño) |
| Frontend (token, ligas, markdown, CSV, variables de Vite) | **pass_with_issues** (1 minor abierto) |
| Repo público: secretos en todo el historial | **pass** |
| Dependencias | **pass** |

## Corregido

1. **[major] Producción sin `AUTH_REQUIRED` dejaba todo el API v2 abierto.** `kaizen_api/settings.py:312`
   (antes `_flag(env, "AUTH_REQUIRED", False)` en cualquier entorno). Repro:
   `KAIZEN_ENV=production SECRET_KEY=<32+>` sin `AUTH_REQUIRED` arranca sin aviso, `/health` dice
   `authRequired: false` y `GET /v2/quotes?symbols=AAPL` contesta sin token, mientras el frontend
   sigue pidiendo login. Basta con crear el servicio de Render a mano en vez de por Blueprint, o
   borrar la variable. Ahora el default sigue al entorno (encendido en producción, apagado fuera);
   `AUTH_REQUIRED=false` explícito en producción se respeta con aviso al arrancar. Se ajustó
   `test_settings_guards.py`: las rutas v1 en producción ahora dan 401 (montadas y protegidas).
   Commit `a19f967`, prueba `tests/unit/b1/test_sec_auth_required.py`.
2. **[major] El login público leía a memoria cuerpos de cualquier tamaño.** `kaizen_api/main.py`
   (no había tope). Repro: `POST /auth/login` con un cuerpo de 20 MB contesta 422 **después** de
   leerlo completo, sin sesión y antes del límite de tasa; con `Transfer-Encoding: chunked` igual.
   Unos cuantos requests así tumban la instancia gratuita de Render (512 MB). Ahora
   `BodySizeLimitMiddleware` (`main.py:230`) corta en 16 KB (`MAX_BODY_BYTES`): 413 sin leer si
   `Content-Length` se pasa, 400 si no es un entero, y 413 al pasarse mientras llega un cuerpo
   chunked. Va por dentro de CORS, así que el navegador puede leer el 413. Código `BAD_REQUEST`
   porque el contrato congelado no tiene uno para 413; documentado en `docs/api-v2.md`. Commit
   `5dbaf53`, prueba `tests/unit/b1/test_sec_body_limit.py`.
3. **[minor] `%0A` en la ruta inventaba renglones en la bitácora.** `main.py` (`RequestLogMiddleware`,
   `CatchAllMiddleware`, la guarda de carga) y `errors.py:168` registraban `scope["path"]`, que llega
   decodificado. Repro: `GET /nada%0A2026-09-25%20INFO%20GET%20/auth/login%20200` deja en el log un
   segundo renglón con forma de login correcto (también secuencias ANSI con `%1b`). Ahora
   `errors.log_safe` escapa los caracteres de control (`\n`, `\x1b`) y acota a 300. Commit `22f5004`,
   prueba `tests/unit/b1/test_sec_bitacora.py`.
4. **[minor] La CSP bloqueaba cuatro fuentes del propio build.** `vercel.json` pide
   `font-src 'self'`, pero Vite incrusta como `data:` todo lo de menos de 4 KB y los subconjuntos
   cirílico-ext de Plus Jakarta Sans y JetBrains Mono (2.5 a 3.2 KB) salían en
   `dist/assets/index-*.css` como `data:font/woff2`. Repro: `npx vite build` y buscar `data:font` en
   el CSS: 4. Una página con un carácter de ese rango (por ejemplo ₴ en un titular) daba un error de
   CSP en consola. Arreglo en `vite.config.js` (`assetsInlineLimit` que nunca incrusta fuentes, el
   resto igual): el build ahora emite 4 archivos `cyrillic-ext` y 0 `data:font`. Se prefirió eso a
   abrir `data:` en la CSP. Commit `5ab619e`, prueba `src/test/csp.test.js` (también fija
   `script-src 'self'`, `frame-ancestors 'none'` y `connect-src`).

## Abierto

5. **[minor] La liga de noticias de la ficha no filtra el esquema.**
   `src/features/research/pages/Instrument.jsx:231` pone `href={n.url}` directo; `NewsPage.jsx` sí
   pasa por `safeUrl` (solo http y https). Hoy no se explota: el `response_model` de `/v2/news` exige
   `^https?://` (`schemas.py:65`), React 19 bloquea `javascript:` y la CSP no permite scripts en
   línea. No se tocó porque otros agentes están editando `src/features/research`; conviene usar el
   mismo `safeUrl` de `NewsPage.jsx` al pasar por ahí.
6. **[minor, dueño] `render.yaml` todavía declara `kaizen-backend` en modo desarrollo.** Sin
   `KAIZEN_ENV`, así que si alguien sincroniza el Blueprint queda un servicio público con `/docs`,
   las rutas v1 (que devuelven texto de excepciones en `{"error": ...}`), sin sesión y con CORS a
   cualquier `newkaizen-*.vercel.app`. `CONTINUAR.md` dice que el Render viejo no despliega desde este
   repo y M3 ya retiró la UI legada: lo sano es quitar ese servicio del archivo, o por lo menos
   ponerle `KAIZEN_ENV=production` y `KAIZEN_LEGACY_ROUTES=1`. `render.yaml` es de O.
7. **[minor, dueño] Contraseñas cortas.** Sin tope global por usuario (decisión ya documentada de
   B1), contra un ataque repartido entre IPs lo único que protege es el costo de scrypt y el largo
   de la contraseña, pero `scripts/hash_password.py` solo **avisa** si tiene menos de `MIN_LENGTH`.
   Recomiendo que el script se niegue por debajo de 12 caracteres; es decisión del dueño.
8. **[minor] `uvicorn` confía en cualquier `X-Forwarded-For`.** `main.py:391`
   (`forwarded_allow_ips="*"`) reescribe `request.client.host` con el primer elemento de la cadena,
   que lo escribe el cliente. Hoy no pesa: `client_ip` lee la cadena desde la derecha y solo usa el
   socket si la cadena es más corta que `TRUSTED_PROXY_HOPS`, que con 1 no pasa cuando la cabecera
   existe. Regla para quien siga: nunca usar `request.client` como identidad. Pendiente con red: en el
   primer despliegue, confirmar la forma real de la cadena en Render; si el último salto resultara
   ser un nodo de Cloudflare y no el cliente, las cubetas por IP se compartirían entre personas.
9. **[minor, dueño] El portafolio es del navegador, no de la persona.** `src/lib/storage.js` guarda
   todo en `localStorage["kaizen:v2"]` y cerrar sesión no lo borra: en una computadora compartida,
   quien entre después ve el portafolio anterior. Va con la decisión de Supabase para cuentas.
10. **[minor] `/v2/news` completo cae en 500 con una liga `HTTPS://` en mayúsculas.**
    `kaizen_api/domain/news.py:193` acepta el esquema sin importar mayúsculas, pero el patrón del
    esquema (`schemas.py:65`) no, así que un solo titular así rompe la validación de respuesta de
    toda la lista. Es disponibilidad, no fuga; el archivo es de B2b. Arreglo: normalizar el esquema a
    minúsculas o filtrar con el mismo patrón.
11. **[info] Lo que se deja a propósito.** Cerrar sesión es solo del lado del cliente y el JWT vale
    hasta su `exp` (12 h); se revoca con `TOKEN_VERSION` o sacando al usuario de `USERS` (decisión
    JWT HS256). Un cuerpo enviado muy despacio (slowloris) no lo cubre el tope de tamaño; depende del
    balanceador de Render. La importación de CSV no tiene tope de tamaño, pero solo afecta a la
    pestaña de quien lo sube.

## Lo que se revisó y está bien

- **JWT**: algoritmo fijo en HS256 al decodificar, `exp`, `iat`, `sub` y `ver` obligatorios, 5 s de
  tolerancia, usuario revocado al salir de `USERS`. `SECRET_KEY` obligatoria de 32+ caracteres en
  producción o con `AUTH_REQUIRED`, y nunca la de desarrollo (que es pública).
- **Contraseñas**: scrypt con parámetros acotados al parsear, `compare_digest`, scrypt de relleno para
  usuarios inexistentes, texto plano rechazado en producción, `USERS` validado al arrancar.
- **Límite de tasa**: fichas gastadas antes de verificar (sin oráculo), IP tomada desde la derecha de
  `X-Forwarded-For` con varias cabeceras unidas, fallas por usuario e IP, límites que en producción
  solo se pueden apretar.
- **CORS**: sin `*`, sin credenciales, regex de producción exacta y `fullmatch`. Como el token va en
  `Authorization` desde `sessionStorage` y no en cookie, un origen de más no daría acceso a la sesión
  de nadie.
- **Validación**: todas las rutas v2 validan símbolos con el patrón del contrato (sin `/`, `?`, `#`,
  `@` ni `:`), fechas reales con orden, enumeraciones, rangos numéricos de valuación, `limit` y listas
  de hasta 50. Errores sin eco de lo recibido ni texto de excepciones; 500 sin traza.
- **SSRF**: ningún parámetro del usuario termina en el host de una URL. Todos los hosts son fijos
  (Yahoo por yfinance, SEC, FRED, Banxico, CBOE, feeds de `feeds_es.json`); el símbolo solo llega a
  la ruta o la query, ya validado. La liga del documento de la Forma 4 sale de la propia SEC.
- **Traversal**: los `open()` de `kaizen_api` leen nombres fijos o de un `Literal`; el replay nombra
  sus archivos por hash y solo lo importa `scripts/run_replay_backend.py`, nunca la app. No hay
  variable de entorno que lo encienda en producción, y Render arranca `backend.py`.
- **Token del SIE**: va en la cabecera `Bmx-Token`, nunca en la URL, y el grabador de fixtures solo
  guarda cabeceras de respuesta: nada del token llega a `tests/fixtures`.
- **Rutas abiertas sin sesión** con `AUTH_REQUIRED`: solo `/health` (sin secretos), `/auth/login` y los
  `OPTIONS`. Las v1 de `legacy_v1.py` llevan `require_user` y en producción ni se montan salvo
  `KAIZEN_LEGACY_ROUTES=1`. `/docs` y `/openapi.json` apagados en producción.
- **Cache-Control**: `private, max-age` en datos, `no-store` en sesión, salud y todos los errores.
- **Frontend**: token en `sessionStorage`, borrado al salir, al vencer y con cualquier 401; nunca se
  manda a `/health` ni a URLs fuera de `API_BASE`. Cero `dangerouslySetInnerHTML`, `innerHTML` o
  `eval`; el lector de markdown pasa todo por React y solo hace ligas `http(s)` con
  `rel="noopener noreferrer"`. `?next=` del login solo acepta rutas internas. `VITE_SKIP_LOGIN` vive
  detrás de `import.meta.env.DEV` (no aparece en el build) y `/dev/ui` detrás de
  `MODE !== 'production'`. La exportación de CSV antepone apóstrofo a `= + - @`, tabulador y retorno.
  Sin mapas de fuente en producción.
- **CSP contra lo que carga la app**: fuentes locales (arreglado el caso `data:`), el worker de
  Monte Carlo sale como archivo del mismo origen, sin imágenes remotas, API en `*.onrender.com`.

## Repo público: secretos

Se revisó el historial completo (`git log --all -p`, 456 commits, 32.9 MB de parches) con patrones
de `BANXICO_TOKEN=`, `SECRET_KEY=`, `FRED_API_KEY=`, `EODHD_API_TOKEN=`, hashes `scrypt$...`, JWT
completos, tokens de GitHub, OpenAI, AWS, Slack, llaves privadas, cadenas hexadecimales de 64
(el formato del token del SIE), `token=`/`api_key=` en URLs, `Bmx-Token`, cookies y crumbs de Yahoo
en fixtures. **Nada real.** Lo único que aparece son valores de prueba evidentes
(`llave-de-prueba-b1-...`, `clave-demo-123`, `{"demo":"demo"}`), la llave de desarrollo que ya es
pública a propósito, un sha256 de un archivo en una nota y dos falsos positivos (`sk-hynix` en un
titular). Ningún hash real de `USERS`. No hay nada que rotar.

## Dependencias

- `npm audit --omit=dev`: 0 vulnerabilidades (y 0 contando las de desarrollo).
- `pip-audit` no está instalado. En su lugar se consultó OSV (`api.osv.dev/v1/querybatch`) con las 46
  versiones exactas de `.venv` (`pip freeze`, incluye las transitivas): 0 avisos.

## Archivos fuera de B1

SEC no tiene renglón en `scripts/ownership.json`; los cambios de backend caen en los globs de B1.
Fuera de ellos quedaron `vite.config.js` (de O), `src/test/csp.test.js` y dos renglones de
`docs/api-v2.md`. `check-ownership.mjs B1` los lista, y es lo esperado.

## Compuertas

- `.venv/bin/python -m pytest`: 1430 passed, 3 skipped (antes de empezar: 1424 y 3).
- `.venv/bin/python -m ruff check .`: limpio.
- `npm run check`: lint y typecheck limpios, Vitest 76 archivos y 2011 pruebas, build, bundle al 74 %
  del presupuesto.
- e2e no se corrió: ningún cambio toca pantallas; el de `vite.config.js` solo saca a archivo cuatro
  fuentes cirílico-ext que ninguna página usa hoy.
