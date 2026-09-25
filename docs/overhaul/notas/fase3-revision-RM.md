# Fase 3, revisión RM: Mercados (F2) e Investigar (F3b y F3c)

Stream RM, rama `ws/RM`, worktree `05 NEWKAIZEN.wt/RM`, 25 de septiembre de 2026. Revisión adversaria de lo que se integró el 23
de septiembre sin revisión: `src/features/markets/**` (merge `3d0d920`) y `src/features/research/**` (merges `27e02a5` y
`351667a`), más sus specs e2e. Base: `00a09e9`.

## Veredicto por pantalla

| Pantalla | Veredicto | Nota |
| --- | --- | --- |
| /mercados (panorama) | pass_with_issues | F2-7b corregido; el VIX sin fuentes decía "vacío" en vez de error (corregido). |
| /mercados/mexico | pass_with_issues | FIX duplicado, dólar de Yahoo llamado FIX, serie sin verificar sin marca y respaldo del rf llamado CETES: los cuatro corregidos. |
| /mercados/cetes | pass | Efectiva anual .117455 con 11 % a 28 días, retención de ISR sobre el capital a 365 días, verificadas a mano. |
| /mercados/noticias | pass | Solo titular, fuente y fecha; ligas http(s) con `noopener noreferrer`. |
| Ficha (/investigar/:symbol) | fail, queda pass_with_issues tras las correcciones | DCF con la moneda equivocada, bloque de bancos ausente, `meta.notes` escondidas y formulario atorado en un 422. |
| Comparar | pass | Precios en su moneda, base 100 en pesos y dicho en la descripción. |
| Screener de factores | pass | Sin hallazgos nuevos; lectura de notas coincide con `factors.py`. |
| Fórmula mágica | pass | Utilidad de operación antes que el renglón EBIT, fuera EBIT ≤ 0, financieras, servicios públicos, inmobiliario y FIBRAs. |
| FIBRAs | pass_with_issues | Cinco notas de la tasa que el backend escribe hoy caían en "Notas del cálculo" (corregido). |
| Buscar | pass_with_issues | Enter podía abrir un resultado de la búsqueda anterior (corregido). |

## Hallazgos

### Mercados (F2)

1. **[minor] F2-7b: la etiqueta de `marketStatus` iba en masculino.** `kaizen_api/domain/market_calendar.py:174,181`.
   Repro: BMV a las 9:00 del 22 sep decía "Abierto. Cierra hoy..." junto a la insignia "Abierta". Corregido en `d154025`:
   "Abierta."/"Cerrada." (también "Cerrada por Navidad."). Prueba nueva
   `test_la_etiqueta_habla_de_la_bolsa_en_femenino` y expectativas de pytest, Vitest y e2e al día.
2. **[major] El FIX salía dos veces en /mercados/mexico.** `src/features/markets/pages/MexicoPage.jsx:52-58` (en `00a09e9`).
   Con token de Banxico, `/v2/rates/mx` ya trae `fix` (SF43718, verificada) y la página agregaba "Dólar FIX" de `/v2/fx`,
   la misma serie. Corregido en `f3ab830`: `fxStatSpec` en `shared.js` omite la tarjeta de `/v2/fx` cuando las tasas traen el
   FIX con valor.
3. **[major] El dólar de respaldo de Yahoo se llamaba "Dólar FIX".** Mismo archivo. Cuando `/v2/fx` responde con
   `source: "yahoo"` (sin token), la tarjeta seguía diciendo FIX. Corregido en `f3ab830`: se llama "Dólar en el mercado" y el
   subtítulo dice que no es el FIX.
4. **[major] Serie con `verified: false` sin marca.** `src/features/markets/pages/shared.js:40`. `docs/api-v2.md` promete que
   "la UI lo marca como no verificado" (el Bono M de FRED), y `itemStatus` ignoraba `verified`. Si la respuesta mezclaba
   Banxico y FRED (`meta.fallback: false`), el Bono M salía como dato normal. Corregido en `f3ab830`: `verified === false`
   se marca como respaldo en su DataStatus y el subtítulo dice "sin verificar contra Banxico".
5. **[major] El respaldo de `/v2/rates/rf` se titulaba "CETES 28 días en el tiempo".** `MexicoPage.jsx:121`. Con
   `source: "fred_ir3tib"` la serie es interbancaria a 3 meses de la OCDE, y el propio backend dice "No son CETES". Corregido en
   `f3ab830` con `rfChartText`: "Tasa interbancaria a 3 meses en el tiempo (respaldo)".
6. **[minor] El VIX sin fuentes se mostraba como vacío, no como error.** `src/features/markets/overview/VixCard.jsx:122`.
   Repro: `/v2/markets/overview` y `/v2/macro/us` en 503; la tarjeta decía "Ni el panorama ni las tasas trajeron el VIX en esta
   actualización", como si hubieran respondido. Corregido en `4e351d6`: ErrorState con reintento de las dos.
7. **[minor] La tabla de CETES sacaba el plazo del id aunque el API ya lo manda.** `CetesPage.jsx:21`. Ahora usa `tenorDays`
   del API y el regex queda de respaldo (`f3ab830`).

Verificado sin defecto: efectiva anual `(1 + .11 × 28 ÷ 360)^(365 ÷ 28) − 1 = .1174546`, que la página redondea a 11.75 %;
intereses de $10,000 a 28 días al 11 % = $85.56, retención 10,000 × .009 × 28 ÷ 365 = $6.90, neto $78.65 (lo que asierta el
e2e); 0.90 % de retención en 2026; cambios de tasa en pb iguales a `(valor − previo) × 10,000` en `rates.py` y `macro.py`;
percentil del VIX como distribución empírica (`n ≤ x` entre `n`), sin etiqueta de ánimo; resumen del día sin causas ni
"sentimiento"; USD/MXN y DXY en neutral con pista de texto; sin guiones largos ni lenguaje de compra o venta.

### Investigar (F3b y F3c)

8. **[major] El DCF se mostraba en la moneda de cotización aunque viene en la de los estados.**
   `src/features/research/components/Valuation.jsx:84,87,89,146`. `service.py` manda el DCF en la moneda en que la empresa
   reporta (`dcf.inputs.currency`) y los múltiplos en la de cotización. Repro: CEMEXCPO.MX (reporta USD, cotiza MXN) con
   `perShare = 1.23` salía "$1.23 MXN" junto a un precio de ~13 MXN. Corregido en `efaa908`: `dcfCurrency()` usa
   `dcf.inputs.currency` para el valor por acción, el valor de la empresa y la malla, y un párrafo dice que el DCF va en USD
   y el precio en MXN. De paso, el mock del e2e del SIC traía un aviso que el backend no escribe ("se convirtió con el tipo de
   cambio"); ahora usa la redacción real de `inputs.py:297`.
9. **[major] Un supuesto rechazado dejaba la valuación atorada.** `Valuation.jsx:121-150`. El formulario vivía dentro del
   `QueryBlock`; un 422 (p. ej. crecimiento terminal 7 %, el router acepta hasta 6 %) cambiaba toda la tarjeta por un
   ErrorState cuyo "Reintentar" repetía el mismo 422. Corregido en `efaa908`: los rangos del router se validan antes de
   mandar (`validateAssumptions`, con el rango escrito en el error y `aria-invalid`), la consulta base sostiene la tarjeta y la
   de supuestos propios solo el DCF, y hay "Volver a los supuestos del servidor".
10. **[major] La ficha no mostraba el P/VL justificado de bancos.** `Valuation.jsx` no leía `data.bank`, y para bancos
    `dcf.reason` dice "Se valúa con el P/VL justificado del bloque de bancos". Corregido en `efaa908`: sección "P/VL
    justificado" con múltiplo, precio implícito, ROE, costo de capital propio y crecimiento, o la razón si no aplica.
11. **[major] Ninguna sección de la ficha mostraba `meta.notes`.** `Instrument.jsx` y `Valuation.jsx`. Se perdían, entre
    otras, la de dividendos (`fundamentals.py:771-775`, que explica por qué el rendimiento pagado difiere del de Yahoo), las de
    momentum y los recortes del P/VL justificado. Corregido en `efaa908` con `SectionNotes` en Resumen, Momentum, Dividendos y
    Valuación.
12. **[major] El centro de la malla de sensibilidad salía s/d con el valor principal publicado** (backend).
    `kaizen_api/domain/valuation/dcf.py:259`. Con g recortado a WACC − 2 pp, el redondeo a 6 decimales dejaba `w − g` en
    0.019999999999999997 y la guarda vaciaba la celda. Repro: WACC 7.89 %, g pedido 6 %: `perShare` 508.36 y
    `grid[2][2] = None`; igual con g recortado a rf = 0.04123456. Corregido en `6f813ee` con holgura de 1e-6
    (`GRID_TOLERANCE`) y dos pruebas parametrizadas en `tests/unit/b3b/test_dcf.py`.
13. **[minor] Notas de la tasa en el apartado equivocado de FIBRAs.** `src/features/research/fibras.js:73`. `RATE_NOTE_RE` no
    reconocía cinco notas que el backend escribe hoy: `rates.py:388,391,393,398` ("revisión humana", "El SIE no confirmó",
    "Banxico no respondió", "Banxico no tiene datos de CETES") y `fibras.py:325` ("Todavía no hay tasa de CETES 28").
    Corregido en `74fafe5`, con prueba que copia las cadenas exactas del backend.
14. **[minor] Enter podía abrir una emisora de la búsqueda anterior.** `src/features/research/pages/Search.jsx:67,93`.
    `placeholderData` deja los resultados viejos mientras llega la búsqueda nueva y `submit` los usaba. Repro: buscar
    "walmart", teclear "cemex", esperar el retraso y dar Enter antes de la respuesta: abría WALMEX.MX. Corregido en `74fafe5`
    (si la lista es de relleno, se espera la búsqueda real) con e2e que retrasa la respuesta 1.5 s.
15. **[minor] "Referencia ()" en momentum** cuando `benchmark` viene vacío (`Instrument.jsx:169`). Corregido en `efaa908`.
16. **[minor] Los supuestos del DCF se arrastraban de una emisora a otra** (`Instrument.jsx:266`, sin `key`). Corregido en
    `efaa908` con `key={symbol}`.
17. **[minor] Las ligas de noticias de la ficha no filtraban el protocolo** (`Instrument.jsx:231`), a diferencia de
    /mercados/noticias. Corregido en `efaa908` con `safeUrl` y su prueba.

Lectura de notas por texto (pedidos F3c-2 y F3c-3), contrastada con el backend de hoy:
`ebitFallbackSymbols` (`screenerNotes.js:48-52`) contra `magic.py`, `rateDate` (`fibras.js:127`) contra `fibras.py:380,814`,
y `reasonTag` (`screener-model.js:198-199`) contra `factors.py:337-338,407-408`: coinciden. Solo `RATE_NOTE_RE` difería
(hallazgo 13).

Verificado sin defecto: FIBRAs con distribución y tasa las dos como fracción y diferencial en pp; fórmula mágica con
EY = EBIT ÷ VE y ROC = EBIT ÷ (capital de trabajo neto + activo fijo neto), ranking de competencia 1-2-2-4 y desempate por EY;
DCF con descuento `(1 + WACC)^n`, terminal de Gordon descontado N años y guardas g ≤ rf y WACC − g ≥ 2 pp; momentum 12-1 como
`P(t−1) ÷ P(t−12) − 1`, igual en la ficha y en el screener; deuda entre capital dividida entre 100; sin `?? 0` que invente
datos; cada sección de la ficha con su propio QueryBlock.

### Abiertos, con razón

- **[minor] La tabla de FIBRAs hereda `meta.fallback` de la tasa** (`Fibras.jsx:361`). Se deja así a propósito: la columna de
  diferencial se calcula con esa tasa sustituta, así que la tabla sí contiene un dato de respaldo.
- **[minor, por verificar con datos en vivo] P/VL de emisoras que reportan en otra moneda.** `fundamentals.py:624` usa
  `priceToBook` de Yahoo sin revisar `conv.same`. Con la grabación de AAPL.MX el valor es sano (46.04, no 46 × 18), así que
  Yahoo lo normaliza al menos ahí; falta una grabación de CEMEXCPO.MX para confirmarlo. No se tocó sin evidencia.
- Las cadenas que el front lee de `meta.notes` siguen copiadas a mano en las pruebas de cada lado; un cambio de redacción en
  el backend no rompe ninguna prueba del backend. Conviene un fixture compartido o, mejor, campos estructurados en el
  contrato (decisión del dueño, toca `docs/api-v2.md`).
- Lighthouse no se corrió: las compuertas de este encargo son las de `common.md`.

## Commits

| Commit | Qué |
| --- | --- |
| `d154025` | F2-7b, etiqueta de `marketStatus` en femenino, con pytest |
| `f3ab830` | /mercados/mexico: FIX una vez, dólar de Yahoo no es FIX, serie sin verificar marcada, respaldo del rf sin decir CETES |
| `6f813ee` | B3b: centro de la malla de sensibilidad con g recortado, con pytest |
| `efaa908` | Ficha: DCF en su moneda, P/VL justificado de bancos, avisos por sección, formulario que sobrevive a un 422 |
| `74fafe5` | Notas de la tasa de FIBRAs y búsqueda vieja en el buscador |
| `0588ecb` | Ajuste visual del botón Recalcular y etiquetas sin moneda repetida |
| `4e351d6` | VIX sin fuentes como error con reintento |

Cada corrección tiene prueba que falló antes (comprobado con `git stash` sobre el código de la corrección) y pasa después.

## Compuertas, con números reales

- `npm run check` (lint, typecheck, Vitest, build, bundle): verde; Vitest 2025 de 2025 (antes 2009), JS inicial 133.65 kB
  gzip, 74 % del presupuesto.
- `.venv/bin/python -m pytest -q`: verde, 2 pruebas nuevas de `market_calendar` y 5 casos nuevos de `dcf` incluidos.
- `.venv/bin/python -m ruff check .`: All checks passed.
- e2e con `E2E_PORT=5303`, projects desktop (1440x900) y mobile (390x844), axe WCAG 2.1 AA y sin scroll horizontal dentro de
  los specs: `markets.spec.js` 38 de 38, `research.spec.js` 30 de 30, `research-search.spec.js` 44 de 44 (incluye
  `screeners` de F3b) y `screeners.spec.js` en la corrida conjunta de 137 de 137.
- Inspección del render: capturas de la ficha en los dos anchos (`F3_CAPTURE_DIR`); de ahí salió el ajuste de `0588ecb`
  (el botón Recalcular se estiraba a todo el ancho).
- Una prueba nueva salió intermitente en su primera versión (`getByText('Tipo de cambio FIX')` chocaba con el título del
  popover del glosario); se cambió el localizador y pasó 5 de 5 con `--repeat-each`.
