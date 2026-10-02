# Tipo de cambio: monitor del peso, FIX contable y forward teórico

Cómo calcula Kaizen lo que muestran `/mercados/tipo-de-cambio`, `/empresas/tipo-de-cambio` y
`/empresas/cobertura`. El código vive en `kaizen_api/domain/fxdesk.py`, `dof_rule.py` y `forward.py`, y
en `src/features/fx/lib/` lo que se calcula en el navegador.

## Fuentes

| Dato | Fuente | Notas |
| --- | --- | --- |
| FIX peso dólar | Banxico SIE, SF43718 | Fechado el día de su determinación. Se lee por `domain/fx.py`. |
| Euro, yen, libra, yuan, dólar canadiense | Banxico SIE, SF46410, SF46406, SF46407, SF290383, SF60632 | Pesos por unidad, desde 2018. |
| Respaldo de esos cruces | Frankfurter v1 (BCE) | Solo si el SIE no tiene dato de los últimos 7 días; sale con `fallback: true`. |
| Real, pesos colombiano, chileno y argentino, sol | Frankfurter v2 | Mezcla de bancos centrales; se citan así. Se descartan sábados y domingos. |
| Posicionamiento | CFTC COT, 6dca-aqww y gpe5-46if, contrato 095741 | Solo futuros, en contratos. |
| Tasas en pesos | Banxico SIE: TIIE 28, 91 y 182 (SF43783, SF43878, SF111916), CETES 28, 91, 182 y 364 (SF43936/39/42/45), fondeo (SF331451) | |
| Tasas en dólares | FRED: DGS1MO, DGS3MO, DGS6MO, DGS1 y SOFR | |

Si el FIX de Banxico no está disponible, el monitor y el FIX contable responden 503: una cotización de
mercado de Yahoo no sustituye al FIX para efectos contables. El forward sí acepta ese respaldo y lo
marca como `fallback`.

## Monitor del peso

- **Cambios** contra el último FIX en o antes de: el día hábil previo, 7 días, un mes, el 31 de
  diciembre anterior y 12 meses. En fracción (`FIX / base − 1`) y en centavos (`(FIX − base) · 100`).
  18.25 contra 18.10 da +15.00 centavos y +0.008287.
- **Rango de 52 semanas**: mínimo y máximo de los FIX del último año. El **percentil** es la fracción
  de esos días con FIX menor o igual al actual: ventana [17, 18, 19, 20] con 19 da 0.75.
- **Volatilidad realizada** de 20, 60 y 250 días: desviación muestral (n−1) de los rendimientos
  logarítmicos por raíz de 252. Cierres [100, 101, 99, 102, 103] dan 0.326231.
- **Histograma** de los movimientos diarios simples del horizonte elegido, en barras de 0.25%.
- **Promedios mensuales**: media, mínimo, máximo y último FIX de cada mes del horizonte.
- **CFTC**: neto = largos − cortos; el cambio es contra el reporte de la semana anterior. Largos 127,595
  y cortos 52,428 dan +75,167; con +87,782 la semana previa, el cambio es −12,615.

## FIX por fecha y regla del DOF

Los días hábiles bancarios son las fechas con FIX en SF43718, no el calendario de la BMV. Un día entre
semana después del último FIX conocido es desconocido, y una fecha que dependa de él sale sin FIX.
Una fecha futura no es error: `fixDate` y `value` salen `null` y la explicación lo dice.

- **Fecha del FIX**: el FIX determinado ese día; si no fue hábil, el último determinado antes.
- **Regla del DOF** (art. 20 del CFF): el tipo publicado en el DOF el día anterior a la fecha, o el
  último publicado antes. El DOF de un día hábil trae el FIX del día hábil anterior. El 30/09/2026 usa
  el DOF del 29/09, que trae el FIX del 28/09; el lunes 05/10/2026 usa el DOF del viernes 02/10, que trae
  el FIX del 01/10.

La pantalla explica la regla y muestra las dos opciones; no la recomienda. Usarla es una decisión
fiscal de cada empresa.

**Cierres de mes**: el FIX que aplica al último día natural del mes con la regla elegida; el promedio es
la media simple de los FIX determinados en el mes. **Conversión por lote**: cada renglón (fecha, monto en
dólares) se cruza con el FIX que aplica a su fecha en una sola consulta de la tabla; el monto en pesos se
redondea a centavos. 1,000 USD del 05/10/2026 con la regla del DOF y un FIX del 01/10 de 18.30 dan
18,300.00 MXN.

## Forward teórico

`F = S · (1 + iMXN · d/360) / (1 + iUSD · d/360)`, con el último FIX como spot. Puntos =
`(F − S) · 10,000`; costo anualizado = `(F/S − 1) · 360/d`.

- TIIE y CETES son act/360 simple; entre plazos se interpola lineal por días y fuera de ellos se usa
  el nodo más cercano.
- Los rendimientos CMT del Tesoro son base 365 y se pasan a act/360 con `· 360/365`: 0.0425 queda en
  0.041918.
- Fondeo y SOFR son overnight y se aplican planos a todos los plazos (Term SOFR de CME no es gratuito).

Con S = 18.00, 8% y 4% a 90 días: F = 18.178218, 1,782.18 puntos y 3.9604% anualizado. Con el Tesoro a
3 meses en 4.25% y 91 días: F = 18.171457.

Es un **precio teórico sin margen bancario**: no es cotización ni sugerencia de cubrirse.

## Presupuesto en dólares (en el navegador)

- Percentil del nivel presupuestal contra los FIX de los últimos 10 años (descriptivo): 19.00 contra
  [17, 18, 19, 20] da 0.75.
- Impacto en pesos de un choque: flujo en dólares por choque. 100,000 USD con +0.50 dan +50,000 MXN.
- El forward a cada cierre de mes se interpola en línea recta entre el spot y los plazos de la tabla;
  más allá del último plazo no se extrapola.
- La mediana de la encuesta de Banxico (tipo de cambio al cierre de año) se lee de `/v2/expectations`
  solo si el servidor anuncia esa capacidad; si no, sale s/d.

No hay probabilidades de rebasar el presupuesto: se quitaron porque se leían como pronóstico.

Nada de esto es una recomendación de inversión ni una sugerencia de cubrirse. La regla del DOF es una lectura del artículo 20 del CFF y la decide tu área fiscal.
