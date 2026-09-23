# Metodología de la fórmula mágica

La versión honesta del ranking de Joel Greenblatt: las definiciones exactas, qué se excluye, cómo se
rompen los empates y qué tan lejos queda del libro original.

Kaizen es una herramienta educativa y de análisis. Este ranking ordena emisoras por dos criterios
públicos; no es recomendación de inversión.

## La idea

Greenblatt propone ordenar el universo dos veces, una por lo barato y otra por lo bueno, y sumar las
dos posiciones. Lo barato se mide con el rendimiento de utilidades, y lo bueno con la rentabilidad
del capital. Las emisoras que quedan arriba son, al mismo tiempo, razonablemente baratas y
razonablemente rentables.

Es simple a propósito. Su valor está en ser una regla que no se puede acomodar después de ver el
resultado.

## Rendimiento de utilidades

```
EY = EBIT / valor empresa
```

con el valor empresa completo:

```
valor empresa = capitalización + deuda total + interés minoritario + acciones preferentes
                − efectivo
```

El efectivo es el renglón de efectivo y equivalentes del balance. Las inversiones temporales solo
se restan cuando la fuente las reporta sumadas al efectivo en un mismo renglón; si vienen aparte, se
quedan dentro del valor empresa, que entonces sale un poco más alto de lo que sería con la
definición del libro.

Se usa EBIT y no utilidad neta, y valor empresa y no capitalización, para que el múltiplo no dependa
de cuánta deuda trae la empresa ni de su tasa efectiva de impuestos. Dos empresas con el mismo
negocio y distinta estructura de capital deben salir parecidas.

El EBIT que usa Kaizen es la **utilidad de operación** del estado de resultados. La fuente también
publica un renglón llamado "EBIT", pero lo arma como utilidad antes de impuestos más intereses, así
que arrastra resultados financieros y partidas no operativas: en algunas emisoras difiere de la
utilidad de operación en 30 por ciento o más. Ese renglón solo se usa como respaldo cuando la
utilidad de operación no viene, y la pantalla dice en qué emisoras pasó.

El interés minoritario y las preferentes entran porque son reclamos sobre los mismos activos que
generan el EBIT. Dejarlos fuera abarata artificialmente a las empresas que los tienen, y ese detalle
suele omitirse en las implementaciones sueltas que circulan.

## Rentabilidad del capital

```
ROC = EBIT / (capital de trabajo neto + activo fijo neto)
```

donde el capital de trabajo neto excluye el efectivo y la deuda de corto plazo:

```
capital de trabajo neto = (activo circulante − efectivo) − (pasivo circulante − deuda de corto plazo)
```

con el mismo renglón de efectivo que el valor empresa.

La exclusión del efectivo y de la deuda de corto plazo es deliberada. La idea es medir el capital
tangible que el negocio necesita para operar, no el que trae parqueado ni el que financia con deuda
bancaria de corto plazo. Es la diferencia principal entre esta definición y un ROIC estándar.

## El ranking

1. Se ordena el universo por EY, de mayor a menor. Posición 1 es el mayor rendimiento.
2. Se ordena por ROC, de mayor a menor.
3. Se suman las dos posiciones y se ordena esa suma de menor a mayor.

Caso probado: con `EY = [10%, 8%, 12%]` y `ROC = [50%, 30%, 20%]`, las posiciones por EY son 2, 3, 1
y por ROC son 1, 2, 3, así que las sumas son 3, 5, 4 y el orden final es la primera, la tercera y la
segunda.

**Empates.** Cuando dos emisoras tienen exactamente el mismo valor en una métrica, comparten la
misma posición y la siguiente se salta: 1, 2, 2, 4. Si la suma también empata se desempata por la
posición en EY, que es el criterio más estable de los dos, y si aun así empatan, por la clave de la
emisora en orden alfabético, solo para que el orden sea reproducible. El backend viejo resolvía los empates de otra forma, y ese comportamiento se
conserva en las pruebas de paridad de la versión 1 a propósito, pero no se reproduce en la v2.

## Qué se excluye y por qué

- **Financieras.** Bancos, aseguradoras y casas de bolsa. Su balance no tiene capital de trabajo ni
  activo fijo en el sentido de la fórmula, y su deuda es materia prima, no financiamiento. El propio
  Greenblatt las excluye.
- **Servicios públicos regulados.** Su rentabilidad la fija un regulador, no el mercado.
- **FIBRAs y vehículos inmobiliarios.** Se excluyen por regla, junto con todo el sector
  inmobiliario, y además tienen su propia pantalla.
- **Emisoras sin utilidad de operación reportada o sin los renglones necesarios.** Salen del
  ranking con la razón escrita, no con un cero.
- **Emisoras con utilidad de operación de cero o negativa.** También salen, como en el método
  original: un rendimiento sobre capital negativo no dice nada útil sobre qué tan barata está una
  empresa rentable.
- **Emisoras con capital empleado de cero o negativo, o con valor empresa de cero o negativo.** El
  cociente no tiene lectura y se excluyen.
- **Emisoras chicas.** Hay un piso de capitalización: 2,000 millones de dólares en el universo
  estadounidense y 5,000 millones de pesos en el mexicano.
- **Emisoras que reportan en una moneda y cotizan en otra.** Se excluyen en vez de convertir,
  para no mezclar monedas.
- **Emisoras por las que el proveedor no respondió.** Quedan fuera con ese motivo.

La pantalla muestra siempre cuántas emisoras quedaron dentro, cuántas se excluyeron y por qué. Un
ranking de 12 emisoras sobre un universo de 130 no dice lo mismo que uno de 100.

## Diferencias con el libro

Hay que decirlas porque cambian el resultado:

- Greenblatt trabaja sobre el universo estadounidense, con miles de emisoras y un corte por
  capitalización mínima. Kaizen también corta por capitalización, pero su universo mexicano tiene
  decenas de emisoras, así que el ranking es mucho más sensible a una sola exclusión.
- El libro usa datos de un proveedor comercial con estados normalizados. Aquí los estados vienen de
  una fuente pública y pueden traer renglones faltantes o clasificados distinto.
- El libro propone además una disciplina de rotación anual y un horizonte de varios años. Kaizen no
  propone ninguna disciplina de operación: solo muestra el ranking de hoy.
- Los resultados históricos que cita el libro son de una muestra específica y tienen los sesgos de
  cualquier backtest, incluido el de supervivencia.

## Cómo leerlo

Es un punto de partida para investigar, no un resultado. Una emisora arriba del ranking puede estar
barata porque el mercado ya sabe algo que los estados todavía no reflejan. Lo primero que conviene
ver de cada una es la fecha de los estados financieros, si el EBIT trae partidas extraordinarias y
cuánto pesa la deuda.

## Fuentes

- Greenblatt (2006), The Little Book That Beats the Market.
- Damodaran, Investment Valuation, para las definiciones de valor empresa y capital invertido.
- Estados financieros de las emisoras, vía la fuente de datos documentada en
  [fuentes-de-datos.md](fuentes-de-datos.md).

## Términos relacionados en el glosario

formula-magica, earnings-yield, roic, valor-empresa, multiplos, factor-valor, backtest-sesgos.
