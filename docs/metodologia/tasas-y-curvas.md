# Tasas y curvas

Qué hace la pantalla `/mercados/tasas` y de dónde sale cada número. El país (`?pais=mx|us`) y la
pestaña (`?pestana=curvas|dinero|expectativas`) viven en la URL, así que una liga abre la misma vista.

## Fuentes

- **Banco de México, SIE.** CETES a 28, 91, 182 y 364 días; Bonos M a 3, 5, 10, 20 y 30 años; Udibonos a
  3, 20 y 30 años (resultados de la subasta semanal); TIIE a 28, 91 y 182 días y de fondeo; tasa
  objetivo; inflación anual del INPC (SP30578) y la Encuesta sobre las Expectativas de los
  Especialistas en Economía del Sector Privado. Solo se publica una serie revisada a mano en el catálogo
  que además el SIE confirma por título, periodicidad y unidad; si no, sale `s/d`.
- **FRED.** Rendimientos del Tesoro a plazo constante (DGS1MO, DGS3MO, DGS6MO, DGS1, DGS2, DGS5, DGS10,
  DGS30), la tasa de fondos federales efectiva (DFF) y la SOFR, que se publica con la cita del Federal
  Reserve Bank of New York.
- **Departamento del Tesoro de EE. UU.** CSV de la Daily Treasury Par Yield Curve (plazos de 3, 7 y 20
  años) y de la Daily Treasury Par Real Yield Curve (5, 7, 10, 20 y 30 años). Sustituye a T10YIE de FRED.

## Curvas

- Cada nodo trae su fecha. En México cada plazo cambia solo en su subasta, así que la curva de hoy junta
  datos de días distintos: cuando pasa, la gráfica dibuja los nodos como puntos sueltos, sin línea.
- Las curvas de hace un mes y de hace un año usan, para cada plazo, el último dato publicado en o antes de
  esa fecha.
- **Inflación implícita:** Fisher, `(1 + nominal) / (1 + real) - 1`, y la resta simple en pb. En México es
  Bono M contra Udibono del mismo plazo (3, 20 y 30 años; el Udibono a 10 años no tiene serie de subasta)
  y se muestra cuántos días separan sus fechas. En EE. UU. se usa la curva nominal y la real del Tesoro del
  mismo día.
- **Diferencial México menos EE. UU.:** por plazo, en pb. Si las dos fechas están separadas por más de 7
  días el renglón dice "fechas distintas". La historia a 10 años tiene un punto por subasta del Bono M a
  10 años contra el DGS10 de ese día (o del último publicado hasta 7 días antes).
- Sin token de Banxico, México queda en `s/d` salvo el Bono M a 10 años mensual de la OCDE en FRED, que se
  marca como respaldo.

## Mercado de dinero

Une las tasas de `/v2/rates/mx` (tasa objetivo, TIIE, CETES y Bono M a 10 años) con las de
`/v2/money-market` (TIIE a 91 y 182 días, fondos federales, SOFR y Tesoros cortos), sin repetir valores.
Los cambios van en pb: el del día contra el dato anterior, el de la semana contra el último dato de 7 días
antes o más, y el del mes contra el de 30 días antes o más. Cada renglón dice su convención: simple
act/360 (TIIE y CETES), a un día (fondos federales, SOFR, tasa objetivo) o rendimiento cmt en base bono
(Tesoros). No se comparan directo sin convertirlas.

## Expectativas

- **Encuesta de Banxico:** media y mediana del último levantamiento. El año en curso es el año de la
  fecha del levantamiento (la de diciembre de 2026 consultada en enero de 2027 sigue hablando de 2026).
  Una serie sin verificar sale `s/d`.
- **Tasa real de CETES a 28 días:** ex post contra la inflación observada y ex ante contra la mediana de
  inflación de la encuesta para el año en curso, las dos con Fisher.
- **Forwards implícitos:** con interés simple act/360,
  `f = ((1 + r2 x d2/360) / (1 + r1 x d1/360) - 1) x 360 / (d2 - d1)`. En México con CETES contra la tasa
  objetivo; en EE. UU. con los Tesoros cortos pasados a act/360 con `x 360/365`, contra fondos federales.
  No son un pronóstico: incluyen primas por plazo y liquidez.

Nada de esto es una recomendación de inversión.
