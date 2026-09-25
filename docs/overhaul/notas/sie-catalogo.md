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
