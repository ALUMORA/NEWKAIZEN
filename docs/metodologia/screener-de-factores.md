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

Hay un caso de respaldo: si más de la mitad de los valores son idénticos, la MAD sale cero aunque
la muestra no sea constante. Ahí la escala pasa a ser la desviación estándar muestral, que sí
distingue las colas. Si tampoco hay dispersión, todos los puntajes salen cero.

Caso probado: la serie 10, 12, 14, 16, 18 tiene mediana 14 y MAD 2, así que el puntaje de 18 es
`(18 − 14) / (1.4826 × 2) = 1.349`.

## Por qué relativo al sector

Un P/U de 10 es caro en una minera cíclica y barato en una empresa de consumo estable. Ordenar el
universo entero por múltiplos crudos ordena por sector, no por lo barato que está cada emisora
frente a sus pares. Lo mismo pasa con márgenes: comparar el margen de un supermercado contra el de
una empresa de software no informa nada.

Dos reglas cuando el sector es chico:

- **Menos de 5 emisoras en el sector**: se compara contra todo el universo y la pantalla lo marca,
  porque una mediana de tres datos no es una mediana de nada. Lo que se cuenta son las emisoras del
  sector que siguen en el tablero, no las que tienen dato en cada métrica: un sector de 6 emisoras
  donde solo 2 reportan una métrica se sigue comparando contra su sector en esa métrica.
- **Cobertura menor al 50 por ciento de las métricas de una emisora**: la emisora sale del tablero
  con la razón escrita. De las doce métricas, tiene que traer al menos seis. No hay una regla de
  cobertura por métrica en todo el universo.

## Múltiplos convertidos a rendimientos

Todos los múltiplos se invierten antes de ordenar:

| En vez de | Se usa |
| --- | --- |
| P/U | Earnings yield, utilidad por acción entre precio |
| P/VL | Valor en libros por acción entre precio |
| P/FCF | Rendimiento de flujo libre, flujo libre entre capitalización |
| EV/EBITDA | EBITDA entre valor empresa |

La razón es concreta: si ordenas por P/U de menor a mayor, las empresas con pérdidas tienen P/U
negativo y aparecen como las más baratas del universo. Con el rendimiento invertido, una empresa que
pierde dinero tiene rendimiento negativo y queda hasta abajo, que es donde corresponde.

Por eso un rendimiento negativo se publica como número negativo, no se oculta: su lugar al fondo
del orden es parte de la información.

## Los factores

| Factor | Cómo se arma |
| --- | --- |
| Valor | Promedio de los puntajes de earnings yield, flujo libre a capitalización, EBITDA a valor empresa y libros a precio |
| Calidad | Promedio de los puntajes de ROE, ROA y margen operativo, y de deuda a capital con signo invertido |
| Momentum | Puntaje del rendimiento de 12 meses saltándose el más reciente, sobre el último cierre diario de cada mes, de la emisora sola y en su moneda de cotización, sin restar un referente. Es el mismo cálculo de la ficha de momentum |
| Baja volatilidad | Puntaje de la volatilidad anualizada de rendimientos semanales de dos años, con signo invertido |
| Crecimiento | Promedio de los puntajes de crecimiento de ingresos y de utilidades contra el mismo periodo del año anterior |

Cada factor promedia los puntajes de las métricas que sí tienen dato. El puntaje compuesto es el
promedio de los factores disponibles, no su suma, para que una emisora a la que le falta un factor
no salga castigada por el simple hecho de tener menos datos. Pero hace falta un mínimo: con menos
de tres factores con puntaje, el compuesto no se publica y sale `s/d`.

## Cómo se presenta

- Una tabla ordenable con el puntaje compuesto y cada factor por separado, siempre con el valor
  crudo al lado del puntaje.
- Una columna de cobertura: cuántas de las métricas tenían dato para esa emisora.
- Marcas de "cumple" y "no cumple" contra seis criterios fijos, que hoy no se pueden cambiar:
  earnings yield de 6 por ciento o más, ROE de 15 por ciento o más, margen operativo de 10 por
  ciento o más, deuda a capital de 1 o menos, ingresos creciendo 5 por ciento o más y momentum
  12-1 positivo.
- La fecha del tablero, que es la del último cierre de precio. Los fundamentales pueden ser
  bastante más viejos: los estados financieros salen con semanas de retraso, y esa fecha no se
  publica aquí.

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
  de reporte. Cuando las dos monedas no coinciden, este tablero no convierte: las cuatro métricas
  de valor quedan en `s/d` y la razón queda escrita. La emisora sigue en el tablero con sus otras
  métricas.

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
