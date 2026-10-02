# Pedidos de V5EC (calendario-economico y tablero-economia)

Stream V5EC, 1 de octubre de 2026. Cada pedido con necesidad, por qué y cambio propuesto. Todo se
construyó contra el contrato vigente: ninguno bloquea las rutas.

## 1. `tests/unit/m5/test_fixture_layers.py` exige que la capa del stream siga vacía

- **Necesidad:** que la prueba pase después de que V5EC grabó sus 15 llamadas en
  `tests/fixtures/recorded/2026-10-01-v5ec` (como pide la spec).
- **Por qué:** `test_empty_layer_stacks_on_base_and_keeps_its_clock[v5ec]` afirma
  `index["entries"] == {}`, `"frozen_at" not in index` y que las llaves de la pila sean las de la base.
  Es cierto solo antes de grabar; a cada stream que grabe le fallará igual.
- **Cambio propuesto:** que la prueba revise lo que sí debe seguir siendo cierto tras grabar: que la
  capa se apila sobre la base, que `frozen_at` (si existe) es igual a `2026-09-22T14:51:31+00:00` y
  que `session.store.frozen_at` es el reloj de la base. Quitar las afirmaciones de capa vacía.

## 2. Atribuciones del aviso legal (`src/features/legal/pages/Notice.jsx`)

- **Necesidad:** que el aviso legal cite las fuentes de /mercados/calendario y /mercados/economia.
- **Por qué:** el Banco Mundial exige atribución CC BY 4.0 en la página y en el aviso; las demás
  piden citar la fuente.
- **Cambio propuesto:** agregar, con fecha de obtención del 1 de octubre de 2026:
  - Banco de México: SIE (SP30578, SP74662, SF61745, SE27803, SF43707) y calendario de anuncios de
    política monetaria 2026.
  - Reserva Federal de St. Louis, FRED (CPIAUCSL, CPILFESL, PCEPILFE, UNRATE, PAYEMS, GDPC1,
    A191RL1Q225SBEA, DCOILWTICO, DFF y los espejos de la OCDE LRHUTTTTMXM156S y NGDPRSAXDCMXQ).
  - Oficina de Estadísticas Laborales de EE. UU. (BLS): calendario de publicaciones (dominio público).
  - Banco Mundial, World Development Indicators, licencia CC BY 4.0.
  - INEGI: calendario de difusión 2026 y primer semestre de 2027 (términos de libre uso del INEGI).
  - Junta de la Reserva Federal: calendario de reuniones del FOMC 2026 y 2027.

## 3. Glosario: `relacionados` hacia términos que aún no existen

- **Necesidad:** ligar `consenso` y `dato-anterior` con un futuro término de calendario si V5TS o V5TM
  lo crean.
- **Cambio propuesto:** ninguno por ahora; los términos de V5EC solo apuntan a slugs que ya existen
  (`tasa-objetivo`, `inpc`, `puntos-base`, `dato-de-respaldo`) o propios.
