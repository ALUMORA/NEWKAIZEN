# Revisión adversaria de B3b y B3c (22 de septiembre de 2026, sobre 1d4b83a)

B3b: **pass_with_issues**. B3c: **fail**. pytest completo: 1265 passed, 3 skipped.

Verificado bien: respuestas conocidas del spec (DCF 513.93 / 1796.87 / 2310.80, β_L 1.08, Re 11.56 %,
WACC 9.34 % y 10.62 %, P/VL 1.4286, z(18) = 1.349, orden 1, 3, 2 de la mágica), formato de errores,
fracciones, guarda WACC − g ≥ 2 pp en el DCF principal, texto sin guiones largos ni compra/venta,
12-1 de AAPL = 0.334470.

Los scripts de repro se corren desde el worktree con `PYTHONPATH=.` y están en
`/private/tmp/claude-501/-Users-luisalfredolizarragasanchez-Desktop-CLAUDE/592eaab4-fad8-49b0-8982-6cf98fafda5e/scratchpad/`.

## B3b

1. **[major] El momentum 12-1 cuenta posiciones, no fechas.** `momentum.py:156-162` y `monthly_closes`
   (110). Un NaN de Yahoo se descarta y la ventana de 13 cierres se recorre un mes. Repro
   `repro_momentum_gap.py`: misma serie +1 % mensual para emisora y SPY, NaN en marzo 2026 a la
   emisora; sale r12m1 emisora 0.126825, SPY 0.115668, relativo 0.011157 (esperado 0). La ventana
   arranca en 2025-07-01 para la emisora y 2025-08-01 para SPY. Arreglo: ventana por fecha (mes t−12
   y mes t−1 de un calendario de meses) y null si falta alguno, en emisora o referencia.
2. **[major] El P/VL justificado de bancos se salta las guardas.** `service.py:184` pasa a
   `_bank_block` el g sin recortar. Repro `repro_bank_guard.py`: con `?terminalGrowth=0.06` y rf
   4.27 %, justifiedPB 8.5269, impliedPrice 937.96 contra precio 200, `warnings []`. Arreglo: pasar g
   por `clamp_terminal_growth(g, re_value, rf, warnings)` antes de `justified_pb` y publicar el aviso.
3. **[major] Un ADR pierde toda la valuación con un 503 falso.** `service.py:99-112`. Repro
   `repro_adr_503.py` (emisora que reporta en TWD): 503 UPSTREAM_UNAVAILABLE "No tenemos una tasa
   libre de riesgo real en TWD". Se pierden los múltiplos, que sí se pueden calcular. Arreglo: 200 con
   `dcf.applicable=false` y su razón, conservando los múltiplos.
4. **[major] El DCF de emisoras del SIC sale en USD junto a múltiplos en MXN.** Replay AAPL.MX:
   `currency MXN`, `fairValueRange.mid 4131.51` (MXN), `dcf.perShare 237.29` (USD). Única pista
   `dcf.inputs.currency`. Arreglo: pedir en `docs/requests` un `dcf.currency` y `perShare` convertido
   con `fx_rate`; mientras tanto nota explícita en `dcf.warnings`.
5. **[major] Cada combinación de parámetros vuelve a salir a Yahoo y a FRED.**
   `routers/valuation.py:49` mete los parámetros en la llave de caché y `inputs.load` no tiene caché.
   Repro `repro_valuation_calls.py`: cinco valores de erp dan `{'yahoo_load': 5, 'fred': 5}`. Arreglo:
   cachear `inputs.load(sym)` y `risk_free(ccy)` por separado (fundamentals 6 h) y dejar los
   parámetros solo en la capa de cálculo.
6. **[major, metodología] Los supuestos por omisión inflan el DCF sin avisar.** `service.py:238-239`.
   La etapa 1 usa el crecimiento de UPA de analistas del sector (Damodaran growth5y) como crecimiento
   del FCFF (AAPL 18.7 %, WALMEX 19.5 %, CEMEX 26.7 %) y el g terminal por omisión es el tope, rf o
   6 %. Replay: WALMEX 73.04 MXN contra ≈ 45 (tvShare 0.79), CEMEX 2.16 USD contra ≈ 1.00 (0.85),
   AAPL 237.28 contra ≈ 341 (0.84), todos con `warnings` vacío. Arreglo: g terminal por omisión igual
   a inflación ancla más un real modesto (≈ 3 % nominal USD, ≈ 5 % MXN) con rf solo como tope;
   crecimiento de etapa 1 que se desvanece linealmente hacia g; aviso cuando `tvShare` > 0.75.
7. **[minor] La tabla de sensibilidad viola g ≤ rf.** `dcf.py:235` solo revisa los 2 pp. AAPL: rf
   0.047766 pero growths llega a 0.052766 y 0.057766 (celda 514.13 contra base 237.28). Arreglo: null
   en los cruces con g > rf.
8. **[minor] Nota de momentum falsa en monedas sin referencia.** `momentum.py:169,195`. Repro
   `repro_momentum_eur.py`: "Referencia SPY, en EUR, la misma moneda del activo". Arreglo: si la
   moneda no está en el mapa, `benchmark` null, `relative12m1` null y nota honesta.
9. **[minor] `params.py:404-405`** dice "Se mide con FFO y AFFO en el screener de FIBRAs" y ese
   screener no calcula FFO ni AFFO (base "ocf"). Cambiar el texto.
10. **[minor] `meta.asOf` de momentum dice 2026-08-01** cuando el dato es el cierre del 31 de agosto
    (Yahoo fecha las barras mensuales al inicio del mes), y `stale` va fijo en false aunque la rf MXN
    es promedio mensual de la OCDE. Fechar con el último día del mes y calcular `stale`.

No es defecto: `/v2/valuation/NAFTRAC.MX` da ReplayMiss (`income_stmt` no grabado).

## B3c

1. **[blocker] El screener de FIBRAs publica estados ajenos y viejos como actuales.**
   `fibras.py:450-452` y `463`. FMTY14 y FHIPO14 traen el mismo payload byte a byte: el balance de
   Banco Invex, el fiduciario (`shortName 'BANCO INVEX SA INSTITUCION DE B'`), al 2023-12-31, con
   967.7 M de acciones contra 4,804 M de FHIPO y deuda 5.23 mil M contra 38.06 mil M de FMTY. FMTY
   sale `ltv 0.0335` (idéntico a FHIPO) y `cashFlowYield −0.0564` (el de FHIPO). DANHOS13 trae deuda
   de 11,710,529, mil veces menos que los 11.58 mil M del info: `ltv 0.000146`. Arreglo: descartar
   estados con última columna de más de 18 meses, o con acciones que difieran más de 20 % de
   `sharesOutstanding`, o deuda que difiera más de 50 % de `info.totalDebt`; métricas en null con
   motivo en `meta.notes`.
2. **[major] `cetes28` no son CETES.** `fibras.py:289-316` y `266`, `routers/screeners.py:118-120`.
   Replay: `cetes28 0.0679`, que según `/v2/rates/rf` viene de `fred_ir3tib` (interbancaria 3 meses
   OCDE, promedio mensual). `cetes28()` descarta ese source porque no está en `RATE_SOURCES`, así que
   `meta.source` queda "yahoo,computed" y se pierde la nota de B2b "No son CETES de 28 días".
   `spreadVsCetes` de las 10 filas se calcula contra eso. Arreglo: propagar source y nota de
   `get_rf_series`, agregar "fred" a `meta.source` y decir que es sustituto; mejor aún, renombrar
   honestamente en notas o dejar null si la fuente no es Banxico.
3. **[major] `distributionYield` no son distribuciones reales.** `fibras.py:447` usa
   `_div_yield_pct(info)`, el dividendYield hacia adelante de Yahoo redondeado. FUNO: pagos TTM del
   fixture 2.5348 dan 0.0860 y `/v2/instrument/FUNO11.MX/dividends` dice 0.085954; el screener
   publica 0.0871. FMTY: 8.22 contra 6.82 trailing. Arreglo: usar pagos de 12 meses con la costura de
   dividendos de B3a.
4. **[major] El momentum 12-1 del screener no es el de `/v2/momentum`.** `factors.py:183-196`. AAPL
   0.33447 contra 0.24468, WALMEX −0.0710 contra −0.1256, CEMEX 0.2247 contra 0.1248. Factores toma
   como P12 el mes en curso y arma "cierres de fin de mes" con barras semanales fechadas en lunes (la
   barra 2026-08-31 trae el cierre del 4 de septiembre). Arreglo: usar `momentum.r12m1` y
   `monthly_closes` de B3b. Una sola definición en la app.
5. **[major] La fórmula mágica usa el renglón "EBIT" de Yahoo** (utilidad antes de impuestos más
   intereses), no la utilidad de operación. `magic.py:354`. CMCSA 30.2 contra 20.7 mil M, JNJ 1.31x,
   AMGN 1.29x, APD −0.23 contra +2.89 mil M. Con Operating Income PEP sube de 14 a 4, JNJ baja de 4 a
   9, CMCSA de 2 a 5. Arreglo: preferir "Operating Income" y dejar "EBIT" como respaldo anotado.
6. **[minor, latente] `row_value` se queda con el primer renglón aunque venga NaN.**
   `universe.py:390-399`. Repro `repro_rowvalue_nan.py`: EBIT None aunque Operating Income vale 500;
   efectivo None y EV 3000 en vez de 2700. Seguir al siguiente renglón como `_row` en `inputs.py`.
7. **[minor] Símbolos inexistentes en universo custom dan 503.** `routers/screeners.py:67`. Debería
   ser 404 NOT_FOUND o 200 con las filas excluidas.
8. **[minor] `meta.asOf` no es el dato más nuevo.** FIBRAs usa la fecha de la tasa (2026-08-01) y la
   mágica el último cierre fiscal, aunque precios y capitalización son del 21 de septiembre.

Además, anotado por A5 al revisar la metodología: `magic.py:454` no excluye EBIT ≤ 0 y
`MAGIC_EXCLUDED_SECTORS` no quita Real Estate (FIBRAs).

No verificable sin red: factores con un solo símbolo custom (`yf.download:[AAPL]` no grabado).
