# M1: preparación para la fase 2 (22 de septiembre de 2026)

## Resumen

Los 7 defectos menores del revisor quedaron arreglados en 4 commits nuevos sobre los 9 anteriores (ws/M1, árbol limpio, 13 commits sobre 614714f, 33 archivos, +2365/-276). Acepté los 7 sin reservas: ninguno era discutible y todos eran baratos. Abajo, qué se hizo y con qué evidencia.

MENOR 1, is_stub() decidía por el texto del código. Confirmado y arreglado por dato. Agregué el decorador @stub a kaizen_api/routers/__init__.py: cuelga __kaizen_stub__ en la función y la devuelve igual, así que no toca la firma ni el OpenAPI. Las 22 rutas stub lo llevan ahora debajo de su @router.get. El decorador vive en el archivo congelado, pero su USO vive en el archivo de cada stream, que es justo lo que el revisor pedía: nadie abre un archivo ajeno. Más una segunda red de seguridad que el revisor no pidió y que cierra el hueco de raíz: la prueba ya no llama a la ruta cuando hay contradicción. Si la función lleva @stub Y su router anuncia la capacidad, falla por dato con "kaizen_api.routers.quotes anuncia ['quotes'] pero GET /v2/quotes todavía lleva @stub". O sea que el escenario que describe el revisor (marca puesta + ruta implementada -> client.request -> proveedores -> "La prueba intentó salir a la red") ya no puede ocurrir, ni siquiera si alguien se equivoca en los dos sentidos.

MENOR 2, solo se exigía que el módulo anunciara "alguna" capacidad. Confirmado. SPEC tiene quinta columna con la capacidad de CADA ruta (25 filas), y la prueba exige ESA. /v2/valuation lleva dos (valuation.multiples, valuation.dcf) porque una valuación puede llegar primero con múltiplos; ahí basta una, en las otras 24 es exacta. Agregué además una prueba que amarra la columna con schemas.KNOWN_CAPABILITIES: la unión de las capacidades del spec más tres extras declaradas (legacy.v1, fx.fix, history.dates) tiene que ser exactamente KNOWN_CAPABILITIES, y no se pueden solapar. Así la tabla no se va por su lado cuando alguien agregue una capacidad.

PRUEBA VIVA de 1 y 2, con el escenario exacto del revisor: monté en el árbol real quotes.py con /v2/fx implementada (llamando a requests.get a Yahoo), /v2/quotes todavía con @stub, y CAPABILITIES = ["quotes"]. Resultado: 2 FAILED, ninguno por red.
- "GET /v2/fx ya no lleva @stub pero su router no anuncia 'fx': agrégala a CAPABILITIES de kaizen_api.routers.quotes (es lo que publica /health)"
- "kaizen_api.routers.quotes anuncia ['quotes'] pero GET /v2/quotes todavía lleva @stub: si ya la implementaste, quita esa línea (y su raise not_implemented); si no, quita la capacidad"
Cero apariciones de "intentó salir a la red" en la salida. Con CAPABILITIES = ["fx"] (el caso correcto) la suite de contrato sale en 0 y /health anuncia ['auth', 'fx', 'legacy.v1']. quotes.py restaurado, árbol limpio.

MENOR 3, ERROR_RESPONSES congelado y B1 sin poder anunciar el 429. Confirmado. Salió a kaizen_api/http_responses.py, que quedó en los globs de B1, con el mismo patrón que http_cache.py: routers/__init__.py lo reexporta y los doce routers no cambian ni un import. No agregué el 429 yo: eso le toca a B1 junto con su limitador, y agregarlo ahora habría cambiado el OpenAPI de las 22 rutas sin que nadie sirviera ese código. El archivo lo dice explícito en su docstring, y OWNERSHIP.md ahora tiene una tabla de los dos archivos de B1 que salieron del congelado, con para qué los necesita cada uno.

MENOR 4, traslape latente public/manifest.webmanifest entre C1 y F5. Confirmado con la propia herramienta. Agregué "!public/manifest.webmanifest" a C1. Verificación: node scripts/check-ownership.mjs --coverage C1,F5 pasó de exit 1 a exit 0, y la lista completa de fase 2 MÁS fase 3 (A1..A5,B1,B2a,B2b,B3a,B3b,B3c,C1,C2,C3,F1..F5) ahora sale en exit 0 sin ningún traslape. Esa lista larga quedó escrita en OWNERSHIP.md, porque el defecto solo aparece si pides los streams F.

MENOR 5, base-gana incondicional y las 35 llaves que fase 2 va a querer corregir. Confirmado y arreglado con lo que propuso el revisor. LayeredStore acepta record=, la sesión record_layer= y record_fixtures.py --grabar-en: el orden de búsqueda y la capa de destino son dos decisiones separadas. La regla de sombreado pasó de "cualquier capa que no sea la última" a "cualquier capa que conteste ANTES que la de grabación", que es la condición correcta: si tu capa gana la búsqueda, regrabarla sí cambia lo que devuelve el replay. Un stream corre ahora --set 2026-09-22-b3a,2026-09-22 --grabar-en 2026-09-22-b3a y corrige lo suyo sin pedirle nada al orquestador. Lo bueno de la base se sigue sirviendo de la base (no se vuelve a pedir sin --refresh); lo vacío o con error sí sale al proveedor. Las 35 llaves las conté yo mismo sobre el index.json (34 soft_failure + 1 excepción de 432) y quedaron en OWNERSHIP.md en una tabla por stream, con el comando para regenerarla. Once de ellas son de ZZZNOTREAL, el símbolo inexistente a propósito, y ahí está bien que sigan fallando; las que de verdad estorban son los insider_transactions de WALMEX/CEMEXCPO/FUNO11 (B3a) y los estados de STORAGE18.MX (B3a y B3c).

MENOR 6, las pruebas montaban el set real con enlace simbólico. Confirmado. Los tres symlink_to pasaron a shutil.copytree con un helper _copy_real_set que explica por qué. Ahora la aserción de bytes es sobre la COPIA, que es la capa que de verdad está en la pila, y la del set commiteado queda como control de que ni se abrió. Si alguna guarda se rompiera, la prueba falla sin haber tocado las referencias. Costo medido: 433 archivos, 10,183,533 bytes, tres copias por corrida; la suite completa no cambió de tiempo de forma perceptible.

MENOR 7, "Tres" contra cuatro archivos. Corregido a "Cuatro", y de paso reescribí esa sección con el ejemplo de las dos líneas que se borran al implementar.

## Commits

- `8c8086e fix: la ruta stub se marca con @stub y el contrato exige la capacidad de esa ruta, no cualquiera`
- `fe8dc61 refactor: ERROR_RESPONSES sale a kaizen_api/http_responses.py, que es de B1 y puede anunciar el 429`
- `d74c5b7 feat: --grabar-en separa la capa de destino del orden de búsqueda, y las pruebas copian el set base`
- `4ba439b docs: la propiedad quita el traslape de C1 con F5 y documenta el stub, el 429 y las 35 llaves de la base`

## Compuertas

- **/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python -m pytest -q -p no:cacheprovider (y -rA para contar)**
  exit 0. 482 PASSED, 0 FAILED, 1 SKIPPED (tests/replay/test_live.py, necesita red); 483 recolectados (contados con --co -q sumando los totales por archivo). Base de la fase eran 455, o sea +27; de la corrida anterior (479) son +3: 1 de contrato (la quinta columna de SPEC y KNOWN_CAPABILITIES tienen que cuadrar) y 2 de capas (--grabar-en elige el destino aparte del orden; la capa de destino tiene que ser una del spec). Desglose: characterization 274, contract 84, replay 64, unit 60. La línea de resumen la suprime la config; conté los PASSED y los puntos. Un grep de '^ERROR' pega 1 línea de log capturado ('error interno en GET /rf', de tests/unit/test_app.py:172, que provoca un 500 a propósito), no un fallo.
- **/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/ruff check .**
  exit 0. All checks passed!
- **npm run lint**
  exit 0. 3 problems (0 errors, 3 warnings), las 3 son react-hooks/exhaustive-deps preexistentes en src/App.jsx (legado), líneas 1220, 1288 y 1971. Sigue el aviso de los reportes anteriores: en 614714f este comando salía con 3 ERRORES por los guiones de docs/overhaul/workflows/, ignorados desde a7352c9.
- **node scripts/check-ownership.mjs M1**
  exit 0. ✓ M1 (ws/M1): 33 archivo(s), todos dentro de su propiedad. (Eran 28; los 5 nuevos son kaizen_api/http_responses.py y los 4 routers que antes no habían cambiado y ahora llevan @stub: search.py, macro.py, events.py, insiders.py... todos dentro de kaizen_api/routers/**.)
- **node scripts/check-ownership.mjs --coverage A1,A2,A3,A4,A5,B1,B2a,B2b,B3a,B3b,B3c,C1,C2,C3**
  exit 0. ✓ kaizen_api/: 64 archivos (uno más, http_responses.py), cada uno con dueño. ✓ Sin traslapes. Informativo: docs/ 0 de 19 sin dueño, tests/ 0 de 580, public/ 0 de 1; .github/ 1 (Q0), e2e/ 27 (Q0 y S2), scripts/ 3 (Q0 y S1), src/ 6 (Q0 y S2), raíz 7 (M1, Q0 y S2). Ni un archivo versionado sin dueño en ownership.json.
- **node scripts/check-ownership.mjs --coverage A1,...,C3,F1,F2,F3,F4,F5 (fase 2 MÁS fase 3) y --coverage C1,F5**
  Los dos exit 0, y son la prueba del defecto 4. Antes del arreglo, 'C1,F5' salía con exit 1 y '- public/manifest.webmanifest: C1 y F5'; ahora ✓ Sin traslapes en las dos listas. La lista larga (19 streams) quedó documentada en OWNERSHIP.md justamente porque el traslape no aparecía con la lista corta de fase 2.
- **diff del OpenAPI de 614714f contra HEAD, json.dumps(app.openapi(), sort_keys=True)**
  IDÉNTICO byte por byte. sha256 a028b446f8ff6e5153293f53e1ba7a571111989d13cfda5cadb4c135fa7230db en los dos, 99875 bytes, 25 operaciones. (El hash difiere del reporte anterior solo porque esta vez dumpé con ensure_ascii=False; lo que importa es que los dos árboles dan el mismo, sacados con el mismo script, extrayendo 614714f con git archive.) También dumpé el orden de inserción de paths con operationId y tags: idéntico. Ninguna diferencia que justificar, ni por el decorador @stub (devuelve la misma función) ni por la salida de ERROR_RESPONSES a http_responses.py.
- **python scripts/run_replay_backend.py --module kaizen_api.main --port 8120 --set 2026-09-22 + curls**
  Banner: [replay] kaizen_api.main en http://127.0.0.1:8120 set=2026-09-22 frozen_at=2026-09-22T14:51:31+00:00 red=bloqueada. /health -> 200 apiVersion:2, capabilities [auth, legacy.v1], cache-control no-store. /v2/valuation/AAPL, /v2/macro/us, /v2/quotes?symbols=AAPL, /v2/insiders/AAPL, /v2/events?symbols=AAPL y /v2/momentum/AAPL -> 501 NOT_IMPLEMENTED con cache-control: no-store y el endpoint correcto en details. Validación intacta: /v2/valuation/AAPL?erp=0.9 -> 422 con field query.erp; /v2/quotes?symbols=,,, -> 422 'Indica al menos un símbolo'. Ruta legada /stock/AAPL -> 200, 2558 bytes de datos reales del replay. Log del servidor sin errores ni requests fallidos. Matado (PID 60104), lsof confirma el puerto 8120 libre.
- **receta de fixtures en capas, la nueva con --grabar-en y las tres guardas, en el árbol real**
  1) Receta normal de B2a: --set 2026-09-22,2026-09-22-b2a --get '/v2/quotes?symbols=AAPL' -> exit 0, 'graba en=2026-09-22-b2a', '0 llamadas a proveedores (todavía 501)', 'la capa no grabó ninguna llamada: no se crea', 'todas las rutas se reproducen completas'. 2) Receta nueva: --set 2026-09-22-b3a,2026-09-22 --grabar-en 2026-09-22-b3a --get '/stock/AAPL' -> exit 0, 'capas=2026-09-22-b3a,2026-09-22 graba en=2026-09-22-b3a', 200 con 5 llamadas a proveedores, todas servidas de la base (valores buenos, no se regraban sin --refresh), capa no creada. 3) Guardas: --set '2026-09-22,' -> exit 2 'trae coma pero se quedó en una sola capa'; --set 2026-09-22 -> exit 2 'Graba en tu propia capa'; --grabar-en otra fuera del spec -> exit 2 'La capa de grabación otra no está en el spec'. tests/fixtures/recorded/ sigue con una sola carpeta y git status vacío después de las cinco corridas.
- **prueba del ignore de eslint con dist-e2e, playwright-report y test-results**
  Con dist-e2e/assets/x.js minificado y copias en playwright-report/ y test-results/: npm run lint exit 0. Control quitando solo la línea 'dist-e2e' de globalIgnores: npx eslint dist-e2e da exit 1 y '✖ 1 problem (1 error)' (no-unused-vars sobre 'b'). eslint.config.js restaurado y los tres directorios borrados; git status limpio.

## Pendientes

- Le agrandé los globs a B1 y a M1 otra vez, y eso lo decide el orquestador: B1 ganó kaizen_api/http_responses.py (suyo por la tabla de OWNERSHIP.md, que le encarga códigos de estado y límites de tasa) y M1 lo mismo para poder crearlo. Es el mismo movimiento que en la corrida anterior con http_cache.py, ahora por el defecto 3 del revisor.
- NO agregué el 429 RATE_LIMITED a ERROR_RESPONSES, a propósito: habría cambiado el OpenAPI de las 22 rutas de datos anunciando un código que hoy nadie sirve, y habría roto la prueba de que el OpenAPI no cambió. Ahora es una línea en un archivo que B1 sí puede abrir, y su docstring lo dice. El 429 de /auth/login sigue armándose aparte en auth.py con su propio _LOGIN_ERRORS, como estaba.
- El decorador @stub vive en routers/__init__.py, que está congelado bajo O. Su USO está en el archivo de cada stream, que es lo que resuelve el defecto, pero si algún stream quiere marcar algo distinto (por ejemplo una ruta parcialmente implementada) tiene que pedirlo. Me parece correcto que sea así: la marca es parte del contrato, no del detalle de cada stream.
- La precedencia sigue siendo base-gana POR OMISIÓN, ahora sí con salida: --grabar-en deja invertirla por stream. Conviene decirlo en el encargo de B3a y B3c, que son los que se van a topar con las llaves vacías (insider_transactions de WALMEX/CEMEXCPO/FUNO11 y los estados de STORAGE18.MX). La lista completa de las 35 llaves está en docs/OWNERSHIP.md con el comando para regenerarla.
- Efecto secundario que sigue vivo (no es nuevo): si alguien pone en KAIZEN_REPLAY_SET una capa que todavía no grabó nada, el replay falla con 'No existe el set grabado X'. El mensaje ya trae la pista y record_fixtures.py la salta solo al verificar, pero pytest con esa variable sí va a fallar. Es correcto, no hay nada que apilar.
- Las capas nuevas ahora escriben también lookup_order en su index.json, además de layered_on. Es información, nadie la lee todavía; sirve para saber contra qué pila se grabó una capa cuando el orden dejó de ser el de siempre. El set base 2026-09-22 no lo tiene y no se tocó.
- npm run lint YA ESTABA ROJO en 614714f, no lo rompió fase 1: docs/overhaul/workflows/{auditoria,fase0,fase1}.js daban 'Parsing error: return outside of function' por ser guiones de la herramienta Workflow. Ignorados en eslint.config.js desde a7352c9. Sigue siendo decisión del orquestador si prefiere moverlos o darles su propia config.
- No creé docs/requests/M1.md: no me faltó ninguna dependencia ni permiso. Está en mis globs por si hace falta.
- Corrección de dato del reporte anterior que mantengo: docs/overhaul tiene 16 archivos versionados, no 700+. Hoy el repo tiene 730 versionados en total (uno más por http_responses.py).

## Notas para los siguientes streams

=== 1. RUTA -> ARCHIVO DE ROUTER -> STREAM (final) ===
Cada archivo de kaizen_api/routers/ tiene rutas de un solo stream. NADIE toca kaizen_api/main.py (es de B1) ni el archivo de otro stream. Los 12 routers v2 ya están registrados en V2_ROUTERS.

GET /health                                   routers/health.py      B1
POST /auth/login, GET /auth/me                routers/auth.py        B1
GET /v2/quotes, GET /v2/fx                    routers/quotes.py      B2a
GET /v2/history/{symbol}, /v2/panel, /v2/fx/history   routers/history.py     B2a
GET /v2/markets/overview, /v2/markets/world   routers/markets.py     B2a
GET /v2/search                                routers/search.py      B2a
GET /v2/rates/mx, /v2/rates/rf                routers/rates.py       B2b
GET /v2/macro/us                              routers/macro.py       B2b   (salió de rates.py)
GET /v2/news                                  routers/news.py        B2b
GET /v2/instrument/{symbol} + /statements + /dividends   routers/research.py   B3a
GET /v2/events                                routers/events.py      B3a   (salió de markets.py)
GET /v2/insiders/{symbol}                     routers/insiders.py    B3a   (salió de screeners.py)
GET /v2/valuation/{symbol}, /v2/momentum/{symbol}        routers/valuation.py  B3b   (salió de research.py)
GET /v2/screeners/factors, /magic, /fibras    routers/screeners.py   B3c
rutas v1 del backend viejo                    routers/legacy_v1.py   O, congelado

CONGELADO bajo O (cambio solo por docs/requests/<stream>.md): schemas.py, routers/__init__.py (Symbols, SymbolPath, IsoDateQuery, parse_symbols, check_date_range y el decorador @stub), routers/legacy_v1.py, domain/__init__.py, providers/yahoo/session.py, providers/replay.py, los __init__ de paquetes y data/.gitkeep. Y fuera de kaizen_api: docs/api-v2.md, docs/overhaul/**, tests/contract/**, tests/characterization/**, tests/replay/**, tests/conftest.py, tests/goldens_legacy/**, tests/fixtures/recorded/2026-09-22/**, pyproject.toml, backend.py, Procfile, render.yaml.

NO CONGELADO, a propósito: DOS archivos de B1 que salieron de routers/__init__.py en M1, porque la tabla le encarga a B1 "códigos, Cache-Control y límites de tasa" y eso no se entrega desde un archivo congelado ajeno. Los dos se reexportan desde kaizen_api.routers, así que TÚ NO CAMBIAS NINGÚN IMPORT:
- kaizen_api/http_cache.py: CACHE_SECONDS (quotes 30, history 3600, fundamentals 21600, macro 3600, news 600, screeners 43200), cache_control(), no_store().
- kaizen_api/http_responses.py: ERROR_RESPONSES, los códigos que cada ruta de datos anuncia en OpenAPI (400, 401, 422, 500, 501, 503). B1 le agregará el 429 RATE_LIMITED cuando ponga el limitador; hoy no está porque anunciarlo sin servirlo cambiaría el OpenAPI de las 22 rutas. OJO B1: tocar este archivo SÍ cambia el OpenAPI de las 22, que es el punto. La forma del cuerpo sigue congelada en schemas.ErrorBody.
El OpenAPI no cambió ni un byte con las dos mudanzas (sha256 a028b446..., 25 operaciones, mismo orden, operationId y tags que 614714f).

=== 2. EL DÍA QUE IMPLEMENTES TU PRIMERA RUTA: DOS LÍNEAS, EN TU ARCHIVO ===
Cada ruta que todavía responde 501 lleva @stub debajo del decorador de su router. Es un DATO que leen las pruebas de contrato, no un comentario. Al implementar borras esas dos líneas juntas y agregas la capacidad:

  @router.get("/fx", response_model=FxResponse, dependencies=[cache_control("quotes")], summary="...")
  @stub                                    # <- se borra
  def fx(pair: FxPairQuery = "USDMXN") -> FxResponse:
      raise not_implemented("GET /v2/fx")  # <- y este también

  CAPABILITIES: list[str] = ["fx"]         # <- se agrega

La capacidad es la de ESA ruta, no cualquiera del router: 7 de los 12 routers sirven más de una. La lista está en kaizen_api/schemas.py::KNOWN_CAPABILITIES y el mapa ruta -> capacidad en la quinta columna de SPEC (tests/contract/test_schemas.py):
quotes, fx, search, history, panel, fx.history, rates.mx, rf.series, macro.us, markets.overview, markets.world, news, events, instrument, statements.real, dividends, valuation.multiples y valuation.dcf (para /v2/valuation basta una de las dos), momentum, screeners.factors, screeners.magic, screeners.fibras, insiders.

Si te equivocas, la prueba te lo dice por dato y SIN llamar a tu ruta (o sea, sin salir a los proveedores):
- quitaste @stub y olvidaste la capacidad -> "GET /v2/fx ya no lleva @stub pero su router no anuncia 'fx': agrégala a CAPABILITIES de kaizen_api.routers.quotes (es lo que publica /health)"
- dejaste @stub puesto y ya anunciaste la capacidad -> "kaizen_api.routers.quotes anuncia ['quotes'] pero GET /v2/quotes todavía lleva @stub: si ya la implementaste, quita esa línea (y su raise not_implemented); si no, quita la capacidad"
Puedes conservar un not_implemented(...) adentro para una rama que no soportes (por ejemplo interval=1m): el @stub es lo único que decide, así que eso ya no te convierte en stub.

=== 3. LAS PRUEBAS QUE NO TIENES QUE TOCAR ===
Cuatro archivos afirmaban cosas que dejan de ser ciertas en cuanto implementas tu primera ruta, y ninguno es tuyo. En M1 se hicieron auto ajustables:
- tests/contract/test_schemas.py: lo de arriba.
- tests/unit/test_app.py: "auth" in caps y "legacy.v1" not in caps, en vez de la lista literal.
- tests/unit/test_auth.py y tests/characterization/test_replay_server.py: piden /v2/quotes?symbols=,,, (símbolos inválidos a propósito). La respuesta es 401 sin sesión y 422 con ella, no depende de si B2a ya implementó la ruta y no ejecuta su cuerpo.
Tus pruebas van en tests/unit/<tu stream>/ (tests/unit/b2a/**, b2b, b3a, b3b, b3c). tests/unit/*.py (app, auth, caché) son de B1.

=== 4. FIXTURES EN CAPAS, RECETA POR STREAM ===
Cada stream de backend graba en SU capa, encima del set base 2026-09-22, y commitea solo su carpeta (ya está en su glob de ownership.json):

B2a  2026-09-22-b2a   python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b2a --get '/v2/quotes?symbols=AAPL'
B2b  2026-09-22-b2b   python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b2b --get '/v2/rates/mx'
B3a  2026-09-22-b3a   python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b3a --get '/v2/instrument/WALMEX.MX'
B3b  2026-09-22-b3b   python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b3b --get '/v2/valuation/AAPL'
B3c  2026-09-22-b3c   python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b3c --get '/v2/screeners/magic'

--get se repite cuantas veces haga falta: pide la ruta con TestClient y luego la vuelve a correr en replay para comprobar que se reproduce completa desde las capas. Al final revisa que ningún token del entorno (BANXICO_TOKEN, FRED_API_KEY, EODHD_API_TOKEN, SECRET_KEY) haya quedado escrito en tu capa; si aparece, sale con error y esos archivos NO se commitean.

Para correr pruebas o servidor contra tu capa:
  KAIZEN_REPLAY_SET=2026-09-22,2026-09-22-b2a .venv/bin/python -m pytest -q
  .venv/bin/python scripts/run_replay_backend.py --module kaizen_api.main --port 810X --set 2026-09-22,2026-09-22-b2a
(run_replay_backend.py también acepta --root para servir un set de borrador fuera de tests/fixtures/recorded.)

REGLAS DE LAS CAPAS:
- Al reproducir gana la PRIMERA capa que tenga la llamada. En "2026-09-22,tu-capa" la primera es la BASE, así que si una llamada está en las dos, MANDA LA BASE. Tu capa AGREGA llamadas nuevas.
- NUEVO en esta corrida: --grabar-en desacopla el orden de búsqueda del destino de la grabación, así que SÍ puedes corregir una llamada que la base ya tiene, sin pedirle nada a nadie:
    python scripts/record_fixtures.py --set 2026-09-22-b3a,2026-09-22 --grabar-en 2026-09-22-b3a --get '/v2/insiders/WALMEX.MX'
    KAIZEN_REPLAY_SET=2026-09-22-b3a,2026-09-22 .venv/bin/python -m pytest -q
  Con tu capa primero: lo que la base tiene con valor BUENO se sigue sirviendo de la base (no se vuelve a pedir sin --refresh, para no gastar llamadas); lo que la base tiene VACÍO o con ERROR sí sale al proveedor y se graba en tu capa, que a partir de ahí gana. La capa nombrada tiene que estar en --set. En la API es recording("capa,base", record_layer="capa").
- ESTO TE VA A PASAR: el set base trae 35 llamadas vacías o con error, de 432. Las que estorban:
    B3a, /v2/insiders:  yf:WALMEX.MX:insider_transactions, yf:CEMEXCPO.MX:insider_transactions, yf:FUNO11.MX:insider_transactions, yf:SPY:insider_transactions, yf:^MXX:insider_transactions
    B3a y B3c, FIBRAs:  yf:STORAGE18.MX:balance_sheet, cashflow, income_stmt
    B3a, estados:       yf:SPY:{balance_sheet,cashflow,financials,income_stmt}, yf:^MXX:{los mismos}  (son índices/ETF: probablemente esté BIEN que sigan vacías)
    B3a:                yf:CEMEXCPO.MX:institutional_holders, yf:SPY:institutional_holders, yf:^MXX:institutional_holders
    B3a, EDGAR:         http:GET https://data.sec.gov/api/xbrl/companyfacts/CIK0000884394.json
    B2b:                yf:USDMXN=X:news
    Nadie:              las 11 de ZZZNOTREAL, que es el símbolo inexistente a propósito y tiene que seguir fallando
  La lista completa y el comando para regenerarla están en docs/OWNERSHIP.md.
- Las capas que contestan ANTES que la tuya son de solo lectura, ni con --refresh se reescriben.
- Tu capa se crea sola, con su propio index.json, y HEREDA el frozen_at de la base, para que las llamadas que dependen de "hoy" den la misma llave grabando y reproduciendo. Ahora también escribe lookup_order.
- TRES GUARDAS para que nadie escriba en el set base por accidente:
  1. Un --set con coma que se quedó en una sola capa NO graba (el caso de --set "2026-09-22,$CAPA" con $CAPA sin definir). Exit 2 y mensaje en español. Leer sigue tolerante, porque leer no escribe.
  2. Grabar con el set base como capa de DESTINO pide --permitir-base, vaya al final o al principio del orden.
  3. Una capa que NO grabó ninguna llamada no se crea. Hoy tu ruta responde 501, así que tu primera corrida no graba nada y te lo dice: eso está bien. Efecto secundario: mientras tu capa no exista, no la pongas en KAIZEN_REPLAY_SET ni en --set de replay.
- Un solo set se comporta exactamente igual que antes. Nombre desconocido, inválido o repetido da error claro en español.
- Los goldens del legado (tests/goldens_legacy/) se quedan fijos en el set base: con varias capas y sin --get, record_fixtures.py exige --goldens-dir.

=== 5. COSTURAS (quién lee a quién) ===
El que ofrece la costura MANTIENE LA FIRMA ESTABLE toda la fase 2; el que la usa SOLO IMPORTA, nunca edita el archivo del otro. Cambio de firma = request al dueño antes de tocarla.

Ya existen hoy como imports reales:
  B3a domain/fundamentals.py  -> B2a domain/history.py::_fetch_hist            (beta contra benchmark local)
  B2b domain/macro.py         -> B2a domain/markets.py::_bulk_download, get_market  (VIX y DXY del mismo lote)
  B3c screeners/fibras.py     -> B3a domain/fundamentals.py::_div_yield_pct    (dividendo de cada FIBRA)
  B3c screeners/fibras.py     -> B2a domain/history.py::_fetch_hist            (precios de FIBRAs)
  B3b screeners/momentum.py   -> B3c domain/universe.py::SECTOR_ETF            (referencia por sector del 12-1)

Las estrena fase 2:
  B3b domain/valuation/**     -> B3a domain/fundamentals.py   (FCFF, deuda, acciones, sector para múltiplos)
  B3b domain/valuation/**     -> B2b domain/rates.py, rf CETES 28   (tasa libre de riesgo de CAPM y DCF)
  B3c screeners/factors.py    -> B3a domain/fundamentals.py   (factores relativos al sector)
  B3c screeners/fibras.py     -> B2b domain/rates.py, rf CETES 28   (spread de la FIBRA contra CETES)
  todos                       -> B1 cache.py, http_cache.py (Cache-Control), http_responses.py (ERROR_RESPONSES), errors.py, provenance.py, settings.py
  todos                       -> O  schemas.py, routers/__init__.py (incluido @stub), domain/__init__.py, providers/yahoo/session.py

=== 6. COMANDO DE COBERTURA ===
node scripts/check-ownership.mjs --coverage A1,A2,A3,A4,A5,B1,B2a,B2b,B3a,B3b,B3c,C1,C2,C3
Y la lista larga, que incluye fase 3 y es la que destapa traslapes que la corta no ve:
node scripts/check-ownership.mjs --coverage A1,A2,A3,A4,A5,B1,B2a,B2b,B3a,B3b,B3c,C1,C2,C3,F1,F2,F3,F4,F5
(agregar --table para ver el dueño de cada archivo de kaizen_api/)
Las dos salen en 0 hoy. Falla si algún archivo de kaizen_api/ se queda sin dueño, o si un archivo versionado, una ruta declarada o un par de globs cae en dos streams. El resto del repo sale como información, árbol por árbol. Para sacar un archivo de un glob amplio se usa "!glob": así C1 excluye src/features/dev-ui/ChartsGallery.jsx (de C2) y public/manifest.webmanifest (de F5). El modo de un stream solo, node scripts/check-ownership.mjs <stream>, sigue igual.

=== 7. SI TE FALTA ALGO ===
docs/requests/ ya existe versionada: escribe docs/requests/<tu stream>.md con {necesidad, por qué, API propuesta} y sigue trabajando alrededor. Ese archivo ya está en tus globs.
