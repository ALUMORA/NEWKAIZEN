# Pedidos de V5FX al orquestador

## 1. `tests/unit/m5/test_fixture_layers.py` falla en cuanto V5FX graba su capa

- **Necesidad:** que `test_empty_layer_stacks_on_base_and_keeps_its_clock[v5fx]` deje de exigir que
  `2026-10-01-v5fx` esté vacía.
- **Por qué:** la spec pide que cada stream grabe una vez en su capa. Al grabar, la sesión escribe
  `entries`, `frozen_at`, `layered_on` y `lookup_order` en `index.json`, así que la prueba (de O) falla
  por diseño. Hoy es la única roja del pytest completo de la rama: 1801 pasan con esa deseleccionada.
- **Cambio propuesto:** que la prueba se salte una capa con `entries` (o que en ese caso solo revise
  que `frozen_at` sea el del set base y `lookup_order` empiece con `2026-09-22`). Lo mismo les va a
  pasar a las demás capas de la fase 5.

## 2. Atribuciones del aviso legal

- **Necesidad:** sumar al aviso legal las fuentes de tipo de cambio.
- **Por qué:** la decisión 5 dice que las atribuciones se piden aquí y las pone O al final.
- **Cambio propuesto:**
  - Banco de México, Sistema de Información Económica (SIE): FIX (SF43718), cruces del peso (SF46410,
    SF46406, SF46407, SF290383, SF60632), TIIE, CETES y fondeo bancario.
  - Federal Reserve Bank of St. Louis, FRED: DGS1MO, DGS3MO, DGS6MO, DGS1 y SOFR.
  - Banco Central Europeo, tipos de referencia vía Frankfurter (api.frankfurter.dev v1), solo como respaldo.
  - Bancos centrales de Brasil, Colombia, Chile, Argentina y Perú vía Frankfurter v2 (mezcla de fuentes,
    se cita así).
  - U.S. Commodity Futures Trading Commission, Commitments of Traders (conjuntos 6dca-aqww y gpe5-46if).
