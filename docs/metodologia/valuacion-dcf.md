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

Se muestran P/U, P/VL, EV/EBITDA, rendimiento de flujo libre y rendimiento por dividendo, cada uno
con:

- **Su valor crudo** y la mediana de su sector.
- **La fecha de los fundamentales** con que se calculó, que no es la de hoy.
- **Las dos monedas**: la de cotización y la de reporte. Si la emisora cotiza en pesos y reporta en
  dólares, la conversión se hace antes de dividir, con el tipo de cambio de la fecha del reporte.
- **Si aplica o no** al tipo de emisora. EV/EBITDA no aplica a bancos, y se dice en vez de mostrar
  un número sin sentido.

Un múltiplo negativo se muestra como `n/s`, no significativo, porque un P/U negativo no es barato.

## DCF de dos etapas

Sobre flujo libre para la empresa:

```
FCFF = EBIT(1 − t) + depreciación y amortización − inversión de capital − Δ capital de trabajo

EV = Σ_(t=1..n) FCFF_t / (1 + WACC)^t
     + [FCFF_n · (1 + g) / (WACC − g)] / (1 + WACC)^n
```

Se descuenta al WACC porque el flujo es para todos los proveedores de capital. Del valor empresa se
resta la deuda neta para llegar al valor del capital, y se divide entre las acciones en circulación.

Caso probado: `FCFF₀ = 100`, crecimiento de 10 por ciento durante 5 años, crecimiento terminal de
3 por ciento y WACC de 9 por ciento dan 513.93 de la primera etapa, 1,796.87 de valor terminal
descontado y **2,310.80** de valor empresa.

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
la mitad en dólares fuera de México no carga la prima completa, y ese campo es editable.

## WACC

```
WACC = (E/V) × Re + (D/V) × Rd × (1 − t)
```

Caso probado: con `Re = 11.56%`, `Rd = 7%`, `t = 30%` y dos tercios de capital, el WACC es
**9.34 por ciento**.

Para valuar flujos en pesos con un WACC estimado en dólares, la conversión es por diferencial de
inflación esperada, multiplicando:

```
WACC_mxn = (1 + WACC_usd) × (1 + π_mx) / (1 + π_us) − 1
```

Caso probado: 9.34 por ciento con inflación de 3.5 y 2.3 por ciento da **10.62 por ciento**.

Sumar la diferencia de inflación al WACC, que es el atajo común, da un número parecido pero no el
mismo, y el error crece con el nivel de las tasas.

## Las dos guardas

Estas no son opcionales y la pantalla no deja salir de ellas:

1. **El crecimiento terminal no puede superar la tasa libre de riesgo de esa moneda.** Ninguna
   empresa crece para siempre más rápido que la economía en la que vive, y la tasa libre de riesgo
   nominal es una buena cota superior del crecimiento nominal de largo plazo.
2. **`WACC − g` tiene que ser de al menos 2 puntos porcentuales.** Si no, el valor terminal se
   dispara hacia el infinito y la valuación deja de significar nada. Con `WACC = 9%` y `g = 8.9%`,
   el valor terminal es 90 veces el flujo.

Cuando un supuesto rompe una guarda, la pantalla explica cuál y por qué, en vez de mostrar un
número.

## Sensibilidad

El valor central de un DCF no es el resultado: el rango lo es. Se muestra una malla de valor por
acción variando WACC y crecimiento terminal alrededor de los supuestos, para que se vea de
inmediato cuánto se mueve el resultado con cambios chicos.

Si la malla va de 30 a 90 pesos, el mensaje es que el DCF no está diciendo mucho con esos insumos, y
eso es información útil, no un fracaso del método.

## Bancos

No se valúan con DCF de FCFF. En un banco la deuda es materia prima del negocio, no financiamiento,
así que separar flujo de la empresa y flujo del accionista no funciona igual. Se usa el P/VL
justificado:

```
P/VL justificado = (ROE − g) / (Re − g)
```

Caso probado: `ROE = 15%`, `g = 5%` y `Re = 12%` dan **1.4286**.

Las FIBRAs tampoco: su pantalla usa FFO, AFFO, cap rate y NAV, y está en
[fibras.md](fibras.md).

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
- Los supuestos por sector viven en `kaizen_api/data/damodaran_2026.json`, con su fecha.

## Términos relacionados en el glosario

dcf, fcff, wacc, capm, beta-apalancada, prima-de-riesgo-de-mercado, riesgo-pais,
crecimiento-terminal, multiplos, p-u, p-vl, ev-ebitda, valor-empresa.
