# Metodología del simulador y las metas

Cómo Kaizen simula el futuro de un plan de ahorro, qué modelo usa, qué se puede leer de los
percentiles y qué no.

Kaizen es una herramienta educativa y de análisis. Una simulación traduce supuestos en un rango; no
es una predicción ni recomendación de inversión.

## Qué cambió respecto a la versión anterior

La versión vieja componía rendimientos simples sacados de una normal. Eso permite rendimientos
menores a −100 por ciento, o sea un precio negativo, y sesga el resultado. Ahora el modelo trabaja
en rendimientos logarítmicos, que es lo que hace que el valor nunca cruce el cero.

## El modelo

Por omisión, lognormal. Se convierte la media aritmética anual `m` y la volatilidad anual `s` que tú
pones a los parámetros logarítmicos:

```
σ_l² = ln(1 + s² / (1 + m)²)
μ_l  = ln(1 + m) − σ_l² / 2
```

Con `m = 8%` y `s = 15%`, eso da `μ_l = 0.0674078` y `σ_l = 0.138226`. La conversión importa: usar
8 y 15 por ciento directo como parámetros del logaritmo da un resultado sistemáticamente más alto.

Los parámetros se escalan a la frecuencia del paso, 12 pasos por año por omisión, y cada paso es:

```
W_(t+1) = (W_t + C_t) · e^(ℓ_t)
```

o sea, la aportación entra al inicio del periodo y rinde ese periodo completo. Las aportaciones
crecen con la inflación que pongas, si eliges indexarlas.

## Alternativa: remuestreo por bloques

En vez de sacar números de una normal, se toman bloques de periodos consecutivos de la historia real
del activo, por omisión de 6 meses, y se pegan en orden aleatorio hasta cubrir el horizonte. Eso
conserva colas gordas y volatilidad agrupada, que el modelo lognormal no tiene.

Su límite es honesto y está escrito en la pantalla: solo puede generar futuros parecidos a lo que ya
pasó en la muestra. Si en tu historia no hubo una crisis, el remuestreo tampoco la va a producir.

## Determinismo

El generador es xoshiro128** con semilla, y la semilla se deriva de una cadena de texto. Con los
mismos supuestos y la misma semilla, el resultado es idéntico hasta el último decimal. Eso permite
comparar dos escenarios sabiendo que la diferencia es la diferencia, y no el ruido del muestreo.

Pruebas de sanidad con volatilidad cero, construidas para que `ℓ` sea `ln(1.01)` cada mes durante
12 meses, con capital inicial de 100,000 y aportación de 5,000 al inicio de cada mes:

- Aportación constante: 176,729.14 en todos los percentiles.
- Aportación que crece 1 por ciento al mes: 180,292.00.

Si esos números cambian, la aritmética del simulador se rompió, independientemente del modelo
estadístico.

## Lo que devuelve

- Percentiles 5, 25, 50, 75 y 95 en cada paso, en términos nominales y en términos reales, o sea
  en pesos de hoy descontando la inflación que pusiste.
- Resumen de la distribución final: mediana, media, percentiles y peor decil.
- Probabilidad de alcanzar una meta, que es simplemente la proporción de caminos que terminan
  arriba del objetivo.
- Aportación requerida para una probabilidad dada, por bisección sobre la aportación.

Los caminos individuales no se devuelven por omisión: son 10,000 por 360 pasos y no aportan nada a
la lectura.

Rendimiento: el objetivo es que 10,000 caminos por 360 pasos corran en menos de 400 ms en node. Es
un requisito de diseño, no una medición: mientras no esté implementado el motor no hay número que
reportar. Si no se alcanza, la simulación se mueve a un worker para que la pantalla no se trabe
mientras corre.

## Cómo leer los percentiles

- **El percentil 5 primero.** Es el escenario que tu plan tendría que aguantar. La mediana es el
  número bonito y el que menos información trae.
- **La distancia entre el 5 y el 95 es la incertidumbre.** Si te incomoda, no es que la simulación
  esté mal: es que el activo es así de volátil en ese horizonte.
- **En términos reales.** Un millón de pesos dentro de 20 años con 4 por ciento de inflación son
  456 mil pesos de hoy. La vista real es la que dice si la meta alcanza.
- **La probabilidad no es una garantía.** Una probabilidad de 75 por ciento quiere decir que uno de
  cada cuatro caminos del modelo no llegó.

## Retiro

La vista de retiro presenta un escenario de retiros, con la regla del 4 por ciento como una
referencia histórica estadounidense y no como una prescripción. Se muestra la probabilidad de que el
capital dure el horizonte con la tasa de retiro que pongas, y se dice explícitamente que esa regla
se calibró con datos de Estados Unidos del siglo veinte, con su inflación y sus rendimientos, que no
son los de México.

## Supuestos y límites

- **Los supuestos son tuyos.** Rendimiento esperado, volatilidad e inflación son campos editables.
  Si el rendimiento esperado que pones está mal, el rango estará mal con mucha precisión.
- **Rendimientos independientes entre periodos.** El modelo lognormal no tiene memoria, así que no
  reproduce rachas ni reversión. Para eso está el remuestreo por bloques.
- **Sin impuestos ni comisiones.** El resultado es bruto.
- **Inflación constante.** Se usa una sola tasa para todo el horizonte, cuando en la realidad varía.
- **No modela tu vida.** Un gasto imprevisto, un cambio de ingreso o una emergencia no están en el
  modelo, y son la causa más común de que un plan se desvíe.

## Fuentes

- Metropolis y Ulam (1949) para el método. Boyle (1977) para su uso en finanzas.
- Osborne (1959) y Black y Scholes (1973) para el modelo lognormal de precios.
- Künsch (1989), The Jackknife and the Bootstrap for General Stationary Observations, para el
  remuestreo por bloques.
- Blackman y Vigna, xoshiro128**, para el generador pseudoaleatorio.
- Bengen (1994) y el estudio Trinity (1998) para el origen de la regla del 4 por ciento, con la
  advertencia de que son datos estadounidenses.

## Términos relacionados en el glosario

monte-carlo, lognormal, bootstrap-por-bloques, real-vs-nominal, interes-compuesto,
horizonte-de-inversion, perfil-de-riesgo, inpc, volatilidad.
