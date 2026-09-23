# Metodología del optimizador

Qué resuelve el optimizador de Kaizen, con qué algoritmo, contra qué se verifica y por qué el
resultado se presenta como tres carteras y no como una respuesta.

Kaizen es una herramienta educativa y de análisis. El resultado del optimizador no es recomendación
de inversión.

## Qué cambió respecto a la versión anterior

La versión anterior sorteaba 100,000 carteras al azar y se quedaba con la de mejor Sharpe, usando
promedios históricos crudos como rendimientos esperados. Eso tiene dos problemas: el muestreo
aleatorio no encuentra el óptimo en más de tres o cuatro activos, y los promedios históricos son tan
ruidosos que el "óptimo" resultante es en buena medida un ajuste al ruido.

Ahora se resuelve el problema de verdad, con contracción en la matriz de covarianzas, rendimientos
esperados del CAPM por omisión y validación fuera de muestra.

## Datos de entrada

Un panel de rendimientos alineado por fecha, en una sola moneda, con la periodicidad declarada. Si
a un activo le faltan fechas, esas fechas se caen de todo el panel, en todos los activos. Lo que se
reporta es la lista de activos descartados, por ejemplo uno que se quedó con menos fechas que el
mínimo pedido; los días que se cayeron no se enumeran. Nada se rellena hacia adelante.

## Matriz de covarianzas

Por omisión se usa contracción de Ledoit y Wolf con objetivo de correlación constante:

```
C_contraída = δ · F + (1 − δ) · S
```

donde `S` es la muestral con n−1, `F` la matriz que impone a todas las parejas la correlación
promedio, y `δ` entre 0 y 1 sale de la fórmula cerrada que minimiza el error cuadrático esperado.

El resultado es siempre positivo definido, que es la condición para que el optimizador se comporte.
Se verifica contra `CovarianceShrinkage(...).ledoit_wolf(shrinkage_target="constant_correlation")`
de PyPortfolioOpt sobre un panel fijo de 60 por 5, con tolerancia de 1e−10, y ese golden vive en
`tests/golden/`.

El valor de `δ` se muestra en la pantalla. Un delta alto quiere decir que la ventana trae poca
información para tantos activos, y eso es información útil por sí sola.

La matriz muestral cruda sigue disponible, detrás de una advertencia visible.

## Rendimientos esperados

Esta es la parte frágil de toda optimización, así que se maneja con cuidado:

- **Por omisión, CAPM.** `μ_i = rf + β_i × prima de mercado`, con la tasa libre de riesgo de CETES
  28 y la prima como supuesto editable con su fuente y su fecha.
- **Promedio histórico**, disponible pero marcado como ruidoso. Con 3 años de datos semanales, el
  error estándar del promedio es del mismo orden que el promedio.
- **James y Stein**, como punto intermedio: contrae los promedios hacia el rendimiento de la
  cartera de mínima varianza, `μ₀ = (1ᵀC⁻¹μ̂) / (1ᵀC⁻¹1)`, que es la variante de Jorion. Contraer
  hacia el promedio simple de los activos también está disponible, pero no es la opción por omisión.

Todos los supuestos son campos editables en la pantalla. Ninguno está escondido en el código.

## Los problemas que se resuelven

Todos son solo largo y suman `Σ w_i = 1`. Mínima varianza, media varianza, frontera y tangente
aceptan además una caja `l ≤ w ≤ u` por activo. La paridad de riesgo no acepta caja: su solución
ya es interior, y un tope por activo se ignora.

| Cartera | Problema |
| --- | --- |
| Mínima varianza | `min wᵀCw` sujeto a las restricciones. No usa rendimientos esperados |
| Media varianza | `min ½·wᵀCw − τ·wᵀμ`, con `τ ≥ 0` como tolerancia al riesgo: `τ = 0` es la mínima varianza y un `τ` grande se acerca al máximo rendimiento |
| Frontera | Barrido de 30 puntos entre la mínima varianza y el máximo rendimiento alcanzable |
| Tangente | `max (wᵀμ − rf) / √(wᵀCw)`: recorrido de la frontera y refinamiento por sección dorada |
| Paridad de riesgo | `w` tal que `w_i · (C w)_i` sea igual para todo `i` |

El método numérico es FISTA con proyección sobre el simplex con cajas. La proyección es
`w = clip(v − θ, l, u)` con θ encontrado por bisección, y el paso es `1/λmax`, con λmax por
iteración de potencia. La paridad de riesgo usa descenso coordenado cíclico y se detiene cuando el
cambio relativo de los pesos entre dos vueltas baja de 1e−15; las pruebas verifican que las
contribuciones al riesgo quedan iguales dentro de 1e−8.

Si las restricciones son imposibles, o sea `Σ l > 1` o `Σ u < 1`, se lanza un error de
infactibilidad con mensaje en español, no una cartera cualquiera. Por ejemplo, dos activos con
máximo de 35 por ciento cada uno no pueden sumar 100 por ciento.

## Respuestas conocidas

Estas se prueban a seis dígitos o más:

- Proyección: `v = [.5, .3, .2]` con máximo 0.4 da `[.4, .35, .25]`.
- Mínima varianza con volatilidades 20 y 30 por ciento y correlación 0: `w₁ = 0.692308`,
  `σ_p = 0.166410`. Con correlación 0.5: `w₁ = 0.857143`, `σ_p = 0.196396`.
- Tangente con `μ = (10%, 15%)`, `σ = (20%, 30%)`, correlación 0 y `rf = 5%`:
  `[0.529412, 0.470588]`, Sharpe 0.416667.
- Paridad de riesgo con `σ = (20%, 30%)` y correlación 0: `[0.6, 0.4]`.
- Casos de 3 a 10 activos contra scipy SLSQP, dentro de 1e−6, guardados como golden.

## Validación walk forward

El optimizador no se entrega sin su prueba fuera de muestra. El procedimiento:

1. Ventana de estimación de 156 periodos por omisión. Es móvil: en cada vuelta se usan solo los
   últimos 156 periodos. Una ventana que crece desde el inicio de la historia es opcional.
2. Se calculan los pesos usando solo esos datos. Para la cartera tangente, el rendimiento esperado
   de cada vuelta es el promedio histórico de la ventana, no el CAPM de la pantalla principal. O
   sea que la validación fuera de muestra de la tangente mide la versión más ruidosa, no la que se
   muestra por omisión.
3. Se aplican durante los 13 periodos siguientes y se anota el resultado.
4. La ventana se recorre y se repite hasta agotar la historia.

Todo el resultado reportado es fuera de muestra. Una prueba con una estrategia espía falla si en
algún momento se le entrega un índice mayor o igual al primer periodo de aplicación, así que la
fuga de futuro no puede pasar desapercibida. La estrategia de pesos iguales fuera de muestra tiene
que coincidir con su cálculo directo, y eso también está probado.

La pantalla muestra lado a lado el resultado visto en la muestra completa y el walk forward. La
brecha entre los dos es la medida práctica de cuánto del desempeño era ajuste al pasado.

## Supuestos y límites

- **Los insumos mandan.** Cambiar la prima de mercado medio punto mueve la cartera tangente de
  forma notoria. Por eso se muestran tres carteras y la frontera, no un solo resultado.
- **Todo es histórico.** Covarianzas y betas se estiman con datos pasados, y la relación entre
  activos cambia, sobre todo en las crisis.
- **Sin costos.** La optimización no incluye comisiones ni impuestos. El rebalanceo sí los muestra
  antes de confirmar, y mover una cartera hacia el óptimo tiene un costo real que puede superar la
  mejora estimada.
- **Solo largo.** No hay ventas en corto ni apalancamiento, a propósito.
- **Pensado para 40 activos o menos.** El álgebra lineal es de tamaño chico y directa. El límite
  no se valida: con más activos el cálculo corre, pero más lento y con una covarianza peor
  estimada.
- **Optimización no es diversificación.** Un resultado que concentra en dos activos es una señal
  de que la ventana o el universo son estrechos, no una indicación de concentrar.

## Fuentes

- Markowitz (1952), Portfolio Selection, Journal of Finance.
- Tobin (1958) y Sharpe (1964) para el portafolio tangente.
- Ledoit y Wolf (2004), Honey, I Shrunk the Sample Covariance Matrix.
- Michaud (1989), The Markowitz Optimization Enigma, sobre la fragilidad de los insumos.
- Maillard, Roncalli y Teiletche (2010), para paridad de riesgo.
- Beck y Teboulle (2009), FISTA, para el método numérico.
- Pardo (2008), The Evaluation and Optimization of Trading Strategies, para walk forward.
- Referencias numéricas: PyPortfolioOpt y scipy en el entorno `.venv-golden`.

## Términos relacionados en el glosario

ledoit-wolf, frontera-eficiente, minima-varianza, portafolio-tangente, paridad-de-riesgo,
contribucion-al-riesgo, walk-forward, sobreajuste, capm, prima-de-riesgo-de-mercado, covarianza.
