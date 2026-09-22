# Metodología de FIBRAs

Cómo se miden las FIBRAs en Kaizen, con las definiciones correctas de FFO, AFFO, LTV y cap rate, y
qué se hace cuando un renglón del estado financiero no viene.

Kaizen es una herramienta educativa y de análisis. Nada de esto es recomendación de inversión.

## Qué cambió respecto a la versión anterior

Dos métricas estaban mal etiquetadas, y eso es peor que no tenerlas:

1. Lo que la pantalla llamaba **FFO** era en realidad un flujo libre de efectivo calculado como para
   cualquier empresa. No tenía los ajustes de depreciación inmobiliaria ni la exclusión de ganancias
   por venta de propiedades, que son la razón de ser del FFO.
2. Lo que llamaba **LTV** era `deuda / (deuda + capitalización de mercado)`. Ese número se mueve con
   el precio de la acción y no es comparable contra el límite regulatorio, que está definido sobre
   activos. El LTV es `deuda / valor de los activos`.

Los dos se recalcularon con la definición correcta. Cuando faltan los renglones, la pantalla muestra
`s/d` en vez de un número aproximado.

## Qué es una FIBRA

Un fideicomiso de inversión en bienes raíces, regulado por los artículos 187 y 188 de la Ley del
ISR. Invierte en inmuebles destinados al arrendamiento, tiene que conservarlos al menos cuatro años
y debe distribuir al menos el 95 por ciento de su resultado fiscal cada año. A cambio, no paga ISR a
nivel del fideicomiso: el impuesto se cobra en el tenedor, con retención sobre la distribución.

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
depreciación, y la pantalla dice cuál se aplicó.

## Cap rate implícito

```
cap rate = ingreso operativo neto anual / valor de los inmuebles
```

El ingreso operativo neto son las rentas menos los gastos de operación del inmueble, sin intereses
ni impuestos corporativos. El cap rate implícito usa el valor que el mercado le está poniendo a la
FIBRA, o sea capitalización más deuda menos efectivo, en lugar del valor en libros de los inmuebles.

La comparación que informa es el cap rate implícito contra la tasa de CETES o del bono M del mismo
momento. Ese diferencial es lo que el mercado está pagando por encima de la deuda del gobierno, a
cambio de aceptar riesgo de ocupación, de crédito de los inquilinos y de falta de liquidez.

Cuando el diferencial se comprime a casi nada, la FIBRA está cotizando como si sus rentas fueran tan
seguras como un CETE. Cuando se abre mucho, el mercado está descontando algo.

## LTV

```
LTV = deuda total / valor total de los activos
```

La Comisión Nacional Bancaria y de Valores limita el apalancamiento de las FIBRAs al 50 por ciento
de sus activos totales, y exige además un índice de cobertura de servicio de la deuda. Por eso el
LTV se calcula sobre activos: es la única forma de compararlo contra el límite.

Junto al LTV se muestran, cuando el dato existe, la moneda de la deuda y el perfil de vencimientos.
Una FIBRA con rentas en pesos y deuda en dólares tiene un riesgo que el LTV solo no captura.

## NAV y P/NAV

```
NAV   = valor de los inmuebles − deuda − otros pasivos
P/NAV = precio por certificado / NAV por certificado
```

Un P/NAV debajo de uno significa que el mercado vale el vehículo en menos que la suma de sus
inmuebles. Puede ser oportunidad, o puede ser desconfianza en los avalúos, en la administración o en
el nivel de deuda. El NAV depende de avalúos que se actualizan con rezago, así que el mercado suele
moverse antes que el NAV. Por eso el cap rate implícito sirve como comprobación independiente.

## Rendimiento por distribución

Distribuciones de los últimos doce meses entre el precio por certificado. Es **bruto**: a las
distribuciones se les retiene ISR según los artículos 187 y 188.

La sostenibilidad se revisa contra el AFFO, no contra la utilidad. Si la distribución supera al AFFO
de forma consistente, se está financiando con deuda o con venta de activos, y eso no se sostiene.
La pantalla muestra la razón distribución sobre AFFO junto al rendimiento.

Un rendimiento que sube de golpe casi siempre viene de una caída del precio, no de un aumento de la
distribución. Las dos series se grafican juntas para que eso se vea.

## Qué más se muestra

- Ocupación y su tendencia.
- Plazo promedio ponderado de los contratos de arrendamiento, cuando la FIBRA lo reporta.
- Moneda de las rentas: una FIBRA industrial con rentas en dólares tiene un perfil distinto a una de
  consumo con rentas en pesos.
- Comparación contra las demás FIBRAs del mismo tipo de activo, cuando hay al menos tres.

## Supuestos y límites

- **La cobertura de datos es el límite principal.** Varias FIBRAs no reportan capex de
  mantenimiento separado del capex de expansión, y sin ese renglón el AFFO no se puede calcular. Ahí
  sale `s/d`.
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
