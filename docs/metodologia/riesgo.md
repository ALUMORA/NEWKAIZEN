# Metodología de riesgo

Qué mide cada número de la pantalla de riesgo, con qué datos y qué supuesto trae pegado.

Kaizen es una herramienta educativa y de análisis. Nada de esto es recomendación de inversión.

## Los datos de entrada

Todo parte de una serie de rendimientos de la cartera, construida desde el registro de movimientos
y los precios de cierre, en pesos. Tres reglas que no se rompen:

1. **Una sola moneda.** La serie de la cartera va en pesos, y los referentes también. El S&P 500 se
   convierte a pesos con el FIX de cada fecha antes de usarse.
2. **Alineación por fecha.** Las series se cruzan por fecha ISO, no por posición en el arreglo. Los
   días que le faltan a una se caen de la comparación. Esto suena obvio y era justo el defecto de la
   versión anterior, que emparejaba arreglos por índice y comparaba días distintos.
3. **Periodicidad explícita.** La cantidad de periodos por año, 252 para diario, 52 para semanal y
   12 para mensual, se pasa a cada función. No hay ningún 52 escondido.

## Volatilidad

Desviación estándar muestral, dividiendo entre n−1, multiplicada por la raíz de los periodos por
año. Caso probado: rendimientos semanales de 1, 2, −1, 3 y 0 por ciento dan 1.58114 por ciento por
semana y 11.4018 por ciento anual.

Límites conocidos: trata igual una subida grande que una caída grande, cambia mucho con la ventana,
y una ventana tranquila da volatilidad baja justo antes de un choque.

## Caída máxima

En cada fecha, la caída es el valor entre el máximo alcanzado hasta esa fecha, menos uno. La caída
máxima es el mínimo de esa serie. Junto con ella se reportan la fecha del pico, la del fondo, la de
recuperación si existe, y cuántos periodos duró.

Caso probado: valores 100, 120, 90, 110, 80 y 130 dan −33.3333 por ciento, pico en el índice 1,
fondo en el 4 y recuperación en el 5.

Es la medida que la gente sí siente, porque es la pérdida que habría visto en la pantalla.

## VaR y CVaR

Se calculan de dos formas y las dos se muestran etiquetadas.

**Histórica.** Se ordenan los rendimientos observados, se toma `k = ⌈n(1 − α)⌉` y el VaR es el
negativo del k ésimo peor. El CVaR es el negativo del promedio de esos k peores. No supone ninguna
distribución, pero solo puede ver lo que ya pasó en la ventana.

**Paramétrica.** Supone una normal con la media y la desviación de la muestra. Usa una inversa
precisa de la normal acumulada, la aproximación de Acklam. Subestima el riesgo real, porque los
mercados tienen colas más gordas que la normal.

Casos probados: con 20 rendimientos de −5 por ciento a +14 por ciento en pasos de 1 punto, al 95 por
ciento el VaR y el CVaR históricos son 5 por ciento y 5 por ciento; al 90 por ciento, 4 por ciento y
4.5 por ciento. Con media de 4.5 por ciento y desviación de 5.91608 por ciento, los paramétricos al
95 por ciento son 5.2311 por ciento y 7.7032 por ciento.

Un VaR es un umbral, no un máximo. Al 95 por ciento, uno de cada veinte periodos lo rebasa, y puede
rebasarlo por mucho. Por eso siempre se muestra con el CVaR al lado.

## Beta, alfa y medidas contra referente

La regresión es de mínimos cuadrados sobre rendimientos en exceso, o sea restando la tasa libre de
riesgo del periodo a los dos lados. Devuelve alfa por periodo, alfa anualizada de las dos maneras
(compuesta y aritmética), beta, R² y el número de observaciones.

Caso probado: `x = [.01, .02, −.01, .03, 0]`, `y = [.02, .025, −.02, .05, 0]` dan beta 1.65, alfa
−0.0015 y R² 0.972321.

Los referentes son locales y en la misma moneda:

- IPC como rendimiento total: NAFTRAC.MX, el ETF que replica el índice y sí reparte dividendos. El
  nivel del IPC es un índice de precio y no sirve para comparar rendimiento total.
- S&P 500 en pesos: SPY con cierre ajustado, convertido con el FIX de cada fecha.

La beta ajustada de Blume, `0.67 × β + 0.33`, se muestra junto a la beta cruda, y se usa para
proyectar, por ejemplo dentro de un CAPM. La cruda es la que describe lo que pasó.

También se reportan tracking error, que es la desviación estándar de la diferencia contra el
referente anualizada, information ratio, que es el rendimiento activo anual entre el tracking error,
Treynor y las razones de captura al alza y a la baja. Caso probado: diferencias semanales de 1,
−0.5, 0.2 y 0.3 por ciento dan tracking error de 4.42568 por ciento e information ratio de 2.9374.

Advertencia que la pantalla repite: con muestras cortas, alfa e information ratio caben dentro del
error de estimación. Por eso siempre se muestra el número de periodos y la R².

## Sharpe y Sortino

Los dos se calculan sobre rendimientos en exceso contra la tasa libre de riesgo del periodo, que es
la serie de CETES a 28 días convertida al plazo de cada periodo, no una constante.

Sobre esa serie hay una excepción a la regla general de no rellenar huecos, y conviene tenerla
presente al leer cualquiera de estos números: se usa la tasa vigente al inicio de cada periodo y se
arrastra hasta 45 días naturales. Si no hay dato publicado dentro de esa ventana, el periodo sale
nulo en vez de suponer una tasa, y con un solo periodo nulo la medida de esa ventana no se calcula:
la pantalla muestra `s/d` o recorta el tramo. La misma excepción aplica al Treynor, al alfa de
Jensen y a cualquier otra medida que se calcule sobre excesos.

- Sharpe: promedio de los excesos entre su desviación estándar, por la raíz de los periodos por año.
- Sortino: el mismo numerador, con denominador de desviación a la baja, calculada como la raíz del
  promedio de los cuadrados de los excesos negativos sobre TODAS las n observaciones, no solo las
  negativas.

Casos probados: excesos de 1, 2, −1, 3 y 0 por ciento dan Sharpe de 0.632456 por periodo y 4.560702
anualizado con k = 52. Excesos de 2, −1, 3, −2 y 1 por ciento dan Sortino de 0.6 por periodo y
4.32666 anualizado.

## Concentración y contribución al riesgo

Tres lecturas que dicen cosas distintas:

- **Número efectivo de activos**, `1 / Σ w²`. Pesos de 50, 30 y 20 por ciento dan 2.631579.
- **HHI**, `Σ w²`, el recíproco del anterior, aplicado también por sector, país y moneda.
- **Contribución al riesgo**, que reparte la volatilidad de la cartera entre las posiciones:
  la contribución marginal es `(C w)_i / σ_p` y la contribución es `w_i` por su marginal. Las
  contribuciones suman la volatilidad total, y en porcentaje suman 1.

La comparación útil es la columna de peso contra la de riesgo. Donde la segunda es mucho mayor está
la concentración real, que la tabla de pesos no enseña.

La exposición por moneda se calcula aparte y es importante en México: una cartera de puro S&P 500
tiene 500 emisoras y 100 por ciento de exposición al dólar.

## Correlaciones

La matriz de correlaciones se calcula sobre el panel alineado por fecha y se dibuja con una escala
divergente en azul y naranja, no en verde y rojo, porque una correlación alta no es buena ni mala
por sí sola. Los valores se imprimen dentro de las celdas cuando caben, y la gráfica tiene su
equivalente en tabla para lectores de pantalla.

## Supuestos y límites

- Todas estas medidas son descriptivas del pasado de la ventana elegida. Ninguna es un pronóstico.
- La tasa libre de riesgo viene con fecha. Si Banxico no responde, se usa el respaldo de FRED y la
  pantalla lo marca.
- Las correlaciones y betas suben en las crisis, justo cuando más falta haría que bajaran. Una
  cartera puede verse diversificada en una ventana tranquila y no estarlo cuando importa.
- Con menos observaciones que el mínimo documentado de cada función, el resultado es nulo y la
  pantalla muestra `s/d`. No se rellena con cero.

## Fuentes

- Markowitz (1952), Portfolio Selection, Journal of Finance.
- Sharpe (1966), Mutual Fund Performance, Journal of Business.
- Sortino y Price (1994), Performance Measurement in a Downside Risk Framework.
- Jensen (1968) y Treynor (1965) para alfa y la razón de Treynor.
- Blume (1971), On the Assessment of Risk, Journal of Finance.
- Grinold y Kahn (1999), Active Portfolio Management, para tracking error e information ratio.
- Rockafellar y Uryasev (2000), Optimization of Conditional Value-at-Risk, Journal of Risk.
- Acklam, algoritmo de inversa de la normal acumulada.
- Maillard, Roncalli y Teiletche (2010) para contribuciones al riesgo.

## Términos relacionados en el glosario

volatilidad, drawdown-maximo, var, cvar, beta, beta-ajustada, alfa-jensen, tracking-error,
information-ratio, treynor, razon-de-captura, sharpe, sortino, contribucion-al-riesgo,
numero-efectivo-de-activos, hhi, correlacion, tasa-libre-de-riesgo.
