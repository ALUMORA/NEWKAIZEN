# Metodología de valuación y DCF

Cómo Kaizen valúa una emisora: múltiplos con fuente y fecha, y un DCF de dos etapas sobre flujo
libre para la empresa, con todos sus supuestos a la vista.

Kaizen es una herramienta educativa y de análisis. Una valuación es un ejercicio con supuestos, no
un precio objetivo ni recomendación de inversión.

## Qué cambió respecto a la versión anterior

La pantalla vieja tenía una sección llamada DCF que no era un DCF. Era una tabla estática de
múltiplos por sector, tomada del mercado estadounidense, aplicada a cualquier emisora: mexicanas,
bancos y FIBRAs incluidos. No descontaba nada, no tenía tasa, no tenía flujos y no decía de cuándo
eran los múltiplos.

Ahora son dos cosas separadas y etiquetadas: múltiplos comparables, con su fuente y su fecha, y un
DCF de verdad con sus insumos editables.

## Múltiplos

Se calculan P/U, P/VL y EV/EBITDA, cada uno con su valor actual, el múltiplo de referencia de su
sector en los datos de Damodaran y el precio implícito que resulta de aplicar esa referencia. El
precio entre flujo libre (P/FCF) se publica solo como valor actual, sin referencia ni precio
implícito. No hay rendimiento por dividendo en este bloque. Además:

- **La fecha** que acompaña a los múltiplos es la de los datos de Damodaran. La fecha general de la
  valuación es la más reciente entre el cierre fiscal de los estados, la tasa libre de riesgo y el
  tipo de cambio.
- **Las dos monedas**: la de cotización y la de reporte. Si la emisora cotiza en pesos y reporta en
  dólares, las cifras de los estados se convierten antes de dividir, con el tipo de cambio más
  reciente, no con el de la fecha del reporte.
- **Si aplica o no** al tipo de emisora. En bancos, aseguradoras, FIBRAs y fondos, o cuando la
  utilidad de los últimos doce meses es negativa, todo el bloque se marca como no aplicable, con
  la razón escrita. Los valores actuales se siguen publicando, pero sin precio implícito ni rango.

Un P/U sobre una utilidad negativa no se calcula: queda vacío y la pantalla muestra `s/d`, porque
un P/U negativo no es barato.

## DCF de dos etapas

Sobre flujo libre para la empresa:

```
FCFF = EBIT(1 − t) + depreciación y amortización − inversión de capital − Δ capital de trabajo

EV = Σ_(t=1..n) FCFF_t / (1 + WACC)^t
     + [FCFF_n · (1 + g) / (WACC − g)] / (1 + WACC)^n
```

Se descuenta al WACC porque el flujo es para todos los proveedores de capital. Del valor empresa se
restan la deuda neta y el interés minoritario para llegar al valor del capital del accionista, y se
divide entre las acciones en circulación.

Caso probado: `FCFF₀ = 100`, crecimiento de 10 por ciento durante 5 años, crecimiento terminal de
3 por ciento y WACC de 9 por ciento dan 513.93 de la primera etapa, 1,796.87 de valor terminal
descontado y **2,310.80** de valor empresa.

### Supuestos por omisión

Si no se piden otros, Kaizen usa estos, que están escritos junto con su fuente en el código:

- **Crecimiento terminal**: la meta de inflación del banco central de la moneda más 1 punto de
  crecimiento real. Da 3 por ciento en dólares (meta de la Reserva Federal de 2 por ciento) y 4 por
  ciento en pesos (meta de Banxico de 3 por ciento). La tasa libre de riesgo queda solo como tope.
- **Crecimiento de la primera etapa**: arranca en el crecimiento esperado de utilidades del sector
  que publica Damodaran y baja en línea recta, año por año, hasta el crecimiento terminal. Es
  crecimiento de utilidades, no de flujo, y la pantalla lo dice. Si se pide un crecimiento propio,
  se respeta constante durante toda la etapa.
- **Aviso de valor terminal**: si más de 75 por ciento del valor empresa sale del valor terminal,
  la valuación lo avisa, porque entonces el resultado depende sobre todo de dos supuestos de largo
  plazo.

Antes, el crecimiento terminal por omisión era el tope permitido y la primera etapa usaba el
crecimiento de utilidades constante los cinco años. Con eso el DCF salía inflado sin avisar: en
algunas emisoras mexicanas el valor por acción salía más de 50 por ciento arriba del precio con cerca de 80
por ciento del valor en el terminal.

Cuando la emisora cotiza en una moneda y reporta en otra, como las del SIC, el valor por acción del
DCF sale en la moneda de reporte, y la valuación trae un aviso con su equivalente en la moneda de
cotización y el tipo de cambio usado. Si no hay tasa libre de riesgo real en la moneda de reporte,
el DCF se marca como no aplicable con la razón, y los múltiplos se siguen publicando.

## Costo del capital

Con CAPM, incluyendo riesgo país:

```
Re = rf + β_L × prima de mercado + λ × prima de riesgo país
```

La beta se apalanca con la relación de Hamada, partiendo de una beta desapalancada del sector:

```
β_L = β_U × (1 + (1 − t) × D/E)
```

Casos probados: `β_U = 0.8`, `D/E = 0.5` y `t = 30%` dan `β_L = 1.08`. Con `rf = 4.2%`,
prima de mercado de 4.5 por ciento, prima país de 2.5 por ciento y `λ = 1`, el costo del capital es
**11.56 por ciento**.

El coeficiente `λ` es la exposición de la empresa al riesgo país. Una emisora mexicana que factura
la mitad en dólares fuera de México no debería cargar la prima completa, pero hoy `λ` está fijo en
1 y no es editable: la prima país entra completa. Lo que sí se puede mover son la prima de mercado,
la prima país, el crecimiento terminal, los años de proyección y el crecimiento del flujo.

## WACC

```
WACC = (E/V) × Re + (D/V) × Rd × (1 − t)
```

Caso probado: con `Re = 11.56%`, `Rd = 7%`, `t = 30%` y dos tercios de capital, el WACC es
**9.34 por ciento**.

Cuando no hay tasa libre de riesgo en la moneda de los flujos, el WACC se estima en dólares y se
convierte por diferencial de inflación esperada, multiplicando. Si hay tasa en esa moneda, no se
convierte nada:

```
WACC_mxn = (1 + WACC_usd) × (1 + π_mx) / (1 + π_us) − 1
```

Caso probado: 9.34 por ciento con inflación de 3.5 y 2.3 por ciento da **10.62 por ciento**. En
producción las inflaciones son supuestos fijos y marcados como tales: 3 por ciento para México, el
objetivo de Banxico, y 2 por ciento para Estados Unidos, la meta de la Reserva Federal.

Sumar la diferencia de inflación al WACC, que es el atajo común, da un número parecido pero no el
mismo, y el error crece con el nivel de las tasas.

## Las dos guardas

Estas no son opcionales. Cuando un supuesto rompe una, el crecimiento terminal se recorta al
límite y la valuación sale con ese valor recortado, con un aviso que dice cuál guarda se activó, qué
valor se pidió y a cuánto se bajó:

1. **El crecimiento terminal no puede superar la tasa libre de riesgo de esa moneda.** Ninguna
   empresa crece para siempre más rápido que la economía en la que vive, y la tasa libre de riesgo
   nominal es una buena cota superior del crecimiento nominal de largo plazo.
2. **`WACC − g` tiene que ser de al menos 2 puntos porcentuales.** Si no, el valor terminal se
   dispara hacia el infinito y la valuación deja de significar nada. Con `WACC = 9%` y una
   diferencia sana de 6 puntos (`g = 3%`), el valor terminal vale 17.17 veces el flujo del último
   año. Con 2 puntos, que es el mínimo que deja pasar la guarda, ya son 53.50 veces. Y con una
   décima de punto (`g = 8.9%`) se va a 1,089 veces el flujo: el resultado deja de depender del
   negocio y pasa a depender de la resta del denominador.

Por ejemplo, con tasa libre de riesgo de 4.2 por ciento y un crecimiento terminal pedido de 5 por
ciento, la valuación sale con 4.2 por ciento y el aviso lo explica. El número que se ve nunca usa el
supuesto que rompió la guarda. Además, el crecimiento terminal que se puede pedir va de −2 a 6 por
ciento.

## Sensibilidad

El valor central de un DCF no es el resultado: el rango lo es. Se muestra una malla de valor por
acción variando WACC y crecimiento terminal alrededor de los supuestos, para que se vea de
inmediato cuánto se mueve el resultado con cambios chicos: cinco valores de WACC, de 1.5 puntos
abajo a 1.5 arriba, por cinco de crecimiento terminal, de 1 punto abajo a 1 arriba. Las celdas donde
`WACC − g` queda a menos de 2 puntos, o donde el crecimiento pasa de la tasa libre de riesgo, salen
vacías, como `s/d`, en vez de recortarse.

Si la malla va de 30 a 90 pesos, el mensaje es que el DCF no está diciendo mucho con esos insumos, y
eso es información útil, no un fracaso del método.

## Bancos

Bancos y aseguradoras no se valúan con DCF de FCFF. En ellos la deuda es materia prima del
negocio, no financiamiento, así que separar flujo de la empresa y flujo del accionista no funciona
igual. Se usa el P/VL justificado, y el costo del capital sale de la beta de regresión del sector,
que ya viene apalancada, en vez de reapalancar con Hamada:

```
P/VL justificado = (ROE − g) / (Re − g)
```

Caso probado: `ROE = 15%`, `g = 5%` y `Re = 12%` dan **1.4286**. El crecimiento de esta fórmula pasa
por las mismas dos guardas que el DCF, con el costo del capital en lugar del WACC.

Las FIBRAs tampoco: su pantalla usa el rendimiento por distribución, el flujo de operación, el cap
rate implícito, el LTV y el precio contra valor en libros, y está en [fibras.md](fibras.md).

## Supuestos y límites

- **El valor terminal domina.** En un DCF típico a cinco años, más de la mitad del valor viene del
  valor terminal, que depende de dos números que nadie conoce.
- **Los insumos son estimaciones,** incluida la prima de mercado y la prima país, que se publican
  una vez al año y se mueven.
- **La beta del sector es un promedio.** Puede no describir a una empresa con un negocio distinto al
  de sus pares nominales.
- **Los estados financieros vienen con rezago** y pueden traer partidas extraordinarias que
  distorsionan el EBIT del periodo.
- **Un DCF no es un pronóstico de precio.** Es una forma de escribir qué tendría que ser cierto para
  que el precio de hoy tenga sentido.

## Fuentes

- Williams (1938), The Theory of Investment Value.
- Damodaran, Investment Valuation; Equity Risk Premiums y Country Risk, actualizados cada año.
- Koller, Goedhart y Wessels, Valuation (McKinsey).
- Hamada (1972), The Effect of the Firm Capital Structure on the Systematic Risk of Common Stocks.
- Modigliani y Miller (1958, 1963) para el WACC y el escudo fiscal.
- Los supuestos por sector salen de las tablas de Damodaran de enero de 2026 y se guardan con su fecha.

## Términos relacionados en el glosario

dcf, fcff, wacc, capm, beta-apalancada, prima-de-riesgo-de-mercado, riesgo-pais,
crecimiento-terminal, multiplos, p-u, p-vl, ev-ebitda, valor-empresa.
