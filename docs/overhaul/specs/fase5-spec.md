# Fase 5: lo que le faltaba al Bloomberg barato

Spec autoritativa de la fase 5, escrita el 1 de octubre de 2026. El objetivo, en palabras del dueño:
"una especie de Bloomberg para el inversionista de a pie y una alternativa barata para que las
empresas obtengan información", desarrollando lo que falta con datos gratuitos.

Cómo salió: un workflow hizo el inventario real del código (29 rutas), buscó brechas contra la
terminal Bloomberg y sus alternativas con dos lentes (inversionista de a pie y empresa chica o
mediana: 45 candidatos), probó **en vivo** 40 fuentes gratuitas, armó un backlog, lo pasó por una
crítica adversaria y lo corrigió. El orquestador recalculó cada cifra de las pruebas de respuesta
conocida (todas cuadran; se corrigieron dos: el forward con Tesoro 3M es 18.171457 y el cierre de mes
con la regla del DOF usa el FIX del 28 de septiembre).

## Reglas comunes a todos los streams (no se re-discuten)

- Contrato congelado al terminar M5: `kaizen_api/schemas.py`, `docs/api-v2.md` y
  `tests/contract/` solo cambian por pedido en `docs/requests/<stream>.md`. El orquestador aplica los
  pedidos al integrar. Si el contrato está mal, se construye contra el modelo vigente y se pide el
  cambio.
- Unidades del API v2: porcentajes, rendimientos, pesos y probabilidades como fracción; cambios de
  tasa en pb (campos que terminan en `Bp`); toda respuesta con `meta` (`asOf`, `source`, `stale`,
  `fallback`, `notes`). Un sustituto es `fallback: true` y nunca se muestra como dato vivo. Nada de
  valores fijos silenciosos.
- Nada de recomendaciones: ni calificaciones de analistas, ni precios objetivo, ni "sobrecompra" o
  "sobreventa" como señal, ni letras de calificación crediticia. Los proveedores quitan esos campos
  antes de que lleguen al dominio y una prueba lo revisa por llave.
- Toda respuesta con datos de Yahoo lleva en `meta.notes` que yfinance es para uso personal según
  los términos de Yahoo. Los datos de Yahoo, de índices S&P/BMV y de futuros NO se descargan.
- Texto visible en español de México, natural, sin guiones largos (— ni –). Faltantes como `s/d`,
  el signo menos es U+2212 en pantalla y el `%` va pegado a la cifra.
- **Fechas:** el reloj del replay es el `frozen_at` del set base (`2026-09-22T14:51:31+00:00`) y
  las capas nuevas lo heredan. Por eso toda función de dominio que dependa de "hoy" lo recibe como
  parámetro (`today`), y las pruebas de respuesta conocida con fecha del 1 de octubre de 2026 la
  pasan explícita.
- Cada stream graba sus llamadas nuevas **una vez** en su capa `2026-10-01-<stream en minúsculas>`
  con `--set 2026-09-22,2026-10-01-<stream> --grabar-en 2026-10-01-<stream>`, y revisa que ningún
  token (`BANXICO_TOKEN`, `FRED_API_KEY`, `EODHD_API_TOKEN`, `SECRET_KEY`) haya quedado escrito.
  Yahoo limita por tasa: las grabaciones a Yahoo pasan por el cupo único `yahoo` del semáforo.

## Decisiones del orquestador sobre lo que el backlog dejó abierto

1. **Regla del DOF (`rule=dof`)**: art. 20 del CFF, el tipo publicado en el DOF el día anterior a la
   fecha; si ese día no hubo publicación, el último publicado antes. La publicación en el DOF de un
   día hábil bancario trae el FIX determinado el día hábil anterior. Los días hábiles se infieren de
   las fechas con FIX en SF43718. Ejemplos: 30/09/2026 (miércoles) usa el DOF del 29/09, que trae el
   FIX del 28/09; 05/10/2026 (lunes) usa el DOF del viernes 02/10, que trae el FIX del 01/10. Sigue
   siendo decisión fiscal del dueño anunciarla: la pantalla explica la regla y no la recomienda.
2. `useFeature` se muda a `src/lib/api/useFeature.js` (la ruta vieja reexporta) para que todas las
   features lo usen.
3. Cada stream escribe sus typedefs de JSDoc en su carpeta (`src/features/<x>/types.js`); las
   funciones de `src/lib/api/endpoints.js` de la fase 5 las deja hechas M5 con parámetros validados.
4. No hay capa compartida de Banxico: M5 agrega las series al catálogo y las verifica en vivo, y
   cada stream graba las llamadas que necesita en su propia capa.
5. Glosario: cada stream escribe sus términos en `src/content/glossary-v5/<stream>.js` (mismo
   esquema que `glossary.js`, que los une). La metodología nueva va en `docs/metodologia/<guía>.md`.
   Las atribuciones del aviso legal se piden en `docs/requests/<stream>.md` y las pone O al final.
6. Dependencias entre streams: V5FX usa `/v2/expectations` y V5EM `/v2/money-market` (los dos de
   V5TS), y el resumen del día de V5TM usa endpoints de V5FX, V5EC y V5MK. Todos se construyen contra
   el contrato congelado con mocks y se validan con datos reales al integrar.
7. `/empresas` (índice que liga sus páginas leyendo la sección "Empresas" de `nav.js`) es de V5EM;
   `/empresas/tipo-de-cambio` y `/empresas/cobertura` las declara V5FX en `src/features/fx/routes.jsx`.

## Puertos y capas por stream

| Stream | Web | API | E2E_PORT | Capa |
| --- | --- | --- | --- | --- |
| V5TS | 5340 | 8120 | 5341 | 2026-10-01-v5ts |
| V5FX | 5342 | 8121 | 5343 | 2026-10-01-v5fx |
| V5EC | 5344 | 8122 | 5345 | 2026-10-01-v5ec |
| V5FI | 5346 | 8123 | 5347 | 2026-10-01-v5fi |
| V5TC | 5348 | 8124 | 5349 | 2026-10-01-v5tc |
| V5MK | 5350 | 8125 | 5351 | 2026-10-01-v5mk |
| V5PF | 5352 | 8126 | 5353 | 2026-10-01-v5pf |
| V5EM | 5354 | 8127 | 5355 | 2026-10-01-v5em |
| V5TM | 5356 | 8128 | 5357 | sin capa (solo frontend) |

Nunca 8002, 5180 ni 4180 (los del dueño).

## Funciones de la fase 5

### centro-de-tasas: Centro de tasas: curvas, mercado de dinero, expectativas y tasa real

- Stream: **V5TS**. Audiencia: ambos. Valor 5, esfuerzo L.
- Ruta: /mercados/tasas (pestañas Curvas, Mercado de dinero, Expectativas; ?pais=mx|us&pestana=). Navegación: Mercados ('Tasas y curvas'; la etiqueta 'México y tasas' pasa a 'México'). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Banxico SIE con BANXICO_TOKEN (ya en .env.local; en Render lo pone el dueño): CETES SF43936/39/42/45, Bonos M SF43883 (3A), SF43886 (5A), SF44071 (10A), SF45384 (20A), SF60696 (30A), Udibonos SF61592 (3A), SF46958 (20A), SF46961 (30A), TIIE SF43878 (91), SF111916 (182), SF331451 (fondeo), SF61745 (objetivo), inflación observada SP30578
  - Banxico SIE encuesta de especialistas con título leído en el probe: SR14138 (media inflación t), SR14139 (mediana inflación t), SR14145 (media inflación t+1), SR14447 (media PIB t), SR14770 (mediana tipo de cambio t), SR14776 y SR14777 (media y mediana tipo de cambio t+1); SR14146, SR14448 y SR14769 solo si la verificación en caliente del orquestador confirma su título
  - FRED fredgraph.csv sin llave con el User-Agent de fábrica de requests: DGS1MO, DGS3MO, DGS6MO, DGS1, DGS2, DGS5, DGS10, DGS30, DFF (dominio público con cita) y SOFR (cita obligatoria a NY Fed)
  - Tesoro de EE. UU. CSV de Daily Treasury Par Yield Curve y Real Yield Curve en home.treasury.gov (dominio público; User-Agent 'Mozilla/5.0', timeout 30 s, caché diaria) para nodos 3A, 7A, 20A y la curva real; sustituye a T10YIE
- Contrato:
  - `GET /v2/curves`. Parámetros: country=mx|us (requerido); compare=1w,1m,1y (opcional, lista).
    Respuesta: {country, nodes:[{tenorDays:int, label:'28 días'|'10 años', value:fracción, asOf:IsoDate, seriesId, instrument:'cetes'|'bonoM'|'udibono'|'ust'}], compare:{'1w'|'1m'|'1y':[{tenorDays, value:fracción, asOf}]}, real:[{tenorDays, value:fracción, asOf, seriesId}], breakeven:[{tenorDays, value:fracción (Fisher (1+n)/(1+r)-1), simpleBp:pb, nominalAsOf, realAsOf, dateGapDays:int}], meta{asOf, source:'banxico'|'fred,treasury', stale, fallback, notes}}. Cada nodo lleva su fecha porque en México cada plazo cambia solo en su subasta.
  - `GET /v2/curves/spreads`. Parámetros: history=1y|5y (opcional).
    Respuesta: {rows:[{tenorYears:int, mxSeriesId, usSeriesId, mx:fracción, us:fracción, spreadBp:pb, mxAsOf, usAsOf, dateGapDays:int, asOfMismatch:bool (true si dateGapDays > 7)}], history10y:{dates:[IsoDate], valuesBp:[pb|null]}, meta}
  - `GET /v2/money-market`. Parámetros: ninguno.
    Respuesta: {rows:[{id:'tiie91'|'tiie182'|'dff'|'sofr'|'ust1m'|'ust3m'|'ust6m'|'ust1y', label, country:'MX'|'US', value:fracción, convention:'act/360 simple'|'overnight'|'cmt base bono', asOf, change1dBp, change1wBp, change1mBp (pb o null), seriesId, source, stale}], mxChanges:[{id:MxRateId (los de /v2/rates/mx), change1wBp, change1mBp}], meta}. No repite valores que ya da /v2/rates/mx: la UI une las dos respuestas por id.
  - `GET /v2/expectations`. Parámetros: ninguno.
    Respuesta: {survey:{surveyDate:IsoDate (fecha del periodo del SIE, siempre día 01), yearT:int (año de surveyDate), items:[{id:'inflationT'|'inflationT1'|'gdpT'|'fxT'|'fxT1', label, year:int, mean, median (null si su serie no está verificada), unit:'fraction'|'mxnPerUsd', seriesIdMean, seriesIdMedian, verified:bool}]}, realRates:{cetes28:fracción, observedInflation:fracción (SP30578), exPost:fracción, expectedInflation:fracción|null (mediana inflationT), exAnte:fracción|null}, impliedForwards:{mx:[{fromDays, toDays, rate:fracción act/360 simple, vsTargetBp:pb}], us:[{fromDays, toDays, rate, vsDffBp, note:'de rendimientos cmt convertidos a act/360 con x360/365'}]}, meta{source:'banxico,fred'}}
- Pantalla: Página nueva con PageHeader, Tabs/TabPanel y SegmentedControl México o EE. UU. Curvas: TimeSeries con xType 'number' (años al vencimiento, xFormat '28 d', '10 a'), series Hoy, Hace 1 mes y Hace 1 año, puntos sin línea continua para nodos de México con fechas distintas, DataTable de nodos con DataStatus por fecha de subasta; Bars horizontal format 'bp' signed para el diferencial México menos EE. UU. por plazo con Badge 'fechas distintas' cuando asOfMismatch, TimeSeries format 'bp' del diferencial a 10 años, Stat de inflación implícita con InfoTip al glosario. Mercado de dinero: DataTable que une /v2/rates/mx y /v2/money-market con Delta kind 'bp' en día, semana y mes, agrupada por país, nota de convención por renglón y Disclaimer. Expectativas: Stat de media y mediana de la encuesta con el año calculado y 's/d' si la serie no está verificada, Stat de tasa real ex post y ex ante de CETES 28, Bars de forwards implícitos contra la tasa objetivo en pb. ApiNotes (movido a components/ui) en cada pestaña.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Diferencial 10A: Bono M 0.0935 y Tesoro 0.0526 dan spreadBp = 409.
  - Inflación implícita México 20A: Bono M 0.0964 y Udibono 0.0461 dan Fisher 1.0964/1.0461 - 1 = 0.048083 y simpleBp = 503.
  - Inflación implícita EE. UU. 10A con la curva del Tesoro: nominal 0.0529 y real 0.0293 dan 1.0529/1.0293 - 1 = 0.022928 y simpleBp = 236.
  - Forward CETES act/360: r28 = 0.07, r91 = 0.072 dan f(28,91) = ((1 + 0.072*91/360)/(1 + 0.07*28/360) - 1)*360/63 = 0.072494.
  - Conversión cmt a act/360: DGS3MO 0.0425 da 0.0425*360/365 = 0.041918.
  - Cambio en pb: TIIE 91 hoy 0.068134 contra hace una semana 0.069000 da change1wBp = -8.66.
  - Fechas distintas: Bono M 20A con asOf 2026-08-27 y Tesoro 20A con asOf 2026-09-30 dan dateGapDays = 34 y asOfMismatch = true.
  - Tasa real: CETES 0.07 e inflación 0.04 dan 1.07/1.04 - 1 = 0.028846.
  - Año de la encuesta: levantamiento con fecha SIE 2026-12-01 consultado el 2027-01-15 da yearT = 2026 e inflationT1.year = 2027; con fecha 2027-01-01 da yearT = 2027.
  - Serie no verificada: si SR14146 no pasó el candado, inflationT1.median = null, verified = false y la UI dice s/d.
  - Valor del SIE '9.35' se publica 0.0935; 'N/E' se publica null y el nodo sale s/d, nunca 0.
  - Fecha del CSV del Tesoro '09/30/2026' se normaliza a '2026-09-30' y el orden queda ascendente.
- Riesgos y decisiones:
  - Nodos de México fechados por subasta (el 20A puede tener 5 semanas): fecha por nodo y bandera asOfMismatch en el diferencial.
  - SF60696 (liquidación) y SF60691 (subasta) son el mismo 30A con fechas distintas: solo SF60696 y candado 'tasa de rendimiento' en tituloContiene.
  - Medianas SR14146, SR14448 y media SR14769 inferidas por secuencia: s/d hasta que el orquestador confirme el título.
  - Udibono 10A sin id: s/d.
  - El CSV del Tesoro tarda 18 s sin UA de navegador y FRED falla con UA de navegador: cada proveedor con su UA.
  - SOFR es 'Copyrighted: Citation Required' (NY Fed): cita en meta.notes y en el aviso legal; el dueño confirma que la cita basta para uso comercial.
  - T10YIE ya no se usa: la inflación implícita de EE. UU. sale del Tesoro, que es dominio público.
  - Sin token de Banxico la pestaña México queda en s/d salvo el Bono 10A mensual de FRED marcado fallback.

### monitor-del-peso: Monitor del peso, cruces latinoamericanos y FIX para contabilidad

- Stream: **V5FX**. Audiencia: ambos. Valor 5, esfuerzo L.
- Ruta: /mercados/tipo-de-cambio (monitor y cruces) y /empresas/tipo-de-cambio (FIX por fecha, regla del DOF, cierres de mes y conversión por lote). Navegación: Mercados ('Tipo de cambio') y Empresas ('Tipo de cambio contable'). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Banxico SIE SF43718 (FIX) leído a través de kaizen_api/domain/fx.py existente (solo lectura, de B2b), con historia larga
  - Banxico SIE cruces contra el peso: SF46410 euro, SF46406 yen, SF46407 libra, SF290383 yuan, SF60632 dólar canadiense (desde 2018-07-31)
  - Frankfurter v1 (BCE) https://api.frankfurter.dev/v1 sin llave, respaldo marcado de los cruces del SIE
  - Frankfurter v2 https://api.frankfurter.dev/v2/rates sin llave para COP, CLP, ARS, PEN y BRL contra el peso (mezcla de bancos centrales, se cita así)
  - CFTC Commitments of Traders Socrata 6dca-aqww y gpe5-46if, contrato 095741 (peso CME), sin llave
- Contrato:
  - `GET /v2/fxdesk/monitor`. Parámetros: years=1|3|5|10 (por omisión 1).
    Respuesta: {pair:'USDMXN', spot:{value, asOf, source:'banxico'}, range52w:{low, high, percentile:fracción}, changes:{d1, w1, m1, ytd, y1} en fracción, changesCents:{d1, w1, m1, ytd, y1} en centavos, realizedVol:{d20, d60, d250} anualizada en fracción, monthly:[{month:'2026-09', average, min, max, last}], histogram:[{low:fracción, high:fracción, count}], series:{dates, values}, cot:{reportDate, openInterest, nonCommercialNet, nonCommercialNetChange, leveragedNet, assetManagerNet}|null, meta}
  - `GET /v2/fxdesk/crosses`. Parámetros: ninguno.
    Respuesta: {rows:[{pair:'EURMXN'|'JPYMXN'|'GBPMXN'|'CNYMXN'|'CADMXN'|'BRLMXN'|'COPMXN'|'CLPMXN'|'ARSMXN'|'PENMXN', value:pesos por unidad, asOf, change1d:fracción|null, change1y:fracción|null, source:'banxico'|'frankfurter', provider:'banxico'|'ecb'|'mezcla', fallback:bool}], meta{notes}}
  - `GET /v2/fxdesk/fix`. Parámetros: date=YYYY-MM-DD (requerido); rule=fecha|dof (por omisión fecha).
    Respuesta: {date, rule, fixDate:IsoDate, value, dofPublicationDate:IsoDate|null, explanation:str, meta{source:'banxico', notes}}
  - `GET /v2/fxdesk/fix-table`. Parámetros: start, end (IsoDate, máximo 3 años); rule=fecha|dof; monthEnd=true|false.
    Respuesta: {rule, rows:[{date, fixDate, value}], monthEnds:[{month, fixDate, value, average}], meta}
- Pantalla: Monitor: PageHeader, Stat del FIX con Delta en centavos y DataStatus, Stat de rango 52 semanas con percentil, SegmentedControl 1/3/5/10 años sobre TimeSeries (format 'money'), Bars vertical del histograma de movimientos diarios, DataTable de cruces (canasta del SIE y latinoamericanos) con fuente y fallback visibles, DataTable de promedios mensuales, Card de posicionamiento CFTC con Bars signed. Contable: Field de fecha y SegmentedControl 'Fecha del FIX' o 'Regla del DOF (art. 20 CFF)', Stat con la explicación textual del FIX usado, DataTable de cierres de mes, Dialog de conversión por lote que reusa parseCSV y downloadBlob de src/lib/csv.js (solo lectura) y descarga el CSV con tipo de cambio y monto en pesos.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Percentil 52 semanas = fracción de observaciones menores o iguales al actual: ventana [17, 18, 19, 20] y actual 19 da 0.75.
  - Volatilidad realizada: cierres [100, 101, 99, 102, 103], rendimientos logarítmicos, desviación n-1, por raíz de 252 = 0.326231.
  - Cambio en centavos con FIX de prueba: 18.2500 contra 18.1000 = +15.00 centavos y +0.008287 en fracción.
  - Regla DOF, con días hábiles = fechas presentes en SF43718: pago el lunes 2026-10-05 usa la publicación del viernes 2026-10-02, que trae el FIX del jueves 2026-10-01; pago el miércoles 2026-10-07 usa el FIX del lunes 2026-10-05.
  - Cierre de septiembre de 2026: con rule=fecha fixDate = 2026-09-30; con rule=dof (art. 20 CFF: el tipo publicado en el DOF el día anterior) el tipo aplicable el 30/09 es el publicado en el DOF del 29/09, que trae el FIX determinado el lunes 2026-09-28, o sea fixDate = 2026-09-28.
  - Lote: 1,000 USD con fecha 2026-10-05, rule=dof y FIX de prueba del 2026-10-01 de 18.30 dan 18,300.00 MXN.
  - CFTC neto no comerciales: largos 127595 y cortos 52428 dan +75167; semana previa +87782 da cambio -12615.
  - Frankfurter v2 con base MXN y COP 183.12 se publica COPMXN = 1/183.12 = 0.005461; las filas de sábado y domingo (2026-09-26 y 2026-09-27) se descartan.
  - Cruce con 'N/E' del SIE (dólar canadiense el 30/09) toma el último valor válido o cae a Frankfurter v1 con fallback = true; nunca 0.
- Riesgos y decisiones:
  - La regla del DOF es decisión fiscal abierta del dueño: la pantalla la explica y el dueño la valida antes de anunciarla; SF60653 no se probó, se deriva de SF43718.
  - Días inhábiles bancarios: se infieren de las fechas con FIX publicado, no de holidays_bmv.json; para fechas futuras la respuesta dice que aún no hay FIX.
  - Frankfurter v1 es referencia del BCE y v2 una mezcla de proveedores, distintas del FIX: siempre con su fuente y marca de respaldo.
  - Cruces del SIE solo desde 2018.
  - CFTC devuelve números como texto y fecha flotante: normalizar en el proveedor.

### forward-y-presupuesto-usd: Forward teórico USD/MXN y presupuesto en dólares

- Stream: **V5FX**. Audiencia: empresa. Valor 5, esfuerzo M.
- Ruta: /empresas/cobertura. Navegación: Empresas ('Forward y presupuesto'). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Banxico SIE SF43718 (FIX, vía domain/fx.py), SF43783, SF43878, SF111916 (TIIE 28, 91, 182), SF331451 (fondeo), CETES SF43936/39/42/45
  - FRED fredgraph.csv sin llave: DGS1MO, DGS3MO, DGS6MO, DGS1, SOFR
  - Encuesta Banxico SR14770 y SR14777 a través del contrato congelado /v2/expectations de V5TS
- Contrato:
  - `GET /v2/fxdesk/forward`. Parámetros: days=30,91,182,365 o date=YYYY-MM-DD; mxn=tiie|cetes|fondeo; usd=ust|sofr.
    Respuesta: {spot:{value, asOf}, rows:[{days, date, iMxn:fracción, iUsd:fracción, iMxnSeries, iUsdSeries, iMxnConvention:'act/360 simple'|'overnight plano', iUsdConvention:'cmt convertida x360/365'|'overnight plano', forward, pointsPips:float, carryAnnual:fracción}], meta{source:'banxico,fred', notes:['precio teórico sin margen bancario', convenciones de cada tasa]}}
- Pantalla: DataTable por plazo con forward, puntos y costo anualizado, SegmentedControl de referencia en pesos y en dólares con la convención visible, Stat del spot con DataStatus, Disclaimer 'precio teórico, no es cotización ni sugerencia de cubrirse'. Presupuesto (cálculo en el navegador, src/features/fx/lib/budget.js): Field de tipo de cambio presupuestal y NumberInput de flujos por mes, TimeSeries del forward contra el presupuesto, Stat del percentil histórico del nivel presupuestal (descriptivo), Bars del impacto en pesos por cada 50 centavos y 1 peso, Stat de la mediana de la encuesta Banxico con su año.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Paridad: S = 18.00, iMXN = 0.08, iUSD = 0.04, 90 días dan F = 18.00*(1 + 0.08*90/360)/(1 + 0.04*90/360) = 18.178218, puntos 1782.18 y costo anualizado (F/S - 1)*360/90 = 0.039604.
  - Con usd=ust, DGS3MO 0.0425 se convierte a 0.041918 y con S = 18.00, iMXN = 0.08 y 91 días da F = 18.171457.
  - Percentil del presupuesto: nivel 19.00 contra la ventana [17, 18, 19, 20] = 0.75.
  - Impacto: flujo de 100,000 USD con choque de +0.50 MXN = +50,000 MXN.
  - Plazo de 0 días y plazo mayor a 365 se rechazan con 400 INVALID_PARAM.
- Riesgos y decisiones:
  - Term SOFR de CME no es gratuito: SOFR overnight se aplica plano a todos los plazos y se dice en notes; lo mismo con fondeo.
  - Se quitó la probabilidad lognormal de rebasar el presupuesto: se leía como pronóstico y bordeaba la regla de no sugerir coberturas.
  - Supuestos de CGPE de SHCP no probados: s/d.
  - Depende de /v2/expectations de V5TS: contrato congelado en prep; si cambia, se pide por docs/requests.

### calendario-economico: Calendario económico de México y EE. UU.

- Stream: **V5EC**. Audiencia: ambos. Valor 5, esfuerzo M.
- Ruta: /mercados/calendario (?semana=AAAA-MM-DD&pais=mx,us). Navegación: Mercados ('Calendario'). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Banxico: PDF del calendario de política monetaria 2026 (8 decisiones a las 13:00, minutas, informes trimestrales) transcrito a kaizen_api/data/calendar_banxico.json
  - Reserva Federal: calendario FOMC 2026 y 2027 transcrito a kaizen_api/data/calendar_fomc.json, con marca de proyecciones
  - INEGI: cal_2026.pdf y cal_2027.pdf (06:00 hora del centro) para IGAE, PIB, PIB oportuno, INPC quincenal y mensual, ENOE, transcrito a kaizen_api/data/calendar_inegi.json
  - BLS ICS https://www.bls.gov/schedule/news_release/bls.ics con User-Agent descriptivo con correo, caché diaria
  - Dato anterior y publicado: Banxico SIE SP30578, SF61745 y FRED sin llave CPIAUCSL, CPILFESL, UNRATE, PAYEMS, A191RL1Q225SBEA, PCEPILFE, DFF
- Contrato:
  - `GET /v2/calendar/economic`. Parámetros: start, end (IsoDate, máximo 90 días); country=mx,us.
    Respuesta: {events:[{id, country:'MX'|'US', kind:'decision'|'minutes'|'release'|'report', title, period:'sep 2026'|null, date:IsoDate, timeLocal:'HH:MM' (America/Mexico_City), datetimeUtc, source:'curated'|'bls', seriesId|null, unit:'fraction'|'index'|'thousandsPersons'|null, previous:number|null, actual:number|null, consensus:null}], coverage:{banxicoUntil, fomcUntil, inegiUntil, blsUntil}, nextDecisions:{banxico:{date, daysLeft}, fed:{date, daysLeft}}, meta}
- Pantalla: Agenda semanal con SegmentedControl Semana o Mes y filtro de país, lista por día en Card con Badge de tipo y país, anterior y publicado con Money o Delta según la unidad, consenso 's/d' con InfoTip (las fuentes de consenso son de pago), Stat de cuenta regresiva a Banxico y a la Fed, aviso de hasta dónde cubre cada calendario, y 'Agregar a mi calendario' que arma un .ics en el navegador (src/features/economy/lib/ics.js) y lo baja con downloadBlob de src/lib/csv.js (tipo text/calendar).
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Próxima decisión de Banxico desde 2026-10-01: 2026-11-05 a las 13:00, daysLeft = 35.
  - Próxima decisión de la Fed desde 2026-10-01: 2026-10-28 (segundo día de la reunión 27 y 28), 14:00 ET = 12:00 hora del centro.
  - CPI de 2026-10-14 08:30 ET (UTC-4) se muestra 06:30 hora del centro; CPI de 2026-11-10 08:30 ET (UTC-5) se muestra 07:30.
  - Exportar .ics: decisión 2026-11-05 13:00 hora del centro produce DTSTART:20261105T190000Z.
  - Inflación de EE. UU.: índices 110 y 100 a 12 meses dan actual = 0.10.
  - Nómina no agrícola: PAYEMS 159075 contra 158953 da +122 (miles de personas).
  - Pedir 2027-03-01 a 2027-03-31 con Banxico sin publicar devuelve coverage.banxicoUntil = '2026-12-17' y ningún evento inventado.
- Riesgos y decisiones:
  - Calendarios de INEGI y Banxico solo en PDF: transcripción a mano con revisión semestral y prueba @pytest.mark.live opcional.
  - Calendario de Banxico 2027 sin publicar: coverage lo dice y la UI lo avisa.
  - BLS da 403 sin User-Agent con contacto.
  - IGAE y demás de INEGI sin token: previous y actual en s/d (el token gratuito lo saca el dueño).
  - Banxico se reserva decisiones fuera de calendario: nota fija.

### tablero-economia: Tablero de economía de México y EE. UU. con comparador de países

- Stream: **V5EC**. Audiencia: ambos. Valor 4, esfuerzo M.
- Ruta: /mercados/economia (?pais=mx|us) con sección 'Comparar países'. Navegación: Mercados ('Economía'). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - FRED sin llave: CPIAUCSL, CPILFESL, PCEPILFE, UNRATE, PAYEMS, GDPC1, A191RL1Q225SBEA, DCOILWTICO
  - FRED espejos OCDE de México marcados como tales: LRHUTTTTMXM156S (desempleo), NGDPRSAXDCMXQ (PIB real)
  - Banxico SIE: SP30578 y SP74662 (inflación anual ya en fracción tras dividir entre 100), SE27803 (remesas), SF43707 (reserva internacional)
  - Banco Mundial API v2 sin llave, CC BY 4.0: NY.GDP.MKTP.CD, NY.GDP.MKTP.KD.ZG, FP.CPI.TOTL.ZG, GC.DOD.TOTL.GD.ZS
- Contrato:
  - `GET /v2/macro/indicators`. Parámetros: country=mx|us; years=5|10|max.
    Respuesta: {country, indicators:[{id:'inflation'|'coreInflation'|'pceCore'|'unemployment'|'payrolls'|'gdpReal'|'gdpGrowth'|'remittances'|'reserves'|'wti', label, kind:'rate'|'level', unit:'fraction'|'index'|'thousandsPersons'|'usdMillions'|'mxnMillions2018'|'usdBillionsChained2017'|'usdPerBarrel', frequency:'monthly'|'quarterly'|'weekly'|'daily', last:{date, value}, previous:{date, value}, changeYoY:fracción|null (solo kind 'level'), changeYoYBp:pb|null (solo kind 'rate'), history:{dates, values}, seriesId, source, fallback, stale, nextRelease:IsoDate|null}], meta}
  - `GET /v2/macro/world`. Parámetros: countries=MEX,USA,BRA (por omisión; hasta 10); indicators=gdpUsd,gdpGrowth,inflation,debt.
    Respuesta: {rows:[{country, name, indicator, unit:'usd'|'fraction', year:int, value|null}], meta{source:'worldbank', notes:['CC BY 4.0']}}
- Pantalla: Rejilla de Card por indicador con Stat (último y Delta anual en pb para tasas o en fracción para niveles), Sparkline de 5 años y próxima publicación tomada del calendario; al abrir uno, TimeSeries larga con 'Ver tabla'. SegmentedControl México o EE. UU. Comparador de países con DataTable y Bars horizontales con el formato que indica unit. IGAE, empleo IMSS e INPC quincenal como 's/d' con InfoTip 'requiere token gratuito de INEGI que el dueño puede sacar'.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Inflación anual de un índice (CPIAUCSL): 110 contra 100 doce meses antes = 0.10.
  - SP30578 '3.76' se publica 0.0376 y NO se le vuelve a calcular la variación anual.
  - Desempleo 0.041 a 0.045 da changeYoYBp = +40 y changeYoY = null.
  - PIB trimestral anualizado: GDPC1 101 contra 100 = 1.01^4 - 1 = 0.040604.
  - Remesas: 5,452.3367 contra 5,000 da changeYoY = 0.090467; el parser quita la coma de miles.
  - A191RL1Q225SBEA '2.2' se publica 0.022 sin volver a anualizar.
  - Serie OCDE con último dato de más de 18 meses (MEXCPIALLMINMEI) se rechaza con stale y no se muestra.
  - Banco Mundial con null (inflación de EE. UU. 2025) sale 's/d' y cada fila trae unit.
- Riesgos y decisiones:
  - Espejos OCDE con 2 meses o más de rezago y series muertas: revisar la fecha del último dato.
  - Banco Mundial exige atribución CC BY 4.0 en página y aviso legal.
  - Se quitaron MORTGAGE30US (permiso de Freddie Mac) e IRLTLT01MXM156N (duplica SF44071, queda solo como respaldo existente).
  - No usar FMI DataMapper ni las series ICE de FRED.

### agenda-y-temporada-de-reportes: Agenda de reportes y dividendos: mi portafolio y todo el mercado

- Stream: **V5PF**. Audiencia: inversionista. Valor 5, esfuerzo M.
- Ruta: /portafolio/agenda (pestañas 'Mi portafolio y lista' y 'Temporada de reportes', ?universo=mx|us). Navegación: Portafolio ('Agenda'). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Yahoo vía yfinance Ticker.calendar (fecha de reporte, Earnings Average, Low y High, ex dividendo y pago), ya en kaizen_api/domain/events.py y cubierto por el replay
  - Historia de dividendos con kaizen_api/providers/yahoo/fundamentals.get_dividends (solo lectura)
  - Universos kaizen_api/data/universe_mx.json (23) y universe_us.json (38)
- Contrato:
  - `GET /v2/events`. Parámetros: symbols= (hasta 50, existente).
    Respuesta: Igual que hoy (amount conserva su significado y sigue null) más aditivos: EventItem.estimateLow y estimateHigh opcionales; EventsResponse.dividendSummary:[{symbol, currency, lastPaidAmount, lastPaidDate, frequency:'mensual'|'trimestral'|'semestral'|'anual'|'irregular'|null, paidMonths:[int]}]; meta.notes explica que el monto futuro no se conoce.
  - `GET /v2/events/season`. Parámetros: universe=mx|us; days=30|60|90.
    Respuesta: {universe, events:[{symbol, name, date:IsoDate, kind:'earnings', estimateAvg, estimateLow, estimateHigh, currency}], missing:[{symbol, reason}], universeSize:int, meta{stale, notes:['muestra curada de N emisoras']}}
- Pantalla: Página nueva con Tabs. Mi portafolio y lista: lista por mes en Card con Badge del tipo de evento y liga a la ficha, DataTable de próximos 90 días con filtro Portafolio, Lista o Ambos, y Bars vertical (format 'money') de ingresos por dividendos proyectados por mes, calculada en el navegador con posiciones de src/lib/finance/ledger.js, dividendSummary y dividendWithholding de tax-mx.js; el monto se etiqueta 'último pagado'. Temporada: SegmentedControl México o EE. UU. y DataTable por fecha con el estimado y su rango, EmptyState si no hay reportes en la ventana.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - 100 títulos con último dividendo trimestral de 0.50 MXN proyectan 4 pagos de 50 = 200 MXN al año y 180 netos con retención de 10 %.
  - Pagos en ene, abr, jul y oct de los últimos 2 años dan frequency 'trimestral' y paidMonths [1, 4, 7, 10].
  - Emisora sin dividendos aparece en reportes con proyección 0 y 's/d'.
  - Fecha de reporte de WALMEX con hora genérica de Nueva York se publica solo como fecha.
  - Temporada: si 1 de 23 emisoras falla, sale en missing con su motivo y las demás se ordenan por fecha ascendente.
  - Emisora del SIC con dividendo de 0.25 USD y FIX de prueba 18.00 proyecta 4.50 MXN por título por pago y lo dice.
- Riesgos y decisiones:
  - Se quitó el campo analysts de /v2/events: Ticker.calendar no lo trae y pedirlo costaría 50 llamadas extra; vive en /v2/earnings.
  - Temporada sobre universos curados (23 y 38): se presenta como muestra; Ticker.calendar por símbolo con caché de 12 h.
  - Consenso de UPA con 2 a 4 analistas en la BMV.
  - yfinance es para uso personal según Yahoo: riesgo comercial del dueño.

### etf-por-dentro-y-rayos-x: ETF por dentro y rayos X del portafolio

- Stream: **V5PF**. Audiencia: inversionista. Valor 5, esfuerzo M.
- Ruta: sección 'Qué tiene adentro' de /investigar/:symbol para ETF y /portafolio/rayos-x. Navegación: Portafolio ('Rayos X') e Investigar (dentro de la ficha). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Yahoo vía yfinance Ticker.funds_data (top_holdings, sector_weightings, asset_classes, fund_overview, fund_operations), una llamada por fondo, cubierto por el replay
  - kaizen_api/data/sic_etf_map.json curado (IVVPESO.MX a IVV y similares) con fuente y fecha; NAFTRAC y ETF de la BMV en s/d
- Contrato:
  - `GET /v2/funds/{symbol}`. Parámetros: ninguno.
    Respuesta: {symbol, mappedFrom:str|null, name, family, category, legalType, expenseRatio:fracción, totalNetAssets:number|null, totalNetAssetsUnit:'usdMillions'|null, turnover:fracción|null, assetClasses:{stock, bond, cash, other} fracciones, sectors:[{sector (español), weight}], topHoldings:[{symbol, name, weight}], coverage:{topHoldingsWeight:fracción}, meta}; 404 NOT_FOUND con details.reason 'sin datos de fondo' para NAFTRAC.MX.
- Pantalla: Sección lazy para ETF con Stat de comisión, activos y rotación, Donut de clases de activo, Bars de sectores y DataTable de las 10 principales con liga a la ficha. Rayos X (cálculo en el navegador, src/features/funds/lib/lookthrough.js): exposición por sector y emisora sumando acciones directas y el interior de cada ETF, con cobertura visible ('cubre 62 % del portafolio'), Heatmap de traslape entre ETF (format 'pct') y Bars de sectores.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Exposición sectorial: 50 % SPY (tecnología 0.3869) y 50 % QQQ (0.5915) = 0.4892.
  - Traslape SPY con QQQ sobre las 10 principales = suma de mínimos; si comparten NVDA 0.0808, AAPL 0.0703 y MSFT 0.0569 con pesos iguales o mayores en QQQ, traslape >= 0.2080.
  - AAPL directa 10 % más 50 % SPY con AAPL 0.0703 da exposición 0.13515.
  - equity_holdings 'Price/Earnings' 0.04035 es rendimiento de utilidades: P/U = 1/0.04035 = 24.78.
  - El Category Average copiado de Total Net Assets se descarta; si la unidad no se verificó contra un fondo conocido, totalNetAssets sale null.
- Riesgos y decisiones:
  - Solo 10 posiciones principales: el traslape es cota inferior y se dice.
  - ETF de la BMV sin datos en Yahoo; el mapeo del SIC es curado.
  - Total Net Assets sin unidad clara: se publica solo si coincide con el AUM conocido de SPY.
  - Proveedor propio kaizen_api/providers/yahoo/funds.py para no tocar fundamentals.py de B3a.

### ficha-resultados-tenencia-directivos: Ficha: resultados contra estimado, tenencia, directivos y recompras

- Stream: **V5FI**. Audiencia: inversionista. Valor 4, esfuerzo M.
- Ruta: secciones nuevas de /investigar/:symbol (Resultados, Tenencia, Directivos, Acciones en circulación). Navegación: Investigar (dentro de la ficha). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Yahoo vía yfinance Ticker.earnings_history, earnings_estimate, revenue_estimate, eps_trend, eps_revisions y get_earnings_dates (cubiertos por el replay)
  - Yahoo vía yfinance Ticker.major_holders, institutional_holders, mutualfund_holders
  - Yahoo vía yfinance Ticker.get_shares_full y splits
  - SEC EDGAR Form 4 ya implementado en /v2/insiders (sin consumidor hoy)
  - Cierres diarios de /v2/history para la reacción al reporte
- Contrato:
  - `GET /v2/earnings/{symbol}`. Parámetros: ninguno.
    Respuesta: {symbol, currency, history:[{quarterEnd:IsoDate, reportDate:IsoDate|null, epsActual, epsEstimate, surprise:fracción, reactionNextDay:fracción|null}], estimates:[{period:'0q'|'+1q'|'0y'|'+1y', epsAvg, epsLow, epsHigh, analysts:int, revenueAvg, growth:fracción}], trend:[{period, current, d7, d30, d60, d90}], revisions:[{period, up7, down7, up30, down30}], nextReport:{date, epsAvg, analysts}|null, meta}. Sin precios objetivo ni calificaciones.
  - `GET /v2/holders/{symbol}`. Parámetros: ninguno.
    Respuesta: {insidersPct, institutionsPct, institutionsFloatPct (fracciones), institutionsCount, institutions:[{holder, pct, shares, value, currency, dateReported, pctChange:fracción}], funds:[igual], coverageNote:str|null, meta}
  - `GET /v2/shares/{symbol}`. Parámetros: start=YYYY-MM-DD (por omisión 3 años atrás).
    Respuesta: {symbol, sharesOutstanding:{dates, values}, change:fracción|null (primero contra último), splits:[{date:IsoDate, ratio:float}], meta}
- Pantalla: Secciones lazy en src/features/company/sections/*.jsx: Resultados con DataTable de 4 trimestres (Delta de sorpresa y reacción), Bars signed de sorpresas, Stat del próximo reporte con número de analistas y tabla de tendencia; Tenencia con Donut (directivos, instituciones, resto), DataTable de instituciones y fondos y aviso para la BMV; Directivos con DataTable de /v2/insiders y Stat neto 6 y 12 meses solo de mercado abierto; Acciones en circulación con TimeSeries y Stat de cambio en 3 años y lista de splits. Cada sección cae sola con ErrorState y 's/d'.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Sorpresa: real 2.02 y estimado 1.89 dan (2.02 - 1.89)/|1.89| = 0.068783.
  - Surprise(%) de get_earnings_dates '6.74' se normaliza a 0.0674; surprisePercent de earnings_history ya es fracción y no se divide.
  - Reacción: cierre del día hábil siguiente 230 contra cierre previo 220 = 0.045455.
  - Ninguna llave de las respuestas contiene Firm, ToGrade, FromGrade, Action, rating ni target: una prueba lo revisa.
  - WALMEX.MX: insidersPct 0.718 sale con coverageNote 'incluye a la controladora y no cuenta Afores ni fondos mexicanos'.
  - Acciones de AAPL: 16,526,300,160 a 14,594,180,000 da change = -0.116912; dos puntos con la misma fecha conservan el último.
  - Split de AAPL del 2020-08-31 sale {date:'2020-08-31', ratio:4.0} sin hora.
- Riesgos y decisiones:
  - Precios objetivo y calificaciones prohibidos: se quitan en el proveedor kaizen_api/providers/yahoo/analysis.py.
  - get_earnings_dates raspa HTML (lento y frágil): caché de 24 h y reportDate null si falla.
  - Cobertura de analistas en la BMV de 2 a 4: muchos 's/d'.
  - Tenencia de emisoras mexicanas solo cuenta a quien reporta a la SEC.
  - yfinance para uso personal según Yahoo.

### documentos-regulatorios: Documentos regulatorios de la emisora (10-K, 10-Q, 8-K, 20-F, 6-K)

- Stream: **V5FI**. Audiencia: ambos. Valor 4, esfuerzo S.
- Ruta: sección 'Documentos' de /investigar/:symbol. Navegación: Investigar (dentro de la ficha). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - SEC EDGAR submissions https://data.sec.gov/submissions/CIK##########.json con el User-Agent con contacto de kaizen_api/providers/sec_edgar.py, vía la función pública submissions(cik) que agrega el orquestador
  - kaizen_api/data/sec_adr_map.json curado: clave BMV a ticker del ADR (CEMEXCPO.MX a CX y similares), resuelto a CIK con company_tickers.json que ya usa la búsqueda
- Contrato:
  - `GET /v2/filings/{symbol}`. Parámetros: forms=10-K,10-Q,8-K,20-F,6-K,SC 13D,SC 13G,DEF 14A (por omisión 10-K,10-Q,8-K,20-F,6-K); limit=1..50.
    Respuesta: {symbol, cik, viaAdr:str|null, filings:[{form, formLabel (español), filedAt:IsoDate, reportDate:IsoDate|null, items:[{code:'2.02', label}], url:https}], meta{source:'sec', notes}}; emisora sin CIK ni ADR: 404 NOT_FOUND con details.reason 'sin CIK' y la UI dice s/d.
- Pantalla: Sección lazy con SegmentedControl de tipo (Todos, Anuales, Trimestrales, Eventos), DataTable con fecha, tipo explicado, eventos del 8-K como Badge y liga externa con InlineLink; para emisoras mexicanas con ADR, nota 'documentos de su ADR ante la SEC, en inglés'; EmptyState si no hay CIK (BMV y BIVA no tienen API).
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Liga: CIK 320193, accession 0000320193-26-000020 y documento aapl-20260627.htm dan https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm.
  - 8-K con items '2.02,9.01' produce 'Resultados de operación y situación financiera' y 'Estados financieros y anexos'.
  - Código de 8-K desconocido conserva el código y etiqueta 's/d'; un 6-K sin items da items = [].
  - CIK en la URL de submissions con 10 dígitos y ceros; en Archives sin ceros.
  - Con un company_tickers de prueba {CX: 1234567} y el mapa {'CEMEXCPO.MX':'CX'}, la respuesta trae cik '0001234567' y viaAdr 'CX'; 'XXXX.MX' fuera del mapa da 404 con reason 'sin CIK'.
- Riesgos y decisiones:
  - Acceso justo de la SEC: 10 por segundo y User-Agent con contacto, ya resuelto en el proveedor.
  - El mapa de ADR es curado y no se probó en vivo para cada emisora: se valida grabando las fixtures.
  - 'recent' trae solo 1000 documentos; suficiente.

### grafica-tecnica: Gráfica técnica con velas, volumen, intradía e indicadores

- Stream: **V5TC**. Audiencia: inversionista. Valor 5, esfuerzo L.
- Ruta: pestaña 'Gráfica' de /investigar/:symbol (?rango=1d|5d|1mo|6mo|1y|5y|max&ind=sma50,sma200,rsi). Navegación: Investigar (dentro de la ficha). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Yahoo vía yfinance Ticker.history con Open, High, Low, Close, Volume en 1d, 1wk y 1mo e intradía 5m (hasta 60 días) y 1h (hasta 730 días), BMV con 20 min de retraso, cubierto por el replay
  - Serie de referencia ^MXX, ^GSPC o SPY por la misma vía
- Contrato:
  - `GET /v2/ohlc/{symbol}`. Parámetros: range=OhlcRange '1d'|'5d'|'1mo'|'6mo'|'1y'|'5y'|'max'; interval=OhlcInterval '5m'|'1h'|'1d'|'1wk'|'1mo' (combinaciones inválidas con 400); compare=^MXX|^GSPC|SPY (opcional).
    Respuesta: {symbol, currency, interval, timezone, adjustment:'splits', bars:[{t, o, h, l, c, v}] donde t es IsoDate en 1d, 1wk y 1mo e Instant con zona en 5m y 1h, compare:{symbol, points:[{t, c}]}|null, high52w, low52w, meta{delayMinutes, stale}}
- Pantalla: Componente nuevo src/components/charts/Candles.jsx con candles.css propio (velas, volumen abajo, cruceta por teclado y 'Ver tabla' como TimeSeries, tokens --up y --down) dentro de ChartFrame; capas de medias de 50 y 200, EMA, Bollinger y panel de RSI o MACD calculados en src/lib/finance/technical.js; SegmentedControl de rango, Popover de indicadores (exportado al barril en prep), base 100 contra la referencia con TimeSeries, Stat de máximo y mínimo de 52 semanas, y pestaña de estadísticas con Heatmap de rendimiento por mes y año (format 'pct') y DrawdownChart. Texto descriptivo de cada indicador, sin señales.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - SMA de 3 sobre [1, 2, 3, 4, 10] = [null, null, 2, 3, 5.666667].
  - EMA de 3 sembrada con la SMA, alfa 0.5, sobre [1, 2, 3, 4, 10] = [null, null, 2, 3, 6.5].
  - RSI de Wilder con n = 2 sobre [10, 11, 10, 12]: 50 y luego 83.333333.
  - Bollinger (3, 2) sobre [1, 2, 3] con desviación poblacional: media 2, superior 3.632993 e inferior 0.367007.
  - MACD (12, 26, 9) de una serie constante es 0 en todos sus puntos.
  - Rendimiento mensual: cierre de enero 100 y de febrero 110 da 0.10 en febrero.
  - interval=5m con range=1y responde 400 INVALID_PARAM; interval=1d devuelve t '2026-09-30' e interval=5m devuelve t con desfase '-06:00' para WALMEX.MX.
  - La primera vela de la BMV con volumen 0 se conserva pero no entra en el promedio de volumen.
- Riesgos y decisiones:
  - Sin lenguaje de sobrecompra o sobreventa como señal: zonas descritas con números y prueba de copy.
  - Velas ajustadas solo por splits, a diferencia de la línea ajustada por dividendos de hoy: se explica.
  - OHLC en 1wk y 1mo no se probó en vivo (el probe cubrió intradía): se graba y revisa primero.
  - Los valores de ^MXX y ^GSPC son de S&P DJI y BMV con licencia comercial, además de Yahoo personal: decisión del dueño, sin descarga.
  - Candles lazy, axe y contraste en los dos temas; golden scripts/golden/technical_golden.py contra pandas.

### movimientos-amplitud-y-mapa: Las que más se mueven, amplitud y mapa del mercado por sector

- Stream: **V5MK**. Audiencia: inversionista. Valor 4, esfuerzo M.
- Ruta: /mercados/movimientos (?mercado=mx|us&tipo=suben|bajan|operadas). Navegación: Mercados ('Movimientos del día'). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Yahoo vía yfinance yf.screen: predefinidos day_gainers, day_losers, most_actives (EE. UU.) y EquityQuery region='mx' con volumen mínimo, filtrado contra universe_mx.json, fibras_mx.json y symbols_mx.json (requiere el replay extendido en prep)
  - Yahoo vía yf.download (cubierto por el replay) de los universos curados universe_mx.json y universe_us.json para amplitud y mapa de la BMV, y de los 11 ETF sectoriales SPDR
- Contrato:
  - `GET /v2/movers`. Parámetros: market=us|mx; kind=gainers|losers|active; limit=10..50.
    Respuesta: {market, kind, rows:[{symbol, name, price, currency, change, changePct:fracción, volume, avgVolume3m, relVolume, marketCap|null, high52w, low52w, note:str|null}], excluded:[{symbol, reason}], meta{delayMinutes:0|20}}
  - `GET /v2/breadth`. Parámetros: market=us|mx.
    Respuesta: {market, universe:'curado', universeSize:int, up, down, unchanged, upDownRatio:float|null, pctAbove200d:fracción|null, newHighs52w, newLows52w, meta{notes:['amplitud de una muestra de N emisoras, no de todo el mercado']}}
  - `GET /v2/sectors`. Parámetros: market=us|mx.
    Respuesta: {market, rows:[{sector (español), etf|null, changes:{d1, w1, m1, ytd, y1} fracción, members:[{symbol, name, changes:{d1, w1, m1, ytd, y1}}]|null}], meta{source:'yahoo', notes}}. us: ETF SPDR; mx: emisoras de universe_mx agrupadas por sector con promedio simple.
- Pantalla: Página nueva con SegmentedControl México o EE. UU. y Suben, Bajan o Más operadas, DataTable con onRowClick a la ficha, Delta y volumen relativo; Card de amplitud con Stat (suben contra bajan, por ciento arriba de su media de 200 días, máximos y mínimos de 52 semanas) que dice el tamaño de la muestra; mapa por sector con Heatmap (renglones sectores o emisoras agrupadas por sector, columnas día, semana, mes, año corrido y año, format 'pct'). Liga desde el panorama.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - regularMarketChangePercent 18.06 se publica 0.1806.
  - El proveedor reordena por changePct: entrada 1.60, -0.27, 1.38 sale 1.60, 1.38, -0.27 en 'suben'.
  - Amplitud: 30 suben, 10 bajan y 5 sin cambio dan upDownRatio 3.0; 27 de 45 arriba de su media de 200 días = 0.60.
  - Filtro México: DIABLOI10.MX, MTP703E-BC092.MX e IVVPESOISHRS.MX quedan en excluded; FUNO11.MX sale con el nombre de fibras_mx.json, no 'BANCO ACTINVER SA'.
  - Cambio de -84 % lleva note 'cambio atípico; revisar eventos corporativos' y no afirma una escisión.
  - Sector de la BMV con miembros +0.01, +0.02 y -0.03 en el día da d1 = 0.0.
- Riesgos y decisiones:
  - yf.screen no pasa por el replay: el orquestador extiende tests/replay/session.py antes del stream.
  - Predefinidos fijos a EE. UU. y capitalización de 2 mil millones o más.
  - Amplitud sobre muestras curadas (23 y 38): se dice en la UI y en notes.
  - Los 11 ETF SPDR por yf.download no se probaron: mismo mecanismo que download_closes, se graba primero.
  - yfinance para uso personal según Yahoo; sin descarga.

### actualizacion-y-referencias: Actualización por INPC, recargos, UMA y salario mínimo

- Stream: **V5EM**. Audiencia: empresa. Valor 5, esfuerzo M.
- Ruta: /empresas/actualizacion y /empresas/referencias. Navegación: Empresas ('Actualización e INPC', 'Valores de referencia'). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Banxico SIE INPC mensual vía /v2/rates/mx/inpc (existente) y UDI SP68257
  - kaizen_api/data/mx_reference.json curado y transcrito de la publicación oficial con liga y fecha de vigencia: UMA (INEGI, DOF de enero), salario mínimo general y de la Zona Libre de la Frontera Norte (DOF, CONASAMI) y tasa mensual de recargos de la Ley de Ingresos de cada año
- Contrato:
  - `GET /v2/reference/mx`. Parámetros: ninguno.
    Respuesta: {uma:[{year, daily, monthly, annual, validFrom, sourceUrl}], minimumWage:[{year, general, border, validFrom, sourceUrl}], surchargeMonthly:[{year, rate:fracción, law, sourceUrl}], udi:{value, asOf}|null, meta{source:'curated,banxico'}}
  - `GET /v2/reference/mx/update-factor`. Parámetros: from=AAAA-MM, to=AAAA-MM (meses de los INPC).
    Respuesta: {inpcFrom:{month, value}, inpcTo:{month, value}, factorRaw, factor (truncado al diezmilésimo, nunca menor a 1), floorApplied:bool, meta{source:'banxico'}}
- Pantalla: Calculadora con Field de monto y meses, Stat del factor con la fórmula y los dos INPC con su fecha, recargos y ajuste de renta o contrato con tope opcional (src/features/business/lib/update.js); DataTable de valores de referencia por año con liga a la publicación, convertidor UMA a pesos y pesos a UMA con NumberInput, y Disclaimer 'herramienta informativa, no sustituye la asesoría fiscal'.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Factor 17-A: 140.405 entre 128.363 = 1.093812, publicado 1.0938.
  - Factor menor a 1: 127 entre 128 = 0.992188, publicado 1.0000 con floorApplied = true.
  - Recargos simples: 10,000 por 0.0147 mensual por 3 meses = 441.00.
  - Ajuste de renta: 20,000 por 136/128 = 21,250.00.
  - UMA de prueba (valor 2025): diaria 113.14 da mensual 113.14 por 30.4 = 3,439.46 y anual 3,439.46 por 12 = 41,273.52.
  - Mes sin INPC publicado responde 404 con details.reason y la UI muestra s/d.
  - Una prueba falla si mx_reference.json no trae el año en curso.
- Riesgos y decisiones:
  - Truncar o redondear el factor y el trato del INPC que baja son decisiones fiscales abiertas del dueño: se documentan y se validan antes de anunciar.
  - Las fuentes oficiales (DOF, INEGI, LIF) no se probaron en esta corrida: dato curado con liga, revisión cada enero.
  - Índice subyacente no verificado: solo INPC general.
  - Sin token de Banxico el INPC responde 503 y la calculadora queda deshabilitada con aviso.

### costo-de-capital-y-credito: Costo de capital y costo de crédito para la empresa

- Stream: **V5EM**. Audiencia: empresa. Valor 4, esfuerzo M.
- Ruta: /empresas/costo-de-capital y /empresas/credito. Navegación: Empresas ('Costo de capital', 'Crédito a TIIE'). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - kaizen_api/data/damodaran_2026.json (ya en el repo): industrias de EE. UU. y emergentes con betaU, evEbitda, roic, costOfDebtUsd, waccUsd, de, y tasa legal de impuestos por país
  - Prima de mercado y prima país desde /v2/assumptions existente (no se duplican)
  - Banxico SIE: Bono M 10A, TIIE 28 y fondeo vía /v2/rates/mx; TIIE 91 y SOFR vía /v2/money-market (contrato congelado de V5TS); FRED DGS10 vía /v2/macro/us
- Contrato:
  - `GET /v2/business/industries`. Parámetros: market=US|EM.
    Respuesta: {market, vintage, statutoryTaxRate:{MX:fracción, US:fracción}, industries:[{sector, industry, betaU, evEbitda, roic:fracción, costOfDebtUsd:fracción, waccUsd:fracción, de}], meta{source:'damodaran'}}
- Pantalla: Costo de capital (src/features/business/lib/wacc.js): Select de industria, NumberInput de deuda entre capital, tasa de impuestos y sobretasa, Stat de beta apalancada, costo de capital en USD y en pesos, WACC y rango de valor con su EBITDA y el VE/EBITDA de la industria, fórmula visible e InfoTip al glosario; ERP y CRP leídos de /v2/assumptions. Crédito (src/features/business/lib/loan.js): referencia TIIE 28, TIIE 91 (simple por periodo), TIIE de fondeo o SOFR (compuesta diaria en atraso) más sobretasa; amortización francesa, capital constante o al vencimiento; DataTable de pagos con descarga (fuente Banxico y FRED); escenarios de más y menos 100 pb con Bars y explicación de la transición de TIIE 28 a fondeo.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Hamada: betaU 0.90, t 0.30, D/E 0.50 dan betaL = 0.9*(1 + 0.7*0.5) = 1.215.
  - Con damodaran_2026.json (matureMarketErp 0.0423, CRP México 0.02465): costo de capital en USD = 0.045 + 1.215*0.0423 + 0.02465 = 0.1210445.
  - En pesos con inflación 0.04 contra 0.025: 1.1210445*1.04/1.025 - 1 = 0.137450.
  - WACC en pesos con deuda 1/3, costo de deuda 0.10 y t 0.30: 2/3*0.137450 + 1/3*0.07 = 0.114967.
  - Pago francés: 1,000,000 a 0.01 mensual en 12 pagos = 88,848.79.
  - TIIE 28 simple: saldo 1,000,000 a 0.0978 por 28/360 = 7,606.67; con +100 pb (0.1078) = 8,384.44.
  - Fondeo compuesto en atraso con tasa plana 0.0978 por 28 días: 1,000,000*((1 + 0.0978/360)^28 - 1) = 7,634.63.
- Riesgos y decisiones:
  - Damodaran es de enero de 2026 y se actualiza a mano.
  - Tasas de crédito bancario a empresas por tamaño no probadas: comparación de sobretasa en s/d.
  - Fondeo y SOFR compuestos con tasa plana son escenario, no proyección: se dice.
  - Que no se lea como recomendación de financiarse o invertir: es tasa mínima de referencia.

### salud-financiera-contrapartes: Salud financiera de clientes y proveedores que cotizan

- Stream: **V5EM**. Audiencia: empresa. Valor 4, esfuerzo M.
- Ruta: sección 'Salud financiera' de /investigar/:symbol y comparador en /empresas/contrapartes (?symbols=A,B,C). Navegación: Empresas ('Contrapartes') e Investigar (dentro de la ficha). Solo navegador: no.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Balance, resultados y flujo anuales de Yahoo vía yfinance Ticker (cubiertos por el replay) leídos con proveedor propio kaizen_api/providers/yahoo/balance.py
  - SEC companyfacts XBRL ya usados por domain/statements.py (solo lectura)
- Contrato:
  - `GET /v2/credit-health/{symbol}`. Parámetros: years=3|5.
    Respuesta: {symbol, currency, applicable:bool, reason:str|null, years:[{fiscalYear, altmanZEm|null, netDebtToEbitda|null, interestCoverage|null, currentRatio|null, quickRatio|null, dso|null, dpo|null}], inputsMissing:[{fiscalYear, field}], meta{source:'yahoo,sec'}}
- Pantalla: Sección lazy con DataTable por año (Stat del último año arriba), Sparkline por razón e InfoTip de cada fórmula; comparador de hasta 5 contrapartes con DataTable y Bars. Sin letras de calificación: solo cifras y su definición; señales de estrés descritas sin juicio.
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Z de Altman para emergentes: X1 0.2, X2 0.3, X3 0.1, X4 0.8 dan 3.25 + 6.56*0.2 + 3.26*0.3 + 6.72*0.1 + 1.05*0.8 = 7.052.
  - Deuda neta entre EBITDA: (500 - 100)/200 = 2.0; EBITDA negativo da null.
  - Cobertura: EBIT 150 entre intereses 30 = 5.0, sin letra asociada.
  - Días de cobro: 120 sobre 1,460 por 365 = 30.0.
  - Sin 'retained earnings' altmanZEm = null y aparece {field:'retainedEarnings'} en inputsMissing.
  - Banco o aseguradora: applicable = false con reason y years vacío.
- Riesgos y decisiones:
  - Se quitó la calificación sintética: las letras se parecen a la actividad de una calificadora (LMV, CNBV) y la tabla no se probó.
  - domain/statements.py no trae activo circulante, utilidades retenidas ni pasivo total: el proveedor nuevo los lee de Yahoo.
  - yfinance para uso personal según Yahoo; sin descarga de estas cifras.

### monitores-alertas-y-descarga: Monitores tipo terminal, alertas dentro de la app y descarga de datos públicos

- Stream: **V5TM**. Audiencia: ambos. Valor 5, esfuerzo L.
- Ruta: /watchlist (varias listas, ?lista=), /alertas, y botón 'Descargar' en DataTable y gráficas cuando la fuente lo permite. Navegación: Extra ('Lista de seguimiento', 'Alertas'). Solo navegador: sí.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Endpoints existentes: /v2/quotes, /v2/panel, /v2/instrument/{symbol}, /v2/events, /v2/fx, /v2/rates/mx (sin fuente nueva)
- Pantalla: Lista de seguimiento: varias listas con crear, renombrar y borrar con Deshacer, montadas en src/features/watchlist/lib/watchlists.js sobre storage.update() (sin tocar usePortfolios.js); columnas elegibles en Popover (último, cambio, 52 semanas, P/U, rendimiento por dividendo, próximo evento), onRowClick a la ficha, tendencias con un solo /v2/panel, vista densa. AddToWatchlist en las ranuras de ficha y screener. Paleta con comandos ('WALMEX GP' gráfica, 'AAPL DES' resumen, 'AAPL DOC' documentos, 'agregar AAPL'). Alertas: reglas en localStorage 'kaizen.alerts' (precio que cruza un nivel, movimiento diario mayor a X, FIX arriba o abajo, ex dividendo en N días), evaluadas al entrar y cada 60 s con la pestaña visible, aviso con useToast e historial; Notification API solo si la persona la activa. Descarga: DownloadButton (src/components/ui/DownloadButton.jsx) y src/lib/download.js con CSV UTF-8 con BOM y encabezado de procedencia; deshabilitado con explicación cuando meta.source incluye 'yahoo' (lista de fuentes descargables en una constante que el dueño puede cambiar).
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - CSV con procedencia: filas [{fecha:'2026-09-30', valor:0.0663}] y meta {source:'banxico', asOf:'2026-09-30'} producen BOM, '# Fuente: banxico' y '# Dato al: 2026-09-30' antes de 'fecha,valor' y '2026-09-30,0.0663'.
  - Coma en un nombre ('Walmart de México, S.A.B.') va entre comillas.
  - Descarga con meta.source 'yahoo' o 'banxico,yahoo' queda deshabilitada con motivo; con 'banxico,fred' se habilita.
  - Alerta de cruce: regla >= 60 con previo 59.5 se dispara con 60.2 una sola vez, no con 60.5, y se rearma al bajar de 60.
  - Paleta: 'walmex gp' da {symbol:'WALMEX.MX', vista:'grafica'}; 'zzzz gp' sin coincidencia queda como búsqueda.
  - Borrar una lista y Deshacer la restaura con el mismo id y orden.
  - Tendencias: 12 símbolos piden 1 llamada a /v2/panel, no 12 a /v2/history.
- Riesgos y decisiones:
  - Sin cuentas ni servidor programado las alertas solo funcionan con la app abierta: se dice en la página.
  - DataTable y ChartFrame no los edita el stream: el orquestador deja la prop download en prep.
  - Redistribución: precios de Yahoo, índices S&P/BMV y futuros no se descargan; si el dueño decide otra cosa, se cambia una constante.
  - No tocar src/lib/storage.js: las alertas usan su propia llave.

### resumen-del-dia: Resumen del día tipo terminal, imprimible

- Stream: **V5TM**. Audiencia: ambos. Valor 4, esfuerzo M.
- Ruta: /mercados/resumen. Navegación: Mercados ('Resumen del día'). Solo navegador: sí.
- Fuentes (probadas en vivo el 1 oct 2026):
  - Endpoints existentes /v2/markets/overview, /v2/rates/mx, /v2/fx, /v2/news y los nuevos con contrato congelado en prep: /v2/fxdesk/monitor, /v2/money-market, /v2/calendar/economic, /v2/movers
- Pantalla: Página de una sola columna que cabe en hoja carta: Stat del FIX y su cambio en centavos, DataTable de tasas cortas (une /v2/rates/mx y /v2/money-market), tabla de índices del panorama, las 5 que más suben y bajan de México y EE. UU., eventos de hoy y de la semana del calendario y 5 titulares; cada bloque condicionado con useFeature por su capacidad, con EmptyState mientras la capacidad no se anuncia. Estilos @media print en src/styles/print.css para Guardar como PDF desde cualquier página (oculta barra lateral, tira de mercado y BottomNav).
- Pruebas de respuesta conocida (verificadas por el orquestador):
  - Sin la capacidad 'movers' en /health el bloque de movimientos no pide datos y muestra EmptyState; con ella pide una sola vez /v2/movers por mercado.
  - Evento con datetimeUtc 2026-10-02T05:30Z cuenta como 'hoy' el 2026-10-01 en hora del centro (23:30, UTC-6).
  - FIX 18.2500 contra 18.1000 se pinta '+15.00 centavos'.
  - En impresión, .sidebar, .market-strip y .bottom-nav tienen display none (prueba de estilos computados en e2e con emulateMedia print).
- Riesgos y decisiones:
  - Depende de cuatro streams: se construye contra mockApi con los contratos congelados y se valida con datos reales al integrar.
  - No inventa datos mientras un endpoint siga en @stub: muestra s/d.
  - El envío diario por correo queda fuera (sin cuentas ni cron).

## Streams y archivos de cada uno

### V5TS: centro-de-tasas
- Capa de fixtures: 2026-10-01-v5ts
- Backend: `kaizen_api/routers/curves.py`, `kaizen_api/domain/curves.py`, `kaizen_api/domain/money_market.py`, `kaizen_api/domain/expectations.py`, `kaizen_api/providers/treasury.py`, `kaizen_api/data/curve_nodes.json`, `tests/unit/v5ts/**`, `tests/fixtures/recorded/2026-10-01-v5ts/**`, `docs/requests/V5TS.md`
- Frontend: `src/features/rates/**`, `e2e/v5ts.spec.js`, `docs/metodologia/tasas-y-curvas.md`

### V5FX: monitor-del-peso, forward-y-presupuesto-usd
- Capa de fixtures: 2026-10-01-v5fx
- Backend: `kaizen_api/routers/fxdesk.py`, `kaizen_api/domain/fxdesk.py`, `kaizen_api/domain/dof_rule.py`, `kaizen_api/domain/forward.py`, `kaizen_api/providers/frankfurter.py`, `kaizen_api/providers/cftc.py`, `tests/unit/v5fx/**`, `tests/fixtures/recorded/2026-10-01-v5fx/**`, `docs/requests/V5FX.md`
- Frontend: `src/features/fx/**`, `e2e/v5fx.spec.js`, `docs/metodologia/tipo-de-cambio.md`

### V5EC: calendario-economico, tablero-economia
- Capa de fixtures: 2026-10-01-v5ec
- Backend: `kaizen_api/routers/economy.py`, `kaizen_api/domain/economy.py`, `kaizen_api/domain/econ_calendar.py`, `kaizen_api/providers/bls.py`, `kaizen_api/providers/worldbank.py`, `kaizen_api/data/calendar_banxico.json`, `kaizen_api/data/calendar_fomc.json`, `kaizen_api/data/calendar_inegi.json`, `kaizen_api/data/macro_catalog.json`, `tests/unit/v5ec/**`, `tests/fixtures/recorded/2026-10-01-v5ec/**`, `docs/requests/V5EC.md`
- Frontend: `src/features/economy/**`, `e2e/v5ec.spec.js`, `docs/metodologia/economia-y-calendario.md`

### V5FI: ficha-resultados-tenencia-directivos, documentos-regulatorios
- Capa de fixtures: 2026-10-01-v5fi
- Backend: `kaizen_api/routers/company.py`, `kaizen_api/domain/earnings.py`, `kaizen_api/domain/holders.py`, `kaizen_api/domain/shares.py`, `kaizen_api/domain/filings.py`, `kaizen_api/providers/yahoo/analysis.py`, `kaizen_api/data/sec_8k_items.json`, `kaizen_api/data/sec_adr_map.json`, `tests/unit/v5fi/**`, `tests/fixtures/recorded/2026-10-01-v5fi/**`, `docs/requests/V5FI.md`
- Frontend: `src/features/company/**`, `e2e/v5fi.spec.js`, `docs/metodologia/resultados-y-documentos.md`

### V5TC: grafica-tecnica
- Capa de fixtures: 2026-10-01-v5tc
- Backend: `kaizen_api/routers/ohlc.py`, `kaizen_api/domain/ohlc.py`, `kaizen_api/providers/yahoo/ohlc.py`, `tests/unit/v5tc/**`, `tests/fixtures/recorded/2026-10-01-v5tc/**`, `docs/requests/V5TC.md`
- Frontend: `src/features/technical/**`, `src/lib/finance/technical.js`, `src/lib/finance/technical.test.js`, `scripts/golden/technical_golden.py`, `tests/golden/technical.json`, `src/components/charts/Candles.jsx`, `src/components/charts/candles.js`, `src/components/charts/candles.test.js`, `src/components/charts/candles.css`, `e2e/v5tc.spec.js`, `docs/metodologia/analisis-tecnico.md`

### V5MK: movimientos-amplitud-y-mapa
- Capa de fixtures: 2026-10-01-v5mk
- Backend: `kaizen_api/routers/movers.py`, `kaizen_api/domain/movers.py`, `kaizen_api/domain/breadth.py`, `kaizen_api/domain/sectors.py`, `kaizen_api/providers/yahoo/screen.py`, `kaizen_api/data/sector_etfs.json`, `tests/unit/v5mk/**`, `tests/fixtures/recorded/2026-10-01-v5mk/**`, `docs/requests/V5MK.md`
- Frontend: `src/features/movers/**`, `e2e/v5mk.spec.js`

### V5PF: agenda-y-temporada-de-reportes, etf-por-dentro-y-rayos-x
- Capa de fixtures: 2026-10-01-v5pf
- Backend: `kaizen_api/routers/events.py`, `kaizen_api/routers/funds.py`, `kaizen_api/domain/events.py`, `kaizen_api/domain/earnings_season.py`, `kaizen_api/domain/funds.py`, `kaizen_api/providers/yahoo/funds.py`, `kaizen_api/data/sic_etf_map.json`, `tests/unit/v5pf/**`, `tests/fixtures/recorded/2026-10-01-v5pf/**`, `docs/requests/V5PF.md`
- Frontend: `src/features/agenda/**`, `src/features/funds/**`, `e2e/v5pf.spec.js`

### V5EM: actualizacion-y-referencias, costo-de-capital-y-credito, salud-financiera-contrapartes
- Capa de fixtures: 2026-10-01-v5em
- Backend: `kaizen_api/routers/business.py`, `kaizen_api/domain/business/**`, `kaizen_api/providers/yahoo/balance.py`, `kaizen_api/data/mx_reference.json`, `tests/unit/v5em/**`, `tests/fixtures/recorded/2026-10-01-v5em/**`, `docs/requests/V5EM.md`
- Frontend: `src/features/business/**`, `e2e/v5em.spec.js`, `docs/metodologia/empresas.md`

### V5TM: monitores-alertas-y-descarga, resumen-del-dia
- Capa de fixtures: ninguna (solo frontend; e2e con mockApi sobre los contratos congelados)
- Backend: ninguno
- Frontend: `src/features/watchlist/**`, `src/features/alerts/**`, `src/features/briefing/**`, `src/app/shell/CommandPalette.jsx`, `src/app/shell/palette-model.js`, `src/app/shell/palette-model.test.js`, `src/components/ui/DownloadButton.jsx`, `src/lib/download.js`, `src/lib/download.test.js`, `src/styles/print.css`, `e2e/v5tm.spec.js`, `e2e/watchlist.spec.js`, `docs/requests/V5TM.md`

## Preparación del orquestador (M5), antes de lanzar streams

- Rama y worktrees como en fases previas (DEVELOPER_DIR de CLT, git worktree add en '05 NEWKAIZEN.wt/<stream>', ramas ws/v5xx, cp -cR de node_modules); máximo 3 streams con navegador a la vez (V5TS, V5TC y V5TM) y puertos 5300+2i / 8100+i, nunca 8002, 5180 ni 4180. Tandas sugeridas: primero V5TS, V5FX, V5EC, V5FI y V5PF; después V5TC, V5MK, V5EM y V5TM.
- kaizen_api/schemas.py (congelado de O), aditivo y CONGELADO para toda la fase (los streams piden cambios en docs/requests/<stream>.md): CurvesResponse, CurveSpreadsResponse, MoneyMarketResponse, ExpectationsResponse, FxMonitorResponse, FxCrossesResponse, FixLookupResponse, FixTableResponse, FxForwardResponse, EconomicCalendarResponse, MacroIndicatorsResponse, MacroWorldResponse, EventsSeasonResponse, EarningsResponse, HoldersResponse, SharesResponse, FilingsResponse, OhlcResponse, MoversResponse, BreadthResponse, SectorsResponse, FundResponse, ReferenceMxResponse, UpdateFactorResponse, IndustriesResponse, CreditHealthResponse; todos ContractModel con meta: Meta, fracciones y campos *Bp en pb, en RESPONSE_MODELS. Literales nuevos OhlcRange ('1d','5d','1mo','6mo','1y','5y','max') y OhlcInterval ('5m','1h','1d','1wk','1mo') solo para /v2/ohlc; OhlcBar.t como IsoDate o Instant con validador según interval; campo adjustment (mismo nombre que PanelResponse). Enums de unit de macro (fraction, index, thousandsPersons, usdMillions, mxnMillions2018, usdBillionsChained2017, usdPerBarrel) y kind rate|level con changeYoY y changeYoYBp. CreditHealthResponse con applicable y reason. EventItem gana estimateLow y estimateHigh opcionales (amount conserva su significado) y EventsResponse gana dividendSummary opcional.
- schemas.SOURCE_TOKENS: agregar 'treasury', 'frankfurter', 'cftc', 'bls', 'worldbank'; HealthProviders sin cambios.
- schemas.KNOWN_CAPABILITIES: 'curves', 'moneyMarket', 'expectations', 'fxdesk', 'fxdesk.crosses', 'fxdesk.fix', 'fxdesk.forward', 'calendar.economic', 'macro.indicators', 'macro.world', 'events.season', 'events.dividends', 'earnings', 'holders', 'shares', 'filings', 'ohlc', 'ohlc.intraday', 'movers', 'breadth', 'sectors', 'funds', 'reference.mx', 'business.industries', 'creditHealth'; resolver las fantasma 'history.dates' y 'fx.fix' (quitarlas de VixCard.jsx y e2e/support/app.js o anunciarlas de verdad).
- kaizen_api/routers/: crear curves.py (V5TS), fxdesk.py (V5FX), economy.py (V5EC), company.py (V5FI), ohlc.py (V5TC), movers.py (V5MK), funds.py (V5PF) y business.py (V5EM) con APIRouter(prefix='/v2', responses=ERROR_RESPONSES), CAPABILITIES = [] y cada ruta del contrato con @router.get(..., response_model=..., dependencies=[cache_control(...)]) + @stub + raise not_implemented('GET /v2/...'); agregar en events.py la ruta /v2/events/season con @stub; importar en kaizen_api/main.py y sumar a V2_ROUTERS.
- kaizen_api/http_cache.py: clases 'reference' (86400 s) para calendarios y curados, 'intraday' (60 s) para /v2/ohlc con 5m o 1h, y 'curves' (3600 s); documentar en CACHE_SECONDS.
- tests/contract/test_schemas.py: fila SPEC por ruta nueva, casos 400 y 422 (country inválido, interval=5m con range=1y, plazo 0 o mayor a 365 en forward, fechas fuera de rango, symbol mal formado) y regenerar docs/api-v2.md con KAIZEN_WRITE_DOCS=1 sin guiones largos.
- kaizen_api/data/banxico_series.json y kaizen_api/providers/banxico.py (de B2b): agregar SF43883, SF43886, SF45384, SF60696 (tituloContiene 'tasa de rendimiento'), SF61592, SF46958, SF46961, SF43878, SF111916, SF46410, SF46406, SF46407, SF60632, SF290383, SE27803, SF43707, SR14138, SR14139, SR14145, SR14146, SR14447, SR14448, SR14769, SR14770, SR14776, SR14777 con periodicidad y unidad; ampliar las unidades del candado ('Millones de Dólares', 'Pesos por Dólar', 'Pesos por divisa', 'Porcentajes', 'Sin Unidad'); correr test_banxico_live.py con el token de .env.local y marcar verified solo lo que confirme el título (en especial SR14146, SR14448 y SR14769, que hoy son inferidos). Grabar esas series en una capa 2026-10-01-banxico que todos los streams apilan.
- kaizen_api/providers/sec_edgar.py (de B3a): exponer sin cambiar conducta una función pública submissions(cik) que envuelva _submissions y documentar que cik_for(ticker del ADR) sirve para las emisoras del mapa de V5FI; nadie más edita ese archivo.
- tests/replay/session.py (de M1): interceptar yfinance.screen (con EquityQuery) igual que download, con su prueba; anotar en docs/OWNERSHIP.md que yf.Sector, yf.Industry, yf.Calendars y YfData().get_raw_json siguen sin replay y están vetados en la fase 5.
- Proveedores de Yahoo: ningún stream edita kaizen_api/providers/yahoo/fundamentals.py (B3a) ni prices.py (B2a); cada uno crea su módulo (analysis.py de V5FI, funds.py de V5PF, balance.py de V5EM, ohlc.py de V5TC, screen.py de V5MK) importando solo lectura session.py y las funciones públicas existentes.
- Capas de fixtures: tests/fixtures/recorded/2026-10-01-<stream>/index.json vacío para las ocho capas de backend con frozen_at 2026-10-01; cada stream graba con --set 2026-09-22,2026-10-01-banxico,2026-10-01-<stream> --grabar-en 2026-10-01-<stream> y revisa que no se filtren BANXICO_TOKEN, FRED_API_KEY ni EODHD_API_TOKEN.
- scripts/ownership.json (de O): llaves V5TS, V5FX, V5EC, V5FI, V5TC, V5MK, V5PF, V5EM y V5TM con sus globs; mover kaizen_api/routers/events.py y kaizen_api/domain/events.py de B3a a V5PF, src/features/watchlist/** de T1MK a V5TM, CommandPalette.jsx y palette-model.js(+test) de C3 a V5TM; excluir de C2 ('!src/components/charts/Candles.jsx', candles.js, candles.test.js, candles.css) y asignarlos a V5TC; dejar DataTable.jsx, ChartFrame.jsx, csv.js, ui/index.js, finance/index.js, Instrument.jsx, Screener.jsx, Summary.jsx y GroupsSection.jsx con sus dueños actuales (solo el orquestador los toca en prep); correr node scripts/check-ownership.mjs --coverage con la lista viva antes de lanzar.
- Componentes compartidos, solo el orquestador: mover src/features/markets/pages/ApiNotes.jsx a src/components/ui/ApiNotes.jsx con reexporte desde la ruta vieja; exportar Popover, ApiNotes y DownloadButton desde src/components/ui/index.js; crear src/components/ui/DownloadButton.jsx provisional que devuelve null (lo hereda V5TM); agregar a DataTable y ChartFrame la prop aditiva download={{filename, columns, meta}} que monta DownloadButton, documentada en docs/design.md.
- src/lib/csv.js: agregar downloadBlob(filename, text, mime) genérico con su prueba (V5EC baja .ics con text/calendar, V5FX y V5TM lo usan); ningún stream edita csv.js.
- src/lib/finance/index.js (de A1): exportar desde un src/lib/finance/technical.js provisional vacío que hereda V5TC.
- src/app/paths.js (+ paths.test.js): marketsRates '/mercados/tasas', marketsFx '/mercados/tipo-de-cambio', marketsEconomy '/mercados/economia', marketsCalendar '/mercados/calendario', marketsMovers '/mercados/movimientos', marketsBriefing '/mercados/resumen', portfolioAgenda '/portafolio/agenda', portfolioXray '/portafolio/rayos-x', business '/empresas', businessUpdate '/empresas/actualizacion', businessReference '/empresas/referencias', businessFx '/empresas/tipo-de-cambio', businessHedge '/empresas/cobertura', businessCapital '/empresas/costo-de-capital', businessCredit '/empresas/credito', businessCounterparties '/empresas/contrapartes', alerts '/alertas'; helpers pathCounterparties(symbols) y pathInstrumentTab(symbol, tab).
- src/app/nav.js (+ src/app/shell/nav.test.js): Mercados gana Resumen del día, Tasas y curvas, Tipo de cambio, Economía, Calendario y Movimientos del día; Portafolio gana Agenda y Rayos X; sección nueva 'Empresas' con sus 7 páginas e íconos lucide; NAV_EXTRA 'Alertas'; BOTTOM_PREFIXES con '/empresas' y '/alertas' marcando 'Más'; actualizar las listas exactas de la prueba.
- src/app/router.jsx: importar routes de rates, fx, economy, agenda, funds, movers, business, alerts y briefing y sumarlas a featureRoutes; cada src/features/<x>/routes.jsx lo crea el orquestador con const Pages = { X: lazy(...) } hacia una página provisional con handle.title y handle.description, y lo hereda el stream. '/empresas' NO es ruta layout: su índice vive en business/routes.jsx (V5EM) y se arma leyendo la sección 'Empresas' de nav.js, así las páginas de V5FX aparecen solas; fx/routes.jsx declara /empresas/tipo-de-cambio y /empresas/cobertura con ruta completa. Agenda y Rayos X van en agenda/routes.jsx y funds/routes.jsx, no en portfolio/routes.jsx. router.test.jsx y titles.test.jsx: títulos únicos y PROPER ampliado con 'Banxico', 'FIX', 'INPC', 'UMA', 'ETF', 'SEC', 'TIIE', 'IPC', 'Estados Unidos'.
- Ranuras en src/features/research/pages/Instrument.jsx: pestaña 'Gráfica' con lazy de src/features/technical/TechnicalSection.jsx; secciones lazy de src/features/company/sections/EarningsSection.jsx, HoldersSection.jsx, InsidersSection.jsx, SharesSection.jsx y FilingsSection.jsx; src/features/funds/sections/FundSection.jsx solo si el tipo es ETF; src/features/business/sections/CreditHealthSection.jsx; src/features/watchlist/AddToWatchlist.jsx en la cabecera. La misma ranura AddToWatchlist en src/features/research/pages/Screener.jsx. Cada ranura dentro de Suspense y ErrorBoundary, condicionada por useFeature y con un archivo provisional que exporta default y devuelve null.
- Ligas a la ficha (onRowClick con pathInstrument) en src/features/portfolio/pages/Summary.jsx y src/features/markets/overview/GroupsSection.jsx, y en OverviewPage.jsx y MexicoPage.jsx ligas a Resumen, Tasas, Tipo de cambio, Economía, Calendario y Movimientos (MexicoPage con la etiqueta 'México').
- src/lib/api/endpoints.js (+ endpoints.test.js), types.js y queries.js: una función v2Get por ruta nueva (getCurves, getCurveSpreads, getMoneyMarket, getExpectations, getFxMonitor, getFxCrosses, getFix, getFixTable, getFxForward, getEconomicCalendar, getMacroIndicators, getMacroWorld, getEventsSeason, getEarnings, getHolders, getShares, getFilings, getOhlc, getMovers, getBreadth, getSectors, getFund, getReferenceMx, getUpdateFactor, getIndustries, getCreditHealth), su typedef, su llave en queryKeys y su xQuery con STALE_TIME por clase; ningún stream edita estos archivos.
- e2e/support/app.js HEALTH_V2 y e2e/support/mockApi.js: anunciar las capacidades nuevas y dejar que cada spec declare sus handlers; reservar e2e/v5*.spec.js en ownership.
- src/main.jsx: importar src/styles/print.css (vacío inicial, de V5TM).
- Glosario (src/content/glossary.js) y aviso legal (src/features/legal/pages/Notice.jsx) al final de la fase con lo que pidan los docs/requests: curva de rendimiento, inflación implícita, tasa real, forward, puntos forward, encuesta Banxico, factor de actualización, UMA, RSI, MACD, Bollinger, media móvil, Z de Altman, cobertura de intereses, 8-K, 10-K, 10-Q, 20-F, 6-K, tenencia institucional, traslape de ETF, amplitud, posicionamiento CFTC; atribuciones de Banco de México con fecha de obtención, FRED, NY Fed (SOFR), Tesoro de EE. UU., BLS, CFTC, Banco Mundial CC BY 4.0, BCE y bancos centrales vía Frankfurter, SEC; ajustar la prueba de learn que cuenta 11 guías.
- Regla común en el prompt de cada stream: nada de recomendaciones de compra o venta (quitar ratings y precios objetivo en el proveedor), español de México sin guiones largos, s/d para faltantes, porcentajes en fracción y cambios de tasa en pb, contratos congelados (cambios solo por docs/requests), y meta.notes de toda respuesta con datos de Yahoo diciendo que yfinance es para uso personal según sus términos.
- Decisiones del dueño que el orquestador deja anotadas en CONTINUAR.md antes de anunciar a empresas: uso comercial de datos de Yahoo y de índices S&P/BMV (afecta V5FI, V5PF, V5TC, V5MK y parte de V5EM), regla FIX contra DOF, truncado del factor de actualización, suficiencia de la cita de SOFR y la lista de fuentes descargables de V5TM.

## Descartado y por qué

- **insumos-en-pesos (granos, café, azúcar, ganado, acero y aluminio en pesos)**: Los futuros de CME, CBOT e ICE tienen licencia de la bolsa y Yahoo es para uso personal: mostrarlos a empresas que pagan es el riesgo de licencia más alto de la fase. Además, la historia de los agrícolas por download no se probó, y HRC=F y ALI=F tienen interés abierto de 8,032 y 527 contratos. Pasa a la fase 6 después de probar el Pink Sheet del Banco Mundial como fuente pública.
- **probabilidad lognormal de que el FIX rebase el presupuesto**: Es una probabilidad neutral al riesgo con volatilidad histórica que la pantalla presentaría como pronóstico y bordea la regla de no sugerir coberturas. Se reemplaza por el percentil histórico del nivel presupuestal y la tabla de impacto.
- **calificación sintética por letras (AAA a D) en salud financiera**: Publicar letras sobre clientes y proveedores se parece a la actividad de una calificadora regulada por la LMV y la CNBV, y la tabla de Damodaran no se probó en vivo. Queda solo la cobertura de intereses como número.
- **campo analysts en /v2/events**: Ticker.calendar no lo trae: saldría del módulo earningsTrend con hasta 50 llamadas extra por petición. El número de analistas vive en /v2/earnings/{symbol}.
- **MORTGAGE30US, T10YIE y el bono 10A de la OCDE en el tablero**: MORTGAGE30US es de Freddie Mac 'reprinted with permission' y aporta poco al público mexicano; T10YIE pide cita y se sustituye con la curva real del Tesoro, que es dominio público; IRLTLT01MXM156N duplica SF44071 y queda solo como respaldo existente de /v2/rates/mx.
- **filas de México repetidas en /v2/money-market**: Objetivo, TIIE 28, fondeo y CETES ya salen de /v2/rates/mx con su cambio diario. El endpoint nuevo solo trae las series nuevas y los cambios semanal y mensual de las existentes.
- **parámetros de mercado repetidos en /v2/business/industries**: La prima de mercado y la prima país ya se publican en /v2/assumptions. Duplicarlas permitiría que diverjan.
- **cadena-de-opciones**: Valor 3 para la audiencia: casi nadie en México opera opciones de EE. UU. desde su casa de bolsa y MexDer no está en Yahoo. La fuente funciona, así que pasa a la fase 6.
- **cripto-ampliado**: Valor 3. CoinGecko sin llave limita a 5 a 30 llamadas por minuto y en la IP compartida de Render fallaría. La llave Demo gratuita la tendría que sacar el dueño. BTC y ETH ya están en el panorama.
- **alertas por correo o push en el servidor**: Necesitan cuentas (decisión de Supabase pendiente), un cron en Render (el plan gratis se duerme) y una cuenta de correo del dueño. Solo entra la versión dentro de la app.
- **series-por-url-excel**: El API v2 va detrás de JWT. IMPORTDATA y Power Query necesitan llaves de lectura por usuario, que dependen de la decisión de cuentas. La descarga CSV de fuentes públicas sí entra.
- **reporte-fiscal-anual**: Depende de decisiones fiscales que el dueño no ha tomado (INPC que baja, dividendos extranjeros, FIX contra DOF, retención de FIBRAs). Antes de eso podría dar cifras fiscales equivocadas.
- **comparador-de-afores**: Los datos abiertos de CONSAR no se probaron en esta corrida, así que no hay fuente gratuita confirmada. Candidato fuerte para la fase 6.
- **verificador-proveedores-sat (69-B, 69 y OFAC)**: Las fuentes del SAT y de OFAC no se probaron, y el manejo de RFC y razón social de terceros obliga a revisar el aviso de privacidad. Fase 6 después del probe.
- **fundamentales-bmv-xbrl**: BMV y BIVA no tienen API. Sacar datos de páginas o PDF es frágil y no se probó.
- **condiciones-financieras (NFCI, STLFSI4, diferenciales ICE)**: NFCI y STLFSI4 no se probaron, y las series ICE BofA de FRED prohíben la reproducción. El diferencial Bono M menos Tesoro entra en centro-de-tasas.
- **indicadores de INEGI (IGAE, INPC quincenal, empleo IMSS)**: La API BIE pide un token gratuito que el dueño tendría que sacar, y las descargas sin token devuelven un 404 disfrazado. Se muestran como s/d. Desempleo y PIB llegan por los espejos OCDE de FRED.
- **trayectoria de la Fed con futuros ZQ, FedWatch y FEDTARMD**: Los datos de CME tienen licencia y ni ZQ ni FEDTARMD se probaron. Se reemplazan con forwards implícitos calculados por la app.
- **supuestos de CGPE de SHCP**: La fuente no se probó. El presupuesto usa la encuesta Banxico, que sí se probó.
- **tasas de crédito bancario a empresas por tamaño (CNBV o SIE)**: Los ids no se encontraron ni se probaron. La comparación de sobretasa queda en s/d.
- **calificaciones de analistas, precios objetivo y columnas 'rating' de yf.Sector e yf.Industry**: Son recomendaciones de compra o venta y violan la regla del producto. Se quitan en el proveedor.
- **yf.Calendars, yf.Sector, yf.Industry y el quote v7 en lote**: No pasan por el replay de pruebas. Calendars viene en inglés y sin filtro por país, y para todo lo demás hay fuentes oficiales o envolturas cubiertas.
- **FiscalData (deuda del Tesoro) y FMI DataMapper**: FiscalData aporta poco a esta audiencia. La licencia del FMI no se verificó y su filtro de países no funcionó en el probe.
- **monitores de series no bursátiles (FIX, TIIE e insumos en un mismo tablero)**: Requieren un catálogo unificado de series con id estable que cruza cuatro streams. Se posponen hasta que existan sus endpoints; por ahora el resumen del día cubre la vista combinada.
