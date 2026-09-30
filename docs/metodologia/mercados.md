# Metodología de Mercados

Qué muestra el panorama de /mercados y cómo se arma cada parte: el estado de cada bolsa, el
percentil del VIX, los tipos de cambio y el resumen del día.

Kaizen es una herramienta educativa y de análisis. Esta página describe cálculos, no es
recomendación de inversión, y el panorama tampoco lo es: dice qué pasó, no qué hacer.

## De dónde salen los datos

El panorama junta tres respuestas del API v2:

- `/v2/markets/overview`: índices, divisas, materias primas y criptomonedas por grupo, con el estado
  de la BMV y de la NYSE.
- `/v2/macro/us`: tasas de Estados Unidos con su cambio en puntos base, el VIX y el DXY.
- `/v2/markets/world`: índices de otros países.

Los precios son de cierre o llegan con retraso; cada bloque dice su fuente, su fecha y si es un
respaldo. El detalle de cada proveedor está en [fuentes-de-datos.md](fuentes-de-datos.md).

## Cada dato una sola vez

Las tres respuestas se enciman, así que antes de dibujar se quitan los repetidos:

- El VIX sale una sola vez, en su medidor de percentil, no en la tabla ni en las tasas.
- El DXY sale en Divisas si el panorama lo trae con precio; si no, en las tasas de Estados Unidos.
- Un símbolo repetido se queda en su primera aparición, y un índice del mundo que ya está en el
  panorama no se repite.

## Estado de cada bolsa

La BMV y la NYSE tienen cada una su insignia, y la fecha de cada cierre se lee en la hora de su
propia bolsa, no en la tuya:

- **Abierta**: dice "Retraso ~15 min" con los minutos que manda el servidor, porque los precios no
  son en vivo.
- **Cerrada**: dice el día de su último cierre, por ejemplo "Cierre vie 18 sep". Ese día sale del
  calendario de la bolsa, con sus días festivos; si el servidor no lo manda, se toma la fecha más
  nueva de los datos de ese grupo.
- Si el servidor no manda el estado, dice "Sin dato" en vez de suponer uno.

## Percentil del VIX

El VIX mide la volatilidad que las opciones del S&P 500 esperan para los siguientes 30 días. Kaizen
no le pone nombre de emoción ("miedo" o "codicia"): solo dice dónde queda el nivel de hoy dentro de
sus propios cierres diarios de los últimos cinco años.

- **Percentil**: la fracción de esos cierres que quedaron en el nivel de hoy o por debajo, llevada
  a un entero de 0 a 100.
- **Contexto**: el mínimo, el máximo y los cuartiles 25, 50 y 75 de esos mismos cierres, para ver
  qué tan lejos está de lo normal.
- **Cuarta parte**: en texto, si queda en la cuarta parte más baja, debajo de la mediana, arriba de
  la mediana o en la cuarta parte más alta de su historia reciente.

Caso probado: con cierres de 10, 12, 14, 16, 18, 20, 22 y 24, un VIX de 15 deja 3 de 8 cierres en
su nivel o por debajo, así que su percentil es 38 y queda debajo de su mediana, en la segunda
cuarta parte.

El VIX que se muestra es el del panorama cuando trae precio, porque es el más reciente; si no, el
de las tasas de Estados Unidos.

Límites: el percentil depende de la ventana, y con otra ventana el mismo nivel cae en otro lugar.
Cinco años pueden incluir o no un episodio extremo. Y un VIX alto no predice qué va a hacer el
mercado: describe lo que las opciones cuestan hoy.

## Tipos de cambio: sin bueno ni malo

Un tipo de cambio que sube no es buena ni mala noticia en sí, así que no se pinta como ganancia o
pérdida. En su lugar se dice qué moneda se movió: si USD/MXN sube, el peso está más débil; si el
DXY sube, el dólar está más fuerte.

## Resumen del día

Son oraciones factuales armadas solo con lo que trae el API, en este orden:

1. Una por índice clave, el S&P/BMV IPC y el S&P 500, con su cambio contra el cierre anterior y su
   nivel en puntos. Si su bolsa ya cerró, dice "cerró con alza" o "cerró con baja"; si está abierta,
   "sube" o "baja" y "va en".
2. El dólar frente al peso, con cuatro decimales, y si eso es peso más débil o más fuerte.
3. Cuántos índices, materias primas y criptomonedas con dato están arriba, abajo o sin cambio. Los
   tipos de cambio no entran a esta cuenta, porque no tienen bueno ni malo.
4. La mayor alza y la mayor baja de ese mismo grupo.
5. Lo que no trajo dato en esta actualización, con su nombre.

Los cambios se redondean a dos decimales, igual que en pantalla, y un cambio que redondea a cero se
dice "sin cambio". El resumen nunca dice por qué se movió algo ni le pone ánimo al mercado: esa
lectura no sale de los datos.

## Supuestos y límites

- Los precios llegan con retraso o son de cierre. El panorama no es una cotización en vivo.
- Fuera del horario de una bolsa, el cambio que se muestra es el de su último día de operación.
- Los grupos y los símbolos del panorama los elige el servidor; si una fuente falla, el renglón sale
  `s/d` y el resumen lo dice.

## Fuentes

- Cboe Global Markets, metodología del índice VIX.
- Calendarios de la BMV (Diario Oficial de la Federación) y de NYSE Group.
- Yahoo Finance para los precios del panorama, incluido USD/MXN, que no es el FIX de Banxico.

## Términos relacionados en el glosario

vix, dxy, dato-con-retraso.
