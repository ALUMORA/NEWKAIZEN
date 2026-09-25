# Metodología del portafolio

Cómo Kaizen convierte una lista de movimientos en posiciones, resultados y una estimación de
impuestos. Todo lo que se muestra en la pantalla de portafolio sale de estas reglas.

Kaizen es una herramienta educativa y de análisis. Esta página describe cálculos, no es
recomendación de inversión ni asesoría fiscal.

## De qué parte: el registro de movimientos

La fuente de verdad no son las posiciones, son los movimientos. Cada uno tiene fecha, tipo,
emisora, cantidad, precio, comisión, moneda y tipo de cambio. Los tipos son siete:

| Tipo | Qué hace |
| --- | --- |
| compra | Suma acciones y suma al costo, con la comisión incluida en el costo |
| venta | Resta acciones, realiza ganancia o pérdida contra el costo promedio y resta la comisión del producto |
| dividendo | Suma efectivo en la moneda del pago, sin tocar el costo |
| depósito | Suma efectivo, cuenta como flujo externo |
| retiro | Resta efectivo, cuenta como flujo externo |
| split | Multiplica la cantidad y divide el costo promedio, sin cambiar el monto invertido |
| comisión | Resta efectivo, sin asociarse a una emisora |

Las posiciones se derivan de ahí en cada carga. Nunca se guardan posiciones calculadas: si un
movimiento se corrige, todo el historial se recalcula solo.

El tipo de cambio de cada movimiento se llena con el FIX de esa fecha, y se puede editar. Si un
movimiento no trae tipo de cambio, la posición no puede separar efecto precio de efecto tipo de
cambio, y esa columna sale `s/d` en vez de suponer uno.

## Costo promedio

El método es costo promedio de adquisición, que es la práctica mexicana y la base del artículo 129
de la Ley del ISR. Al comprar, el nuevo costo promedio es el total invertido, comisiones incluidas,
entre el total de acciones. Al vender, la ganancia realizada es la cantidad vendida por la
diferencia entre el precio de venta neto de comisión y el costo promedio vigente; el costo promedio
de lo que queda no cambia.

Caso completo, el que corre en las pruebas:

- Compra 10 a 100 y compra 10 a 120: 20 acciones a costo promedio de 110.
- Venta de 5 a 130: ganancia realizada de 100 pesos, quedan 15 acciones a 110.
- Split 2 a 1: 30 acciones a 55, mismo monto invertido.

Vender más de lo que tienes es un error de validación con mensaje en español, no una posición
negativa.

## Efecto precio contra efecto tipo de cambio

Para una posición en otra moneda, el resultado en pesos se parte en dos y los dos suman exactamente
el total, sin dejar un término cruzado suelto:

```
total        = cantidad × (P₁ − P₀) × X₀   +   cantidad × P₁ × (X₁ − X₀)
               efecto precio                   efecto tipo de cambio
```

con `P` el precio en la moneda original y `X` el tipo de cambio en pesos por unidad de esa moneda.

Ejemplo probado: 10 acciones que pasan de 150 a 180 dólares con el tipo de cambio de 17 a 19 pesos
dan 8,700 pesos, o sea 5,100 de precio y 3,600 de tipo de cambio.

Esto importa porque una cartera de acciones estadounidenses puede tener un año entero explicado por
la depreciación del peso, y conviene saber cuánto de tu resultado es la empresa y cuánto es la
moneda.

## Rendimiento: TWR y XIRR

Se calculan los dos porque contestan preguntas distintas.

**TWR**, rendimiento ponderado por tiempo. Parte la historia en tramos, uno por cada fecha de
valuación, calcula el rendimiento de cada tramo y los encadena multiplicando. Quita el efecto de
cuándo metiste dinero, así que es el número comparable contra un índice. El flujo cuenta al cierre
del tramo en que ocurre: se resta del valor final, `r_i = (V_i − flujo_i) / V_(i−1) − 1`, en vez
de sumarse a la base, que le regalaría un tramo completo de rendimiento que ese dinero no tuvo.
Caso probado: de 100 a 110, depósito de 50, de 160 a 144, da −1 por ciento.

Límite: con valuaciones semanales o mensuales, un depósito a media semana no queda bien con
ninguna de las dos convenciones. Para eso haría falta Dietz modificado, que Kaizen no implementa.

Los cierres históricos vienen ajustados por dividendos y splits. Para no mezclar ese precio con el
que de verdad pagaste, el TWR toma cada compra y venta al cierre del corte en que cae (la diferencia
entre tu precio y ese cierre cuenta como flujo, no como rendimiento) y no suma el efectivo de los
dividendos, que ya van dentro del cierre ajustado como si se hubieran reinvertido. Sin eso, cada
compra de una emisora que paga dividendos se anotaba como pérdida el mismo día y, con compras
frecuentes, el TWR caía decenas de puntos. El valor, la ganancia y el XIRR sí son de dinero real:
llevan el efectivo de los dividendos y, cuando el libro arranca dentro de la ventana, parten de lo que
aportaste y no del primer cierre ajustado.

**XIRR**, rendimiento del dinero. Es la tasa que hace cero el valor presente de todos los flujos con
sus fechas reales, incluido el saldo final, sobre base Actual/365. Se resuelve con Newton y, si no
converge, con bisección. Casos probados: −1000 hoy y +1100 a 365 días da 10 por ciento exacto; el
ejemplo de la documentación de XIRR de hoja de cálculo da 0.373362535.

Si tu XIRR es mucho menor que tu TWR, tus aportaciones cayeron en malos momentos. Al revés, en
buenos. Ninguno de los dos es "el correcto": son dos preguntas.

## Valor del portafolio en el tiempo

La serie de valor se arma con los precios de cierre de cada fecha más el efectivo en cada moneda,
todo convertido a pesos con el FIX de esa misma fecha. Los depósitos y retiros son flujos externos.
Una compra sin efectivo suficiente se trata como aportación externa por el faltante, no por el
costo completo: si depositaste 600 y compraste 1,000, la aportación implícita es de 400. Así el TWR
no cuenta ese dinero como rendimiento.

Las posiciones que vienen de una migración de la versión anterior entran como movimientos de
apertura sin fecha de compra. En esas, la fecha de primera compra y el efecto tipo de cambio salen
`s/d`, porque de verdad no se sabe.

## ISR estimado por ganancia de capital

El artículo 129 de la Ley del ISR establece un pago definitivo del 10 por ciento sobre la ganancia
anual neta por enajenar acciones listadas en la BMV, en BIVA o en el SIC. Kaizen lo estima así:

1. Junta todas las ventas del ejercicio.
2. Para cada una, actualiza el costo por el INPC del mes anterior a la venta entre el INPC del mes
   de compra, cuando el INPC está disponible. Si no lo está, usa el costo sin actualizar y lo dice.
3. Suma ganancias y pérdidas del año. Si el neto es negativo, el impuesto es cero y queda una
   pérdida por amortizar.
4. Si el neto es positivo, le resta las pérdidas pendientes de ejercicios anteriores, empezando
   por las más viejas. Una pérdida caduca después de diez ejercicios.
5. Aplica 10 por ciento a lo que queda.

Caso probado: costo de 550 con factor de actualización de 1.05 da 577.50; vendido en 650, la
ganancia es 72.50 y el impuesto estimado 7.25 pesos.

Para dividendos de emisoras mexicanas se muestra por separado la retención del 10 por ciento del
artículo 140, como línea informativa.

**Esto es una estimación y así está etiquetada en la pantalla.** No conoce tus otras operaciones,
no contempla emisoras extranjeras con tratado, no arma tu declaración y no sustituye a un contador.

## Rebalanceo

El rebalanceo calcula operaciones en acciones completas para acercarte a los pesos objetivo que tú
pusiste:

1. Calcula el valor objetivo de cada posición.
2. Baja a acciones enteras por defecto.
3. Con el efectivo restante, compra de una en una la acción que más reduzca la desviación total
   `Σ |w_actual − w_objetivo|`, mientras alcance el dinero.
4. Mejora por pares: vende una acción de una emisora para comprar una de otra, mientras eso baje
   la desviación y el efectivo lo permita. Rescata los casos en que bajar a enteros dejó fuera algo
   caro que el paso anterior ya no alcanza a recomprar. Es búsqueda local: con tres o más activos
   puede quedar una combinación mejor que solo se alcanza moviendo tres posiciones a la vez.
5. Respeta el monto mínimo por operación y la opción de no vender.

Caso probado: con 10,000 pesos, sin posiciones, objetivo 50 y 50 y precios de 300 y 700, el
resultado es 17 del primero y 7 del segundo, sin efectivo sobrante.

Las operaciones se describen como "comprar" y "vender" en su sentido mecánico, porque son los pasos
para llegar a TU objetivo. No son una opinión sobre ninguna emisora. Antes de escribirlas al
registro se confirman en un diálogo y se pueden deshacer.

## Supuestos y límites

- El costo promedio es un método entre varios. Con primeras entradas primeras salidas el resultado
  fiscal sería distinto.
- Las comisiones que se consideran son las que tú capturas. Kaizen no conoce el esquema de tu casa
  de bolsa.
- Los precios son de cierre y con retraso. El valor del portafolio no es una valuación en vivo.
- Las acciones fraccionarias no se manejan en el rebalanceo, a propósito, porque la mayoría de las
  casas de bolsa mexicanas no las ofrecen.
- La estimación de ISR toma el INPC publicado; si falta el mes, el resultado sale sin actualizar y
  la pantalla lo dice.

## Fuentes

- Ley del Impuesto sobre la Renta, artículos 129 y 140.
- INPC del Inegi, publicado también en el SIE de Banxico.
- Tipo de cambio FIX, Banxico, serie SF43718.
- CFA Institute, Global Investment Performance Standards (GIPS) 2020, para TWR y rendimiento
  ponderado por dinero.
- Karnosky y Singer (1994), Global Asset Management and Performance Attribution, para la separación
  entre efecto precio y efecto moneda.

## Términos relacionados en el glosario

costo-promedio, efecto-precio-efecto-fx, twr, xirr, isr-ganancia-de-capital,
retencion-por-dividendos, rebalanceo, tipo-de-cambio-fix.
