# Stream SIE: catálogo de Banxico con el token real y calendarios 2025

25 de septiembre de 2026, rama `ws/SIE`. Sin navegador. El token vive solo en `.env.local` (ignorado
por git); cada commit se revisó con `git diff --cached | grep -c "$BANXICO_TOKEN"` = 0.

## Veredicto

| Pieza | Veredicto |
| --- | --- |
| Catálogo del SIE (`kaizen_api/data/banxico_series.json`) | pass |
| Calendarios BMV y NYSE 2025 | pass |

Commits: `9329f7a` (catálogo del SIE) y `509695c` (calendarios).

## 1. Catálogo del SIE

Estado de partida, revalidado con la prueba en vivo antes de tocar nada: el SIE confirmaba 5 de 12
(`SF331451`, `SF43718`, `SF43783`, `SF61745`, `SP68257`) y rechazaba 7.

### Hallazgos

- **[blocker] `bonoM10` apuntaba a un BPA.** `kaizen_api/data/banxico_series.json` (serie
  `bonoM10`). `SF43881` es "Bonos de protección al ahorro, subasta semanal, A 1092 días (3 años),
  Monto asignado", en millones de pesos. Repro: `GET /series/SF43881` con `Bmx-Token`.
  **Corregido** en `9329f7a`: `SF44071`, "Valores Gubernamentales, Resultados de la subasta
  semanal, Tasa de rendimiento, Bono tasa fija 10 años", Porcentajes. Encontrado barriendo
  `SF43870..SF43935` y `SF44060..SF44080` en el endpoint de metadatos. Es la tasa de colocación
  primaria. Se subasta cada 5 a 8 semanas: entre sep 2024 y sep 2026 el hueco más largo fue de 56
  días, por eso `maxAgeDays` pasó de 7 a 60 (con 7 saldría `stale` casi siempre).
- **[blocker] `inflationYoY` y `coreInflationYoY` eran índices, no variaciones.** `SP74625` es el
  índice del INPC subyacente y `SP74626` el de mercancías; los dos en nivel (~140), mensuales, "Sin
  Unidad". **Corregido** en `9329f7a`: `SP30578` "Índice Nacional de Precios al consumidor variación
  anual" (3.26 al 1 ago 2026) y `SP74662` "Inflación Subyacente (nueva definición) Anual" (3.88).
  Los dos son mensuales, no quincenales, así que la periodicidad pasó a "Mensual", `unidadExacta` a
  "Sin Unidad" y `maxAgeDays` de 45 a 75 (el dato se fecha el día 1 y el Inegi lo publica hacia el
  día 9 del mes siguiente: puede tener hasta ~70 días).
- **[major] CETES con periodicidad "Semanal" en el catálogo.** Los ids `SF43936/39/42/45` SÍ son
  la subasta primaria: el título del SIE es "Valores gubernamentales, Resultados de la subasta
  semanal, Tasa de rendimiento, Cetes a N días" y los datos traen un punto por subasta (semanal; el
  de 364 días cada dos semanas). El SIE los etiqueta "Diaria" porque la serie está indexada por
  fecha. Las alternativas descartadas: `SF282`, `SF3338`, `SF3270`, `SF3367` son promedios
  mensuales, y `SF60633`/`SF60634` son la FECHA de la subasta ("Sin Unidad"). **Corregido**:
  periodicidad "Diaria" y, para no aflojar el candado, `tituloContiene` exige ahora "subasta",
  "tasa de rendimiento" y "cetes a N dias", y `tituloExcluye` agrega "fecha subasta" y "secundario".
- **[minor] Títulos del SIE rellenos de espacios.** `kaizen_api/providers/banxico.py:_fold`. El SIE
  manda "Tasa de rendimiento  Bono tasa fija 10 años" con tiras de espacios, así que una frase de
  varias palabras no se encontraba. **Corregido**: `_fold` colapsa espacios; los mensajes de razón
  también.

### Resultado en vivo

`KAIZEN_LIVE=1 .venv/bin/python -m pytest -o addopts="" tests/unit/b2b/test_banxico_live.py -s`
(token cargado con `set -a; source .env.local; set +a`): **4 pasadas**. Confirma las 12 series.
`verified: true` quedó en las 12, `revisado: 2026-09-25`. La prueba en vivo ganó dos casos:
`test_cada_serie_verificada_trae_un_dato_creible` (el dato oportuno de cada serie marcada cae en la
banda de `rates.PLAUSIBLE`; así un índice del INPC ya no puede pasar como por ciento) y
`test_rates_mx_en_vivo_publica_todo_el_catalogo` (`get_mx_rates()` publica los 12 renglones desde
`banxico`, verificados y sin respaldo).

### Pruebas offline

- Nuevo `tests/unit/b2b/test_sie_catalogo_real.py` con la fixture
  `tests/unit/b2b/sie_metadatos_2026-09-25.json`: la respuesta real de `GET /series/<ids>` (solo
  metadatos, sin token) de las 12 series y de 8 vecinas que se confundían. Prueba que las 12 pasan,
  que `verified` solo está en confirmadas y que `SF43881`, `SF44072` (monto del Bono M), `SP74625`,
  `SP74626`, `SP30577` (variación mensual), `SP74665` (NO subyacente anual), `SF282` y `SF60633`
  NO pasan por la serie que suplantaban. Falla antes del arreglo (2 fallas) y pasa después.
- Ajustadas a los metadatos reales: `test_banxico.py`, `test_rates.py` (una prueba ahora pone
  `verified: false` a propósito para seguir probando el flag de revisión humana).
- No había fixtures grabadas del SIE en `tests/fixtures/recorded` (Banxico siempre se simuló con
  `responses`), así que no hubo que regrabar capas.
- Documentación: `docs/api-v2.md` (lista de ids y `maxAgeDays`) y
  `docs/metodologia/fuentes-de-datos.md` (el INPC anual es mensual). En `src/` no aparece ningún id.

## 2. Calendarios 2025

- **[major] 2025 no estaba cubierto.** `kaizen_api/data/holidays_{nyse,bmv}.json`. Un feriado que
  falta se ve igual que un día hábil: el histórico de NAFTRAC.MX dejaba pasar los cierres repetidos
  del 2025-11-17 y 2025-12-12 como rendimientos de 0 %. **Corregido** en `509695c`.
- NYSE 2025, del comunicado de NYSE Group del 8 nov 2024 (calendario 2025 a 2027, ir.theice.com): 1
  ene, 20 ene, 17 feb, 18 abr, 26 may, 19 jun, 4 jul, 1 sep, 27 nov, 25 dic; recortes a las 13:00
  el 3 jul, 28 nov y 24 dic. Más el cierre extraordinario del **9 de enero de 2025** (Día Nacional
  de Duelo por Jimmy Carter, comunicado de ICE del 30 dic 2024). 2026 y 2027 se cotejaron contra
  nyse.com/markets/hours-calendars: coinciden.
- BMV 2025, del DOF del 27 dic 2024 (disposiciones de la CNBV, bolsas de valores incluidas en el
  art. 1): 1 ene, 3 feb, 17 mar, 17 y 18 abr, 1 may, 16 sep, 2 nov (domingo, se lista igual), 17
  nov, 12 dic, 25 dic. La página de la BMV ya solo muestra 2026 (cotejada: coincide con el archivo).
- Cada archivo lleva un campo `fuentes` con la URL de cada año. **Abierto, [minor]**: BMV 2027 está
  derivado con las reglas del DOF; la CNBV publica 2027 en diciembre de 2026 y hay que cotejarlo.
- El aviso de cobertura decía "cubre 2026 y 2027"; ahora dice "cubre de 2025 a 2027"
  (`market_calendar.py` y `history.py`).
- Pruebas nuevas en `tests/unit/b2a/test_market_calendar.py`: NYSE cerrada el 9 ene 2025 y abre el
  10 a las 14:30Z; `last_completed_session` el 10 ene antes de abrir da el 8; cerrada el 4 jul, el 3
  jul cierra a las 17:00Z; BMV cerrada 3 feb, 17 mar, 17 abr, 17 nov y 12 dic de 2025 y abierta el 3
  nov; Pascua 2025 en los dos; fuente por año. `test_correcciones_revision.py` se actualizó: ahora
  se descartan 7 barras (antes 5) y el año completo queda sin ceros inventados.

## Compuertas

- `.venv/bin/python -m pytest -o addopts="" -q`: **1451 pasadas, 5 omitidas** (las `live`).
- `.venv/bin/python -m ruff check .`: **All checks passed**.
- Prueba en vivo del SIE: **4 pasadas**, 12 de 12 series confirmadas.
- No se tocó frontend, así que no corrí `npm run check` ni e2e.

## Para el dueño

- Con token en producción, `/v2/rates/mx` ya publica las 12 series (antes, la tasa objetivo no salía).
- `CONTINUAR.md` sigue diciendo que los ids están mal; lo actualiza quien integre la rama.

# Fase 5, pieza M5BX: series adicionales del SIE

1 de octubre de 2026, rama `ws/M5BX`. Sin navegador. El token se cargó de `.env.local` sin imprimirse
y la salida de la corrida en vivo se revisó con `grep -c` del token = 0.

## Qué se agregó

Las 26 series que pide la spec de la fase 5 (sección "Preparación del orquestador (M5)") viven en la
llave nueva `adicionales` de `kaizen_api/data/banxico_series.json`, no en `series`. La razón: `series`
son los renglones de `/v2/rates/mx` y cada uno necesita un `rateId` del contrato; si las nuevas
entraran ahí, `/v2/rates/mx` dejaría de validar. Pasan por el mismo candado de título, periodicidad,
unidad y `verified`, y el proveedor las expone con `banxico.extra_catalog()`, `extra_for(key)`,
`extra_group(group)` y `scale_for(sid)`; `reviewed()` y `verification()` las conocen igual que a
las de siempre.

Cada serie trae `key` (el id que usa el contrato de su endpoint), `group` (`curva`,
`mercadoDeDinero`, `cruces`, `macro`, `encuesta`), los campos de su grupo (`instrument` y
`tenorYears`, `tenorDays`, `pair`, `item` y `stat`), `maxAgeDays` sacado del hueco más largo entre
datos de octubre de 2023 a octubre de 2026 y `rangoCreible`, la banda de cordura del último dato en
unidades del SIE (por ciento, pesos o millones de dólares).

## Resultado en vivo

`KAIZEN_LIVE=1 .venv/bin/python -m pytest -q -p no:cacheprovider -o addopts="" tests/unit/b2b/test_banxico_live.py -s`:
**7 pasadas**, 12 de 12 del catálogo de siempre y **26 de 26 adicionales confirmadas**. Ninguna
quedó en `verified: false`.

| id | key | título leído en el SIE | periodicidad | unidad | último dato | verificado |
| --- | --- | --- | --- | --- | --- | --- |
| SF43883 | bonoM3 | Valores gubernamentales, Resultados de la subasta semanal, Tasa de rendimiento, Bonos a tasa fija a 3 años | Diaria | Porcentajes | 2026-09-10 (8.24) | sí |
| SF43886 | bonoM5 | Valores gubernamentales, Resultados de la subasta semanal, Tasa de rendimiento, Bono tasa fija 5 años | Diaria | Porcentajes | 2026-09-17 (9.00) | sí |
| SF45384 | bonoM20 | Valores Gubernamentales, Resultados de la subasta semanal, Tasa de rendimiento, Bono tasa fija 20 años | Diaria | Porcentajes | 2026-08-27 (9.64) | sí |
| SF60696 | bonoM30 | Valores Gubernamentales, Resultados de la subasta semanal, Tasa de rendimiento, Bonos a tasa fija a 30 años | Diaria | Porcentajes | 2026-10-01 (10.15) | sí |
| SF61592 | udibono3 | Valores gubernamentales, Resultados de la subasta semanal, Tasa de rendimiento, Udibonos a 3 años | Diaria | Porcentajes | 2026-09-24 (4.00) | sí |
| SF46958 | udibono20 | Valores Gubernamentales, Resultados de la subasta semanal, Tasa de rendimiento, Udibonos a 20 años | Diaria | Porcentajes | 2026-08-27 (4.61) | sí |
| SF46961 | udibono30 | Valores Gubernamentales, Resultados de la subasta semanal, Tasa de rendimiento, Udibonos a 30 años | Diaria | Porcentajes | 2026-09-17 (4.90) | sí |
| SF43878 | tiie91 | Tasas de interés interbancarias, Por ciento anual, TIIE a 91 días | Diaria | Porcentajes | 2026-10-02 (6.9252) | sí |
| SF111916 | tiie182 | TIIE a 182 días | Diaria | Porcentajes | 2026-10-02 (6.9817) | sí |
| SF46410 | EURMXN | Cotización de las divisas que conforman la canasta del DEG, Respecto al peso mexicano, Euro | Diaria | Pesos | 2026-10-01 (20.7457) | sí |
| SF46406 | JPYMXN | Cotización de las divisas que conforman la canasta del DEG, Respecto al peso mexicano, Yen japonés | Diaria | Pesos | 2026-10-01 (0.1162) | sí |
| SF46407 | GBPMXN | Cotización de las divisas que conforman la canasta del DEG, Respecto al peso mexicano, Libra esterlina | Diaria | Pesos | 2026-10-01 (24.2927) | sí |
| SF290383 | CNYMXN | Cotización de las divisas que conforman la canasta del DEG 1/ y del DEG respecto al Peso mexicano 2/, Yuan chino | Diaria | Pesos | 2026-10-01 (2.7344) | sí |
| SF60632 | CADMXN | Cotización de la divisa, Respecto al peso mexicano, Dólar Canadiense | Diaria | Pesos | 2026-10-01 (N/E; último válido 2026-09-29, 12.7113) | sí |
| SE27803 | remittances | Remesas Familiares Total | Mensual | Millones de Dólares | 2026-08-01 (5,452.3367) | sí |
| SF43707 | reserves | Reserva Internacional | Diaria | Millones de Dólares | 2026-09-25 (256,542.8) | sí |
| SR14138 | inflationT.mean | Encuestas sobre las expectativas de los especialistas en economía del sector privado, Expectativas de inflación anual, Inflación general, Al cierre del año en curso (año t), Media | Mensual | Porcentajes | 2026-09-01 (3.85) | sí |
| SR14139 | inflationT.median | (misma encuesta) Inflación general, Al cierre del año en curso (año t), Mediana | Mensual | Porcentajes | 2026-09-01 (3.87) | sí |
| SR14145 | inflationT1.mean | (misma encuesta) Inflación general, Al cierre del siguiente año (año t+1), Media | Mensual | Porcentajes | 2026-09-01 (3.85) | sí |
| SR14146 | inflationT1.median | (misma encuesta) Inflación general, Al cierre del siguiente año (año t+1), Mediana | Mensual | Porcentajes | 2026-09-01 (3.82) | sí, era inferida |
| SR14447 | gdpT.mean | (misma encuesta) Pronósticos de la variación porcentual real anual del PIB, Año en curso (año t), Media | Mensual | Porcentajes | 2026-09-01 (1.40) | sí |
| SR14448 | gdpT.median | (misma encuesta) Pronósticos de la variación porcentual real anual del PIB, Año en curso (año t), Mediana | Mensual | Porcentajes | 2026-09-01 (1.40) | sí, era inferida |
| SR14769 | fxT.mean | (misma encuesta) Expectativas del tipo de cambio al cierre del año, Cierre del año en curso (año t), Media | Mensual | Pesos por Dólar | 2026-09-01 (17.57) | sí, era inferida |
| SR14770 | fxT.median | (misma encuesta) Expectativas del tipo de cambio al cierre del año, Cierre del año en curso (año t), Mediana | Mensual | Pesos por Dólar | 2026-09-01 (17.50) | sí |
| SR14776 | fxT1.mean | (misma encuesta) Expectativas del tipo de cambio al cierre del año, Cierre del siguiente año (año t+1), Media | Mensual | Pesos por Dólar | 2026-09-01 (18.11) | sí |
| SR14777 | fxT1.median | (misma encuesta) Expectativas del tipo de cambio al cierre del año, Cierre del siguiente año (año t+1), Mediana | Mensual | Pesos por Dólar | 2026-09-01 (18.04) | sí |

Los títulos van con comas en lugar de las tiras de espacios del SIE; el texto exacto está en
`tests/unit/b2b/sie_metadatos_2026-10-01.json`.

## Hallazgos

- **Las tres inferidas son lo que suponía la spec.** `SR14146` es la mediana de inflación t+1,
  `SR14448` la mediana del PIB t y `SR14769` la media del tipo de cambio t. Se confirmó leyendo su
  título, no por secuencia.
- **Las unidades reales no son las que listaba la spec.** El SIE no reporta "Pesos por divisa" ni
  "Sin Unidad" en estas 26: los cruces dicen "Pesos", los bonos, la TIIE y la encuesta en por ciento
  dicen "Porcentajes", la encuesta de tipo de cambio dice "Pesos por Dólar" y remesas y reserva dicen
  "Millones de Dólares". Las tres primeras ya pasaban el candado por palabra (`porcentaje`, `peso`).
  Lo único que se amplió es "Millones de Dólares", **por serie** con `unidadExacta` en `SE27803` y
  `SF43707` y un `sieUnit` nuevo, `usdMillions`, que a propósito no tiene palabras en `UNIT_WORDS`:
  sin `unidadExacta` nada pasa como millones de dólares, y una serie de las de siempre con
  "Millones de Dólares" sigue rechazada.
- **[major] El SIE responde 413 con más de 20 ids.** Probado: 20 pasan y 21 no. Con 12 series nunca
  se notó, pero con las 26 nuevas `fetch_metadata` y `verification` habrían fallado. **Corregido**:
  `fetch_series` y `fetch_metadata` parten la lista en tandas de `MAX_IDS_PER_REQUEST = 20` y unen
  las respuestas.
- **SF60696 contra SF60691.** Los dos traen el Bono M a 30 años con el mismo valor (10.15): SF60691
  ("Bonos tasa fija a 30 años") con fecha 2026-09-29 y SF60696 ("Resultados de la subasta semanal,
  Tasa de rendimiento") con fecha 2026-10-01. Con `tituloContiene` "subasta" y "tasa de rendimiento",
  SF60691 no pasa.
- **El dólar canadiense trae N/E en días hábiles.** El 1 de octubre de 2026 el dato oportuno de
  SF60632 fue N/E, y en tres años hubo 29. El proveedor ya lo descarta (nunca 0); quien publique el
  cruce toma el último válido o cae a Frankfurter con `fallback`.
- **La reserva internacional es semanal aunque el SIE diga Diaria** (un dato por viernes, hueco más
  largo de 9 días), y la TIIE a 91 y 182 días se fecha el día hábil siguiente a su determinación
  (el 1 de octubre ya había dato con fecha 2 de octubre).
- **Huecos entre subastas (oct 2023 a oct 2026)**, base de `maxAgeDays`: Bono M 3A y 5A 49 días
  (60), 20A y 30A 63 días (70), Udibono 3A 41 (50), 20A 50 (60), 30A 49 (60).

## Pruebas sin red

- Nuevo `tests/unit/b2b/test_sie_adicionales.py` (29 pruebas) con dos fixtures reales sin token:
  `sie_metadatos_2026-10-01.json` (metadatos de las 26 más SF60691) y `sie_oportuno_2026-10-01.json`
  (el último dato de cada una). Fija que estén las 26 de la spec y ninguna más, la forma de cada
  grupo, que pasen el candado con sus metadatos reales, que ninguna pase por otra (media contra
  mediana, t contra t+1, moneda contra moneda, plazo contra plazo, y contra las de `/v2/rates/mx`),
  que "Millones de Dólares" solo entre por `unidadExacta`, que el último dato real caiga en
  `rangoCreible`, el escalado a fracción y las tandas de 20 ids contra un SIE simulado que responde
  413 con 21.
- `tests/unit/b2b/test_banxico_live.py` ganó dos pruebas en vivo: la tabla de títulos de las
  adicionales y el dato creíble con edad menor o igual a `maxAgeDays`.

## Lo que no hizo esta pieza

- La spec dice en la sección M5 "grabar esas series en una capa 2026-10-01-banxico", pero la
  decisión 4 del orquestador dice que no hay capa compartida de Banxico y que cada stream graba lo
  suyo. No se grabó ninguna capa: Banxico se sigue simulando con `responses` en las pruebas.
