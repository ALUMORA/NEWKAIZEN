# B2b: peticiones y avisos para el orquestador

Nada de esto bloqueó el trabajo. Son decisiones que se tomaron dentro de los archivos de B2b y que
le tocan a O confirmar, porque rozan el contrato congelado o la documentación de la API. Los puntos
4 a 6 salieron de la ronda de correcciones de la revisión de fase 2 (rama `ws/B2bf`).

## 1. `symbol` de `GET /v2/news` ya no declara `pattern` en el OpenAPI

**Qué cambió.** El spec pide que un `symbol` vacío se trate como si no viniera, porque es lo que
manda un formulario sin llenar. Con `Query(pattern=SYMBOL_PATTERN)` la cadena vacía fallaba la
validación y salía un 400 `INVALID_SYMBOL`, que no es lo pedido. Ahora el parámetro se declara
`Query(max_length=20)` y la validación del formato se hace dentro de la ruta
(`routers/news.py::_clean_symbol`), que levanta el mismo `ApiError(400, "INVALID_SYMBOL")` con los
mismos `details.fields` de siempre.

**Qué NO cambió.** `/v2/news?symbol=%25` sigue dando 400 `INVALID_SYMBOL` con
`{"field": "query.symbol", "type": "string_pattern_mismatch"}`, y un símbolo de más de 20
caracteres también. Las pruebas de contrato pasan tal cual.

**Lo único que cambia es el esquema del parámetro en el OpenAPI**: donde antes había
`"pattern": "^[A-Za-z0-9.\\-\\^=$]{1,20}$"` ahora hay `"maxLength": 20`. Si O prefiere que el
OpenAPI siga anunciando el patrón, hay que decidir otra cosa para la cadena vacía (por ejemplo
aceptar `^$|<patrón>`), porque las dos cosas juntas no se pueden.

## 2. `MxRateItem.seriesId` lleva un id de FRED cuando el renglón es de respaldo

El contrato describe ese campo como "Id de la serie en el SIE de Banxico (p. ej. SF61745)". Sin
token de Banxico, el único renglón honesto de `/v2/rates/mx` es el Bono M 10 años, que sale de
FRED, y ahí `seriesId` vale `IRLTLT01MXM156N` con `source: "fred"`. El tipo es `str`, así que el
modelo lo acepta; lo que conviene es corregir la descripción a "id de la serie en su fuente" en
`schemas.py` y en `docs/api-v2.md`. Sin eso, el campo dice una cosa y trae otra.

## 3. `RfSeriesResponse.convention` es un `Literal["simple_act360"]` y el respaldo no lo cumple

Cuando `/v2/rates/rf` cae a FRED `IR3TIB01MXM156N` (interbancaria de México a 3 meses, mensual, de
la OCDE), esa serie no tiene la convención de la subasta de CETES. El contrato solo permite ese
literal, así que se publica igual y el aviso va en `meta.notes` y en `fallback: true`. Si más
adelante se quiere ser exacto, el campo tendría que aceptar algo como `"unknown"` o
`"annualized_simple"`. Mientras tanto se construye contra el modelo de hoy.

## 4. `/v2/rates/rf` en respaldo publica `tenorDays: 91`, no el plazo pedido

Cuando no hay CETES de Banxico, la serie que se sirve es `IR3TIB01MXM156N`, que es a 3 meses pida el
cliente el plazo que pida. Antes `tenorDays` repetía el plazo pedido (28, 182 o 364) sobre los mismos
35 puntos, y el cliente que aplica `rf_d = (1 + y * T / 360)^(d / T) - 1` sacaba rf distintos a partir
de datos idénticos. Ahora, con `fallback: true`, `tenorDays` vale 91 y `meta.notes` dice qué plazo
se pidió. Con Banxico no cambia nada: `tenorDays` es el pedido.

**Lo que conviene cambiar fuera de B2b** (archivos que no son míos):

- `docs/api-v2.md`, en la entrada de `GET /v2/rates/rf`: cambiar la fórmula a
  `rf_d = (1 + y * tenorDays / 360)^(d / tenorDays) - 1`, "con el `tenorDays` de la respuesta, que en
  el respaldo de FRED es 91 aunque se haya pedido otro plazo".
- Quien llame a `rfSeriesForDates` en `src/lib/finance/rates.js` tiene que pasarle
  `{ tenorDays: respuesta.tenorDays }`, no el plazo que pidió.

## 5. Con token, solo se publican los ids del SIE con `verified: true`

El spec pide que cada id distinto de SF43718 y SF61745 se verifique contra el endpoint de metadatos
"en una prueba antes de usarse". Antes la bandera `verified` del catálogo no la leía nadie y bastaba
con que el título del SIE se pareciera. Ahora hacen falta las dos cosas: `verified: true` en
`kaizen_api/data/banxico_series.json` (la revisión humana, con `tests/unit/b2b/test_banxico_live.py`)
y que el SIE confirme hoy título, periodicidad y unidad (`banxico.mismatches`). Consecuencia
práctica: el día que llegue el token, `/v2/rates/mx` sale solo con `target` y `fix`, y `/v2/rates/rf`
sigue en el respaldo de FRED, hasta que el dueño corra la prueba en vivo y cambie los flags. Las que
faltan se nombran en `meta.notes`. `docs/api-v2.md` ya dice lo correcto; no hay que tocarlo.

## 6. `summary` de `/v2/news` sale siempre en `null`

El contrato dice "headline + link only" y el docstring de `NewsItem` dice "Titular y liga, nada
más", pero se publicaba el resumen del feed y, para Yahoo, el arranque del artículo (`content.body`)
recortado a 250 caracteres a media palabra. Ahora `summary` va en `null` en todos los renglones. El
tipo `str | None` lo permite, así que no se toca `schemas.py`. Si O quiere cerrar la puerta en el
contrato, el campo podría declararse `None` (o quitarse en una versión futura); eso sí es de O.

## Lo que NO se pide

- No hizo falta ninguna dependencia nueva: `requests`, `responses` y `time-machine` ya estaban.
- No se tocó `schemas.py`, `routers/__init__.py`, `main.py` ni ningún archivo de otro stream.
- La costura de B2a (`domain/markets.py::_bulk_download`) se consumió **con los mismos argumentos**
  desde `domain/macro.py::_yahoo_close_series` en vez de importándola, porque `_bulk_download` tira
  el índice de fechas y `UsMacroItem.asOf` es obligatorio. Es la misma llave de fixture
  (`yf.download:[DX-Y.NYB]?period=5d`), o sea la misma llamada a Yahoo, no una de más. Si B2a
  quiere, puede exponer una variante que conserve las fechas y este archivo la usaría.
