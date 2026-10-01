# Pedidos de V5TS (centro de tasas)

Cada pedido trae la necesidad, por qué y el cambio propuesto. Nada de esto bloquea: V5TS se construyó
contra lo vigente.

## 1. La prueba de capas vacías de M5 no admite una capa ya grabada

- **Necesidad:** que `tests/unit/m5/test_fixture_layers.py::test_empty_layer_stacks_on_base_and_keeps_its_clock[v5ts]`
  pase después de que el stream grabe su capa.
- **Por qué:** la prueba exige `entries == {}` y que `index.json` no tenga `frozen_at`. Las dos cosas
  dejan de ser ciertas en cuanto un stream graba con `scripts/record_fixtures.py`, que escribe 9 llamadas
  en `2026-10-01-v5ts` y copia en la capa el `frozen_at` de la base (el mismo `2026-09-22T14:51:31+00:00`,
  como ya hace la capa compartida `2026-10-01-banxico`). Es la única falla del pytest completo.
- **Cambio propuesto:** que la prueba revise lo que importa (que la capa apila sobre la base y que el
  reloj sigue siendo el de la base) y acepte `entries` no vacío y un `frozen_at` igual al de la base;
  por ejemplo, `assert index.get("frozen_at") in (None, BASE_CLOCK)` y
  `assert set(base_keys) <= set(session.store.keys())`.

## 2. Atribuciones del aviso legal (`src/features/legal/pages/Notice.jsx`)

- **Necesidad:** citar las fuentes del centro de tasas en el aviso legal.
- **Por qué:** la SOFR es "Copyrighted: Citation Required" del Federal Reserve Bank of New York, y las
  demás fuentes piden o agradecen la atribución. La pantalla ya lo dice en `meta.notes`.
- **Cambio propuesto:** agregar estas líneas:
  - Banco de México, Sistema de Información Económica (SIE): CETES, Bonos M, Udibonos, TIIE, tasa
    objetivo, inflación y Encuesta sobre las Expectativas de los Especialistas en Economía del Sector
    Privado, con la fecha de obtención de cada dato.
  - FRED, Federal Reserve Bank of St. Louis: rendimientos del Tesoro a plazo constante (DGS1MO, DGS3MO,
    DGS6MO, DGS1, DGS2, DGS5, DGS10, DGS30) y tasa de fondos federales efectiva (DFF), de dominio público.
  - SOFR: "Federal Reserve Bank of New York, Secured Overnight Financing Rate [SOFR], retrieved from
    FRED, Federal Reserve Bank of St. Louis". Se publica con esa cita.
  - Departamento del Tesoro de EE. UU., Daily Treasury Par Yield Curve Rates y Daily Treasury Par Real
    Yield Curve Rates (home.treasury.gov), de dominio público.

## 3. Glosario

Los términos nuevos ya están en `src/content/glossary-v5/V5TS.js`: `inflacion-implicita`, `tasa-real`,
`forward-implicito`, `encuesta-banxico` y `convencion-de-tasas`. La curva de rendimiento ya existía
(`curva-de-rendimientos`) y se usa tal cual.
