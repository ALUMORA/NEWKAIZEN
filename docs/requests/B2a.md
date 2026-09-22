# Solicitudes del stream B2a

Peticiones a otros dueños. Nada de esto bloquea la fase 2: todo tiene un camino alterno ya escrito
dentro de los archivos de B2a.

## 1. Para B2b: qué devuelve `providers/banxico.py::fetch_series`

**Necesidad.** `/v2/fx` y `/v2/fx/history` tienen que usar el FIX (`SF43718`) cuando hay
`BANXICO_TOKEN`. La costura `fetch_series(series_ids, start, end)` todavía levanta
`NotImplementedError`, así que B2a programó contra su firma y dejó un lector tolerante en
`kaizen_api/domain/fx.py::_parse_banxico`.

**Qué acepta hoy ese lector**, por si B2b escoge otra forma:

1. el sobre crudo del SIE, `{"bmx": {"series": [{"idSerie": "SF43718", "datos": [{"fecha": "22/09/2026", "dato": "18.3500"}]}]}}`;
2. un mapa ya normalizado, `{"SF43718": [("2026-09-22", 18.35), ...]}` o `{"datos": [...]}`.

Fechas en `dd/mm/aaaa` o ISO, valores con punto o coma decimal, y `N/E` tratado como hueco (no como
cero). Si B2b entrega otra cosa, avísame y ajusto `_parse_banxico`; mientras tanto la ruta se va al
respaldo de Yahoo marcado `fallback=true`, que es correcto pero no es el FIX.

**Sugerencia.** Que `fetch_series` devuelva el sobre crudo del SIE tal cual, sin normalizar: así
cada consumidor decide, y las pruebas se pueden escribir contra la respuesta real del proveedor.

## 2. Para O: dónde vive la lectura del índice de la SEC

`/v2/search` usa `company_tickers.json` de la SEC para las emisoras de EE. UU. Por propiedad de
archivos, esa petición HTTP quedó dentro de `kaizen_api/domain/search.py` y no en
`kaizen_api/providers/sec_edgar.py`, que es de B3a. Funciona y está probada, pero la capa correcta
sería el proveedor. **Propuesta para M2 o la fase 4:** mover ahí una función
`company_tickers() -> dict[str, dict]` (símbolo a `{cik, title}`) y que `domain/search.py` la
consuma. No cambia el contrato ni el comportamiento.

Mientras tanto hay dos sesiones de `requests` con el mismo User-Agent descriptivo (el de
`sec_edgar.py` y el de `search.py`). No es un defecto, pero es duplicación.

## 3. Para O: `kaizen_api/data/` solo admite dos nombres de archivo en mi glob

`scripts/ownership.json` le da a B2a `kaizen_api/data/symbols_mx.json` y
`kaizen_api/data/holidays*.json`. Por eso los ETF e índices conocidos de EE. UU. (SPY, QQQ, GLD,
`^GSPC`...) quedaron como constante de Python en `domain/search.py` en vez de un
`data/symbols_us.json`, que sería el lugar natural. Si en M2 se quiere mover, basta con agregar ese
nombre al glob; el formato ya es el mismo que el de México.

## 4. Nota, no solicitud: `/v2/fx` solo maneja USD/MXN

`FxSource.pair` del contrato es `Literal["USDMXN"]`, así que la conversión de históricos solo puede
declarar ese par. `/v2/fx` y `/v2/fx/history` aceptan cualquier par de seis letras por el patrón,
y cualquier otro contesta `400 BAD_REQUEST` con un mensaje que dice qué sí hay. Si algún día se
quieren euros, hay que tocar `schemas.FxSource`, que está congelado.
