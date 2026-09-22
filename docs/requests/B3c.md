# Pedidos del stream B3c

Screener de factores, Fórmula Mágica y FIBRAs. Nada de esto bloquea la entrega: los tres endpoints
ya funcionan sin que se resuelva ninguno de estos puntos, porque cada uno tiene su camino honesto
de "todavía no hay dato" en vez de inventar un número.

## 1. B2b: nombre de la función que publica el CETES 28

`domain/screeners/fibras.py` necesita la tasa libre de riesgo para `spreadVsCetes`. La costura está
en `docs/OWNERSHIP.md` como "B2b `domain/rates.py`, rf CETES 28", pero sin nombre de función, y los
dos streams trabajan en paralelo.

Mientras tanto, `fibras.cetes28()` prueba estos nombres en `kaizen_api.domain.rates`, en orden, y se
queda con el primero que sea invocable y devuelva una tasa creíble:

```
get_cetes28, get_rf_current, get_rf_series, get_rf_v2
```

Acepta que devuelvan un número, un objeto con `.rate`/`.as_of` o un dict con cualquiera de las
llaves `rate`, `value`, `yield`, `annual` o `last`, más `asOf`/`as_of`/`date`, `source` y
`fallback`. Si viene mayor que 1 la divide entre 100, y si no cae en `(0, 0.5)` la descarta.

**Pedido:** que B2b confirme el nombre real. Si es otro, basta con agregarlo a la tupla
`RF_FUNCTIONS` de `fibras.py`, que es un archivo de B3c; no hace falta que B2b toque nada.
**Si no llega:** `spreadVsCetes` y `cetes28` salen en `null`, con la nota escrita en `meta.notes`.
Nunca se usa el 8.6 % fijo del legado.

## 2. Tipo de cambio para las emisoras que reportan en otra moneda

CEMEXCPO.MX reporta en dólares y cotiza en pesos. Dividir un EBIT en dólares entre un valor de
empresa en pesos da un número sin sentido, que es justo el defecto que este proyecto vino a quitar,
así que hoy esas emisoras salen de la tabla con el motivo escrito (`same_currency` en
`domain/universe.py`).

**Pedido:** cuando B2a deje firme una costura de tipo de cambio por fecha (`domain/fx.py`), poder
convertir las cifras de los estados a la moneda de cotización antes de calcular las razones.
**Mientras:** el renglón se publica con las métricas de valor en `null` y su `reason`.

## 3. Contrato (`schemas.py`, congelado, no urge)

Dos cosas que se resolvieron dentro de lo que ya permite el modelo, por si a O le interesan:

- `FactorsResponse` no trae campo para la fecha de los fundamentales, solo `meta.asOf`, que hoy se
  llena con la última fecha del histórico de precios. Es la fecha más honesta que existe para el
  tablero completo, porque los estados de cada emisora cierran en meses distintos.
- Las notas de método viajan en `method` (factores) y en `meta.notes` (las tres). Alcanza.

## 4. Universos curados: quién los mantiene

`kaizen_api/data/universe_mx.json`, `universe_us.json` y `fibras_mx.json` son datos, no código:
símbolo, nombre, sector canónico de Yahoo y, en las FIBRAs, el tipo de activo. Se van a quedar
viejos solos (fusiones, cambios de clave, deslistes: ya pasó con TERRA13 y LFPE). No hay pedido
concreto todavía, solo dejar escrito que alguien tiene que revisarlos cada tanto.
