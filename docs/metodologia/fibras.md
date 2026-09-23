# Metodología de FIBRAs

Cómo se miden las FIBRAs en Kaizen: qué son el FFO, el AFFO, el LTV y el cap rate, cuáles de ellos
calcula Kaizen de verdad y con qué aproximación, y qué se hace cuando un renglón del estado
financiero no viene.

Kaizen es una herramienta educativa y de análisis. Nada de esto es recomendación de inversión.

## Qué cambió respecto a la versión anterior

Dos métricas estaban mal etiquetadas, y eso es peor que no tenerlas:

1. Lo que la pantalla llamaba **FFO** era en realidad un flujo libre de efectivo calculado como para
   cualquier empresa. No tenía los ajustes de depreciación inmobiliaria ni la exclusión de ganancias
   por venta de propiedades, que son la razón de ser del FFO.
2. Lo que llamaba **LTV** era `deuda / (deuda + capitalización de mercado)`. Ese número se mueve con
   el precio de la acción y no es comparable contra el límite regulatorio, que está definido sobre
   activos. El LTV es `deuda / valor de los activos`.

El LTV se recalculó con la definición correcta, y el cociente viejo sigue disponible con su nombre
verdadero, deuda entre capitalización. El FFO no se recalculó: con los estados que da la fuente
pública no se puede armar un FFO honesto, así que la etiqueta se quitó. En su lugar se publica el
flujo de operación entre capitalización, con la base escrita. Cuando faltan los renglones, la
pantalla muestra `s/d` en vez de un número aproximado.

## Qué es una FIBRA

Un fideicomiso de inversión en bienes raíces, regulado por los artículos 187 y 188 de la Ley del
ISR. Invierte en inmuebles destinados al arrendamiento, tiene que conservarlos al menos cuatro años
y debe distribuir al menos el 95 por ciento de su resultado fiscal cada año. A cambio, no paga ISR a
nivel del fideicomiso: el impuesto se cobra en el tenedor, con retención sobre la distribución a
la tasa del artículo 9.

Eso explica por qué su rendimiento por distribución es mucho mayor que el dividendo de una acción, y
por qué la utilidad neta no sirve para valuarlas.

## FFO y AFFO

```
FFO  = utilidad neta
       + depreciación y amortización de inmuebles
       − ganancias por venta de propiedades
       (± ajustes por revaluación de propiedades de inversión, cuando la norma contable los aplica)

AFFO = FFO − capex de mantenimiento − comisiones de arrendamiento
```

El FFO quita dos ruidos. La depreciación inmobiliaria es enorme y no corresponde a un deterioro
real, porque un inmueble bien mantenido no pierde valor al ritmo que marca la tabla contable. Y las
ganancias por venta de propiedades no se repiten, así que inflan un año y desaparecen al siguiente.

El AFFO va un paso más allá y resta lo que sí es salida de efectivo recurrente. Es la cifra más
cercana a lo que de verdad se puede repartir, y es contra la que hay que comparar la distribución.

Un detalle de norma contable: varias FIBRAs mexicanas reportan bajo NIIF y valúan sus propiedades a
valor razonable en vez de depreciarlas. En esos casos el ajuste es por la revaluación y no por la
depreciación.

**Lo que Kaizen calcula hoy no es FFO ni AFFO.** La fuente pública no separa la revaluación, la
depreciación inmobiliaria, el capex de mantenimiento ni las comisiones de arrendamiento, y sumar
utilidad más depreciación no da un FFO cuando la revaluación ya pasó por la utilidad. Lo que se
publica es el **rendimiento de flujo**: flujo de operación entre capitalización, o flujo libre
entre capitalización si no hay flujo de operación, con la base usada escrita al lado. Es una
aproximación útil para comparar, no el FFO del reporte trimestral de la FIBRA.

## Cap rate implícito

```
cap rate = ingreso operativo neto anual / valor de los inmuebles
```

El ingreso operativo neto, en rigor, son las rentas menos los gastos de operación del inmueble,
sin intereses ni impuestos corporativos. La fuente pública no trae ese renglón, así que Kaizen usa
la utilidad de operación del estado de resultados, que se le parece pero incluye gastos corporativos
y, bajo NIIF, puede traer la revaluación de los inmuebles. El cap rate implícito usa el valor que el
mercado le está poniendo a la FIBRA, o sea capitalización más deuda menos efectivo, en lugar del
valor en libros de los inmuebles.

El diferencial que publica la pantalla es el **rendimiento por distribución menos la tasa de CETES a
28 días** del mismo momento, no el cap rate contra CETES. Ese diferencial es lo que el mercado está
pagando por encima de la deuda del gobierno, a cambio de aceptar riesgo de ocupación, de crédito de
los inquilinos y de falta de liquidez. El bono M no se usa.

Cuando el diferencial se comprime a casi nada, la FIBRA está cotizando como si sus rentas fueran tan
seguras como un CETE. Cuando se abre mucho, el mercado está descontando algo.

## LTV

```
LTV = deuda total / valor total de los activos
```

La Comisión Nacional Bancaria y de Valores limita el apalancamiento de las FIBRAs al 50 por ciento
de sus activos totales, y exige además un índice de cobertura de servicio de la deuda. Por eso el
LTV se calcula sobre activos: es la única forma de compararlo contra el límite.

Junto al LTV se publica la deuda entre capitalización, que es el cociente que la versión vieja
llamaba LTV. La moneda de la deuda y el perfil de vencimientos no se muestran: la fuente pública no
los trae. Una FIBRA con rentas en pesos y deuda en dólares tiene un riesgo que el LTV solo no
captura, y hoy hay que buscarlo en su reporte.

## NAV y P/NAV

```
NAV   = valor de los inmuebles − deuda − otros pasivos
P/NAV = precio por certificado / NAV por certificado
```

Kaizen no tiene los avalúos, así que como NAV por certificado usa el **valor en libros por
certificado**: el que publica la fuente o, si falta, el capital contable entre los certificados en
circulación. Bajo NIIF las FIBRAs cargan sus inmuebles a valor razonable, así que el valor en libros
se le parece, pero no es un avalúo independiente, y la pantalla lo dice.

Con ese P/NAV se publica una señal descriptiva: descuento debajo de 0.90, prima arriba de 1.10 y en
línea entre los dos. Describe el precio contra libros; no es una recomendación de inversión.

Un P/NAV debajo de uno significa que el mercado vale el vehículo en menos que la suma de sus
inmuebles. Puede ser oportunidad, o puede ser desconfianza en los avalúos, en la administración o en
el nivel de deuda. El NAV depende de avalúos que se actualizan con rezago, así que el mercado suele
moverse antes que el NAV. Por eso el cap rate implícito sirve como comprobación independiente.

## Rendimiento por distribución

En concepto, son las distribuciones de los últimos doce meses entre el precio por certificado.
Kaizen toma el rendimiento por dividendo que publica la fuente para el certificado y, si no lo trae,
el de los últimos doce meses. Es **bruto**: a la parte
de la distribución que viene del resultado fiscal se le retiene ISR a la tasa del artículo 9, 30 por
ciento, según el artículo 188. Para una persona física residente en México esa retención es un pago a
cuenta: el ingreso se acumula en la declaración anual y lo retenido se acredita. No aplica el 10 por
ciento del artículo 140, que es el de los dividendos de acciones.

La sostenibilidad se revisa contra el AFFO, no contra la utilidad. Si la distribución supera al AFFO
de forma consistente, se está financiando con deuda o con venta de activos, y eso no se sostiene.
Como Kaizen no calcula el AFFO, esa comparación hoy no está en la pantalla: hay que hacerla con el
reporte trimestral de la FIBRA.

Un rendimiento que sube de golpe casi siempre viene de una caída del precio, no de un aumento de la
distribución. La pantalla no grafica las dos series; conviene revisar el precio antes de leer un
rendimiento alto como buena noticia.

## Qué más se muestra

- El tipo de FIBRA: de propiedades, hipotecaria, de energía u otro.
- La tabla ordenada por P/NAV, de menor a mayor, con las que no tienen NAV al final.
- Cuando una FIBRA reporta en una moneda y cotiza en otra, las métricas que mezclan precio con
  estados quedan en `s/d` en vez de dividir pesos entre dólares.

Lo que no se muestra, aunque sería útil: ocupación, plazo promedio de los contratos, moneda de las
rentas y comparación contra pares del mismo tipo. La fuente pública no trae esos datos.

## Supuestos y límites

- **La cobertura de datos es el límite principal.** La fuente pública no separa capex de
  mantenimiento del de expansión, ni la revaluación de la depreciación, y por eso Kaizen no calcula
  FFO ni AFFO, sino el rendimiento de flujo descrito arriba.
- **Los avalúos no son precios.** El valor de los inmuebles viene de valuadores externos con
  criterios propios y se actualiza una o dos veces al año.
- **El sector es chico.** Hay poco más de una docena de FIBRAs listadas, así que las comparaciones
  entre pares tienen muestras muy pequeñas.
- **Nada de esto mide la calidad de la administración**, que en este sector explica buena parte de
  la diferencia entre vehículos con activos parecidos.

## Fuentes

- Ley del Impuesto sobre la Renta, artículos 187 y 188.
- Disposiciones de carácter general aplicables a las emisoras de valores, CNBV, límites de
  apalancamiento e índice de cobertura de servicio de la deuda.
- Nareit, Funds From Operations White Paper, para la definición de FFO y AFFO.
- Appraisal Institute, The Appraisal of Real Estate, para el cap rate.
- Reportes trimestrales de cada FIBRA.

## Términos relacionados en el glosario

fibra, ffo-affo, cap-rate, ltv, nav-p-nav, rendimiento-por-distribucion, retencion-por-dividendos,
cetes, deuda-capital.
