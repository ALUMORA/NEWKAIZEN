# Metodología del screener de factores

Cómo Kaizen ordena un universo de emisoras por factores, por qué lo hace relativo al sector y qué
se hace cuando faltan datos.

Kaizen es una herramienta educativa y de análisis. Un screener ordena emisoras por criterios que tú
puedes leer; no es recomendación de inversión ni lista de compra.

## Qué cambió respecto a la versión anterior

La versión vieja se llamaba "ML Screener" y no tenía nada de aprendizaje automático: era un conjunto
de reglas con pesos escritos a mano. Además contaba dos veces el mismo factor, porque usaba varias
métricas de valuación muy correlacionadas como si fueran independientes, y terminaba emitiendo
etiquetas de compra y venta.

Ahora se llama por lo que es, screener de factores. Los puntajes son relativos al sector, los
múltiplos se convierten a rendimientos antes de ordenar, la cobertura de datos se muestra, y el
resultado son marcas de "cumple" y "no cumple" frente a criterios explícitos.

## El puntaje

Para cada métrica y cada emisora se calcula un puntaje robusto contra la mediana de su sector:

```
z = (x − mediana del sector) / (1.4826 · MAD del sector)
```

recortado al rango `[−3, +3]`. La MAD es la desviación absoluta mediana, y la constante 1.4826 hace
que el resultado sea comparable con una desviación estándar cuando los datos son normales.

Se usa la versión robusta, y no promedio con desviación estándar, porque una sola emisora con un
múltiplo absurdo mueve el promedio y la desviación de todo el sector y desordena el ranking
completo. La mediana no se inmuta.

Caso probado: la serie 10, 12, 14, 16, 18 tiene mediana 14 y MAD 2, así que el puntaje de 18 es
`(18 − 14) / (1.4826 × 2) = 1.349`.

## Por qué relativo al sector

Un P/U de 10 es caro en una minera cíclica y barato en una empresa de consumo estable. Ordenar el
universo entero por múltiplos crudos ordena por sector, no por lo barato que está cada emisora
frente a sus pares. Lo mismo pasa con márgenes: comparar el margen de un supermercado contra el de
una empresa de software no informa nada.

Dos reglas cuando el sector es chico:

- **Menos de 5 emisoras con dato en el sector**: se compara contra todo el universo y la pantalla lo
  marca, porque una mediana de tres datos no es una mediana de nada.
- **Cobertura menor al 50 por ciento del universo** para una métrica: ese factor se excluye del
  puntaje total y se dice por qué. Promediar puntajes donde la mitad de las emisoras no tiene dato
  premia a quien simplemente reporta más.

## Múltiplos convertidos a rendimientos

Todos los múltiplos se invierten antes de ordenar:

| En vez de | Se usa |
| --- | --- |
| P/U | Earnings yield, utilidad entre precio |
| P/VL | Valor en libros entre precio |
| P/FCF | Rendimiento de flujo libre |
| EV/EBITDA | EBITDA entre valor empresa |

La razón es concreta: si ordenas por P/U de menor a mayor, las empresas con pérdidas tienen P/U
negativo y aparecen como las más baratas del universo. Con el rendimiento invertido, una empresa que
pierde dinero tiene rendimiento negativo y queda hasta abajo, que es donde corresponde.

Un múltiplo negativo se muestra como `n/s`, no significativo, no como un número.

## Los factores

| Factor | Cómo se arma |
| --- | --- |
| Valor | Promedio de los puntajes sectoriales de earnings yield, libros a precio y flujo libre a precio |
| Calidad | Promedio de ROIC, margen operativo y su estabilidad, menos deuda a capital |
| Momentum | Puntaje sectorial del rendimiento de 12 meses saltándose el más reciente, contra un referente en la misma moneda |
| Baja volatilidad | Puntaje sectorial de la volatilidad anualizada, con signo invertido |

El puntaje compuesto es el promedio de los factores disponibles, no su suma, para que una emisora a
la que le falta un factor no salga castigada por el simple hecho de tener menos datos.

## Cómo se presenta

- Una tabla ordenable con el puntaje compuesto y cada factor por separado, siempre con el valor
  crudo al lado del puntaje.
- Una columna de cobertura: cuántas de las métricas tenían dato para esa emisora.
- Marcas de "cumple" y "no cumple" contra los criterios que tú configuras, por ejemplo ROIC arriba
  de 12 por ciento o deuda a capital debajo de 1.
- La fecha de los fundamentales, que no es la de hoy: los estados financieros salen con semanas de
  retraso.

Nunca hay una columna que diga qué hacer.

## Supuestos y límites

- **Los factores no son garantías.** Están documentados en artículos académicos, con muestras y
  periodos específicos. El valor se quedó atrás más de una década en Estados Unidos en los años
  2010, y cualquiera de estos factores puede quedarse atrás más tiempo del que aguanta la paciencia
  de casi cualquiera.
- **Riesgo de selección en la literatura.** Muchos factores publicados se eligieron después de ver
  los datos. Harvey, Liu y Zhu argumentan que el umbral de significancia que se usó fue demasiado
  bajo.
- **El universo mexicano es chico.** La BMV tiene pocas emisoras por sector, así que varios sectores
  caen en la regla de menos de 5 y se comparan contra todo el universo.
- **Los fundamentales vienen de una fuente pública** y pueden traer errores o renglones faltantes.
  Donde no hay dato se muestra `s/d`, nunca un valor estimado.
- **Moneda.** Los múltiplos comparan precio en moneda de cotización contra fundamentales en moneda
  de reporte. Kaizen convierte antes de dividir y publica las dos monedas en la pantalla de la
  emisora.

## Fuentes

- Fama y French (1992, 1993, 2015) para valor y rentabilidad.
- Novy-Marx (2013), The Other Side of Value; Asness, Frazzini y Pedersen (2019), Quality Minus Junk.
- Jegadeesh y Titman (1993) para momentum.
- Ang, Hodrick, Xing y Zhang (2006); Baker, Bradley y Wurgler (2011) para baja volatilidad.
- Rousseeuw y Croux (1993), Alternatives to the Median Absolute Deviation, JASA.
- Harvey, Liu y Zhu (2016), and the Cross-Section of Expected Returns, Review of Financial Studies.

## Términos relacionados en el glosario

z-score-sectorial, factor-valor, factor-calidad, baja-volatilidad, momentum-12-1, earnings-yield,
multiplos, roic, margen-operativo, deuda-capital.
