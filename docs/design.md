# Sistema de diseño de Kaizen (C1)

API **congelada** en el checkpoint C1 (22 de septiembre de 2026). C2, C3 y las features F1 a F5
construyen sobre esto. Cambiar una prop o un token de aquí se pide en `docs/requests/C1.md`; nadie
lo edita por su cuenta.

- Tokens: `src/styles/tokens.css` (se carga después de `src/theme.css` y solo agrega nombres).
- Estilos de las primitivas: `src/styles/components.css`, `base.css` y `layout.css`.
- Primitivas: `src/components/ui/*`, con **un solo barril**: `src/components/ui/index.js`.
- Galería: `/dev/ui` (`src/features/dev-ui/`), fuera del build de producción.
- Contraste: `node src/styles/contrast.check.js` (también corre en `npm run test`).

```js
import { Button, Card, DataTable, Delta, Money, Stat, useToast } from '../../components/ui/index.js'
```

## Reglas de la casa

- **Ningún color suelto.** Todo sale de un token; si falta uno se pide, en los dos temas.
- **Todo número pasa por `src/lib/format.js`**: signo menos U+2212, `s/d` para faltantes, fechas
  en la Ciudad de México. Las primitivas que pintan números (`Money`, `Delta`, `DataTable`) ya lo
  hacen.
- **El color nunca va solo**: signo (+ o −) y, si se quiere, flecha. USD/MXN y demás movimientos
  sin bueno ni malo usan `direction="neutral"` con una pista de texto ("peso más débil").
- **Dato viejo o de respaldo siempre se dice** con `DataStatus`, también en la versión compacta.
- **Nada vive solo en un hover.** InfoTip y DataStatus se abren con clic, toque o teclado.
- Texto en español de México, sin guiones largos, sin lenguaje de compra o venta.
- 11px (`--text-2xs`) solo para etiquetas en versalitas (`.kz-eyebrow`); ningún dato baja de 12px.
- Blancos táctiles: mínimo 24px; los botones de tamaño normal llegan a 44px en pantallas de 768px o
  menos.

## Tokens

Los nombres de `src/theme.css` (`--bg`, `--surface*`, `--ink*`, `--muted*`, `--border*`,
`--accent*`, `--positive*`, `--negative*`, `--warning*`, `--info*`, `--focus`, `--shadow-*`,
`--radius-*`) **no se renombran**: el legado los usa hasta M3. `tokens.css` agrega:

| Grupo | Tokens |
| --- | --- |
| Tipografía | `--text-2xs` .6875rem (11px, solo versalitas), `--text-xs` .75, `--text-sm` .8125, `--text-md` .875 (cuerpo y datos), `--text-lg` 1, `--text-xl` 1.25, `--text-2xl` 1.5, `--text-3xl` 2; `--leading-tight` 1.2, `--leading-normal` 1.5; `--weight-regular/medium/semibold/bold` 400/500/600/700; `--tracking-caps` .06em, `--tracking-tight` −.02em |
| Espaciado (base 4px) | `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-7` 32, `-8` 40, `-9` 48, `-10` 64, `-11` 80, `-12` 96 (px) |
| Dirección | `--up` (= `--positive`), `--up-soft`, `--down` (= `--negative`), `--down-soft`, `--flat` (= `--muted`), `--flat-soft`, `--neutral-dir` (= `--info`), `--neutral-dir-soft`, `--stale` (= `--warning`), `--stale-soft` |
| Controles | `--control-border`, `--control-border-hover` (borde de campo a 3:1, que `--border-strong` no alcanza) |
| Gráficas | categórica `--chart-1` a `--chart-8` (orden fijo, nunca en ciclo), secuencial `--seq-1` a `--seq-5`, divergente azul y naranja `--div-neg-2`, `--div-neg-1`, `--div-0`, `--div-pos-1`, `--div-pos-2`, y `--grid`, `--axis`, `--crosshair`, `--chart-surface` |
| Movimiento | `--ease-out` cubic-bezier(.2,.8,.2,1), `--dur-fast` 120ms, `--dur-base` 180ms; todo se apaga con `prefers-reduced-motion` |
| Estructura | `--sidebar-w` 240px, `--sidebar-w-collapsed` 64px, `--topbar-h` 56px, `--bottomnav-h` 64px, `--content-max` 1440px |
| Capas | `--z-sticky` 10, `--z-topbar` 80, `--z-nav` 200, `--z-toast` 1200; `--scrim` (fondo de diálogo), `--radius-full` |

`.dark-panel` (de theme.css) también recibe los tokens de gráfica del tema oscuro.

### Contraste medido (`node src/styles/contrast.check.js`)

136 pares en 4 ámbitos, todos cumplen (texto ≥ 4.5:1; texto grande y elementos de interfaz ≥ 3:1).
Peor caso por ámbito:

| Ámbito | Texto | Interfaz (bordes, foco, marcas) |
| --- | --- | --- |
| Claro | 4.53:1 `--ink` sobre `--div-pos-2` (valor en celda de mapa de calor) | 3.15:1 `--chart-3` sobre `--chart-surface` |
| Oscuro | 5.56:1 `--down` sobre `--down-soft` | 3.25:1 `--chart-7` sobre `--chart-surface` |
| Barra lateral (oscura en los dos temas) | 6.12:1 `--muted-2` sobre `--bg-deep` | |
| Panel siempre oscuro | 7.34:1 `--muted-2` sobre `--bg-deep` | |

La retícula (`--grid`, 1.25:1 y 1.22:1) es decorativa a propósito y se revisa con su propio umbral.

### Paleta categórica (validador de la habilidad dataviz)

| Tema, superficie | Banda L | Croma | CVD vecinos (peor) | Visión normal (peor) | Contraste |
| --- | --- | --- | --- | --- | --- |
| Claro, #fffef9 | PASA | PASA | 13.1 deutan | 20.1 | todas ≥ 3:1 |
| Oscuro, #101a14 | PASA | PASA | 8.9 deutan | 21.6 | todas ≥ 3:1 |

Todos contra todos (dispersión, frontera eficiente) con las tres primeras: claro 9.7 PASA, oscuro
6.2 AVISO. En oscuro, una dispersión con tres series necesita etiqueta directa o una forma distinta
por serie. Rampas secuenciales validadas como ordinales en los dos temas (monótonas, saltos ≥ .06,
extremo claro 2.18:1 y 2.05:1).

## Utilidades CSS

`.num` (cifras tabulares), `.mono` (JetBrains Mono con cifras tabulares), `.kz-eyebrow` (versalitas
11px), `.kz-missing` (s/d apagado), `.sr-only` (de theme.css), `.kz-container`, `.kz-col`, `.kz-row`,
`.kz-metric-grid`, `.kz-split`, `.kz-divider` (`layout.css`, con `data-gap`, `data-align`,
`data-justify`, `data-ratio` donde aplica).

## Componentes

Todas las props no listadas se pasan al elemento raíz (`...rest`) salvo donde se indica. "Nodo" es
cualquier `ReactNode`.

### Button

| Prop | Tipo | Por omisión | Notas |
| --- | --- | --- | --- |
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'danger'` | `'primary'` | |
| `size` | `'sm' \| 'md'` | `'md'` | md 38px (44px en ≤ 768px), sm 30px (36px) |
| `loading` | boolean | false | deshabilita, `aria-busy`, giro en lugar del icono |
| `icon`, `iconEnd` | nodo | | decorativos (`aria-hidden`) |
| `block` | boolean | false | ancho completo |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` | |
| `disabled`, `className`, `children`, `ref` | | | |

### IconButton

| Prop | Tipo | Por omisión | Notas |
| --- | --- | --- | --- |
| `label` | string | **obligatoria** | `aria-label` y `title` |
| `size` | `'sm' \| 'md'` | `'md'` | 38px (44px en ≤ 768px), sm 30px |
| `variant` | `'plain' \| 'outline'` | `'plain'` | |
| `pressed` | boolean | | pone `aria-pressed` (botón de alternar) |
| `children` | nodo | | el icono |

### Badge

`tone` `'neutral' | 'accent' | 'positive' | 'negative' | 'warning' | 'info'` (neutral), `size`
`'sm' | 'md'` (sm, 20px; md 24px; los dos en 12px), `dot` boolean, `icon` nodo, `children`. El
texto dice lo mismo que el color.

### Card

| Prop | Tipo | Notas |
| --- | --- | --- |
| `title` | nodo | con título la tarjeta es región con nombre (`aria-labelledby`) |
| `titleAs` | `'h2' \| 'h3' \| 'h4'` | `'h2'` |
| `description` | nodo | |
| `info` | props de InfoTip | junto al título; `term` toma el título si es texto |
| `actions` | nodo | a la derecha del encabezado |
| `status` | `DataStatusMeta` | DataStatus en el encabezado |
| `footer` | nodo | |
| `padding` | `'md' \| 'none'` | `'md'`; `none` para tablas y gráficas a sangre (la tabla usa el borde de la tarjeta) |

### Tabs y TabPanel

`Tabs`: `items` `{ id, label: nodo, badge?: nodo, icon?: nodo, disabled?: boolean }[]`, `value`
(id activo), `onChange(id)`, `label` (nombre accesible de la lista, obligatorio), `className`,
`children` (los `TabPanel`). Controlado. Patrón APG: una parada de tabulador, flechas izquierda y
derecha con vuelta, Inicio y Fin, saltan las deshabilitadas, activación automática.
`TabPanel`: `id` (el mismo del item), `className`, `children`. Solo se dibuja el activo; lleva
`tabIndex=0`.

### SegmentedControl

`label` (legend, obligatorio), `hideLabel` boolean, `items` `{ value, label: nodo, icon?, disabled? }[]`,
`value`, `onChange(value)`, `name` (opcional), `className`. Son radios nativos en un fieldset:
flechas y anuncio "1 de 4" del navegador.

### Field, Input, Select, NumberInput

`Field`: `label`, `hint`, `error` (nodo; marca `aria-invalid`), `required`, `id`, `className`,
`children`. Conecta `htmlFor` y `aria-describedby` (ayuda + error).

`Input`, `Select` y `NumberInput` se envuelven solos en un `Field` si reciben `label`, `hint` o
`error` y no están ya dentro de uno. Comparten: `label`, `hint`, `error`, `required`, `id`,
`className`, `aria-describedby` (se suma a la del Field).

| Componente | Props propias |
| --- | --- |
| `Input` | `numeric` (derecha y tabulares), `prefix`, `suffix` (nodo corto: "$", "MXN", "%"; entra a la descripción), `type` ('text'), resto de `<input>` |
| `Select` | `options` `{ value, label, disabled? }[]`, `placeholder` (primera opción vacía), resto de `<select>` (nativo) |
| `NumberInput` | `value` `number \| null`, `onChange(number \| null)` en cada tecla, `decimals` (al salir; por omisión los que traiga), `prefix`, `suffix`, resto de `<input>` |

`NumberInput` es texto con `inputMode="decimal"`: acepta "1,234.56", "−1,141", "$ 2 500", "0,375"
(coma decimal cuando no puede ser de miles); lo que no entiende da `null`, nunca `NaN`. Al salir
reescribe agrupado. `parseNumber(texto)` y `formatForInput(valor, decimales)` salen del barril.

### DataTable

| Prop | Tipo | Notas |
| --- | --- | --- |
| `columns` | `DataTableColumn[]` | ver abajo |
| `rows` | `any[]` | `[]` |
| `rowKey` | `string \| (row) => string` | obligatorio |
| `caption` | string | obligatorio: nombra la tabla y su región de scroll |
| `captionHidden` | boolean | caption solo para lector de pantalla (cuando la Card ya titula) |
| `sort` | `{ key, direction: 'ascending' \| 'descending' } \| null` | controlado si se pasa |
| `defaultSort` | igual | orden inicial si no es controlado |
| `onSortChange` | `(sort) => void` | |
| `onRowClick` | `(row) => void` | la primera celda se vuelve botón (Tab, Enter, Espacio) y la fila responde al clic |
| `rowLabel` | `(row) => string` | nombre accesible del botón de fila ("Abrir WALMEX.MX") |
| `loading` | boolean | filas de esqueleto, `aria-busy` |
| `loadingRows` | number | 5 |
| `error` | nodo \| true | muestra ErrorState debajo del encabezado |
| `onRetry` | `() => void` | botón Reintentar del error |
| `empty` | `{ title, text?, action? }` | EmptyState cuando no hay filas |
| `density` | `'comfortable' \| 'compact'` | |
| `stickyFirstColumn` | boolean | true |
| `maxHeight` | number \| string | con alto máximo, el encabezado se queda fijo |
| `className` | string | |

`DataTableColumn`: `key`, `header` (nodo), `numeric` (derecha, tabulares, orden inicial
descendente y `fmtNumber` si no hay `format`), `align` (`'left' | 'right' | 'center'`), `format(value, row)`
→ nodo, `sortable`, `sortValue(row)`, `info` (props de InfoTip en el encabezado), `minWidth`.

Comportamiento: `aria-sort` solo en la columna ordenada; los faltantes (`null`, `undefined`, `''`,
no finitos) van al final en las dos direcciones; texto con el orden del español; la primera
columna es `<th scope="row">`; sin hover-zebra (hover sí); el scroll horizontal vive en el marco,
que entra al orden de tabulación como región con nombre solo cuando de verdad hay scroll.
`sortRows(rows, columns, sort)` y `nextSort(sort, column)` salen del barril.

### Stat, Delta, Money

`Money`: `value`, `currency` ('MXN'), `compact` (el monto exacto va en `title`), `decimals`,
`sign`, `className`.

`Delta`: `value` (fracción para pct y pp, puntos base para bp, monto para money/number), `kind`
`'pct' | 'pp' | 'bp' | 'money' | 'number'` ('pct'), `direction` `'auto' | 'neutral'`, `currency`,
`decimals`, `compact`, `arrow` (▲ ▼ decorativos), `hint` (nodo), `className`. La dirección sale
del texto redondeado: 0.00001 es "0.00%" y va plano. `describeDelta(value, options)` sale del
barril.

`Stat`: `label` (nodo), `value` (nodo ya formateado; vacío es "s/d"), `delta` (nodo, normalmente
`<Delta>`), `sublabel`, `info` (props de InfoTip), `status` (`DataStatusMeta`), `loading`
(esqueleto + "Cargando" para lector), `size` `'sm' | 'md' | 'lg'`, `className`.

### InfoTip

`termKey` (slug de `src/content/glossary.js`), `term` (nombre visible; con termKey se recomienda
para que el botón tenga nombre desde el inicio), `text` (nodo de respaldo), `label` (nombre del
botón; "Qué es <término>"), `link` (true: "Ver más sobre <término>" a `/aprender/:termino`),
`className`. El glosario se descarga con `glossary-lazy.js` la primera vez que alguien apunta,
enfoca o abre un InfoTip. Popover nativo (`popover="auto"` con `popovertarget`): Esc, clic afuera y
otro clic en el botón lo cierran y el foco regresa al botón. Fuera de un router, la liga es `<a>`.

### DataStatus

`asOf` (ISO o YYYY-MM-DD), `source`, `delayMinutes`, `stale`, `fallback` (el `meta` v2 tal cual),
`className`, `now` (solo pruebas y galería). Insignia:

| Caso | Texto | Tono |
| --- | --- | --- |
| al día, hoy | "A las 14:40" | punto `--up` |
| al día, otro día | "Al 19 sep" (con año si no es este) | punto `--up` |
| con retraso | "Retraso 15 min" | punto `--neutral-dir` |
| viejo | "Dato del 19 sep" | `--stale` |
| respaldo | "Respaldo: FRED" | `--stale` |
| respaldo y viejo | "Respaldo: FRED · Dato del 18 sep" | `--stale` |
| sin fecha | "Sin fecha" | punto `--muted-2` |

Al abrirla: fuente, fecha y hora, retraso, aviso y qué significa. `describeStatus(meta, now)` sale
del barril.

### Skeleton, EmptyState, ErrorState

`Skeleton`: `width` ('100%'), `height` (14), `lines`, `radius` `'sm' | 'full'`, `className`.
Decorativo: quien lo usa anuncia la carga.
`EmptyState`: `title`, `text`, `icon`, `action`, `headingAs` `'h2' | 'h3' | 'h4' | 'p'` ('p'), `size`
`'md' | 'sm'`, `className`.
`ErrorState`: `title` ("No pudimos cargar los datos"), `message`, `onRetry`, `retryLabel`
("Reintentar"), `retrying`, `headingAs`, `size`, `className`. `role="alert"`.

### Dialog, ConfirmDialog, Sheet

Sobre `<dialog>` con `showModal()`: fondo inerte, foco atrapado con Tab y Shift+Tab, Esc llama a
`onClose`/`onCancel`, scroll de la página congelado, foco de regreso al botón que abrió.

`Dialog`: `open`, `onClose`, `title`, `description` (va en `aria-describedby`), `footer`, `size`
`'md' | 'lg'`, `dismissible` (true: clic en el fondo cierra), `initialFocusRef`, `closeLabel`
("Cerrar"), `className`, `children`.
`ConfirmDialog`: `open`, `title`, `message`, `confirmLabel` ("Confirmar"; mejor un verbo), `cancelLabel`
("Cancelar"), `destructive` (botón rojo y foco inicial en Cancelar), `busy`, `onConfirm`, `onCancel`.
`role="alertdialog"`, sin cierre por el fondo.
`Sheet`: `open`, `onClose`, `title`, `description`, `footer`, `closeLabel`, `className`, `children`.
Sube desde abajo; en pantalla ancha, 560px centrada.

### UiProvider, useUi, useToast, useConfirm

`UiProvider` (ya montado en `AppRoot`, arriba del router) da tema, avisos y confirmaciones.

- `useUi()` → `{ theme, toast, confirm }`.
- `useToast()` → `{ show(toast) → id, dismiss(id) }` con `toast = { title, description?, tone?:
  'neutral' | 'positive' | 'negative' | 'info', action?: { label, onClick }, duration? }`. 5 s, u 8 s
  con acción; se pausa con el cursor o el foco encima; máximo 3 a la vez. Región "Avisos" siempre en
  el DOM con `aria-live="polite"`. Patrón Deshacer:
  `toast.show({ title: 'Movimiento borrado', action: { label: 'Deshacer', onClick: restaurar } })`.
- `useConfirm()` → `confirm({ title, message?, confirmLabel?, cancelLabel?, destructive? })` →
  `Promise<boolean>`.
- `theme` = `{ mode: 'light' | 'dark' | 'system', dark, setTheme(mode), toggle() }` (el mismo estado de
  `useTheme()` de `src/theme.js`, compartido por todos, llave `kaizen_theme`).

Los hooks fallan con un mensaje claro si no hay `UiProvider` arriba.

### Disclaimer

`variant` `'short' | 'long'` ('short'), `children` (texto propio), `className`. `DISCLAIMER_SHORT`:
"Kaizen es una herramienta educativa y de análisis. No es recomendación de inversión." La larga es un
`<aside aria-label="Aviso importante">`.

### PageHeader y SectionHeading

`PageHeader`: `title` (el único h1; `tabIndex=-1` y `data-page-title` para que el shell le mueva el
foco), `description`, `eyebrow`, `actions`, `breadcrumbs` `{ label, to? }[]` (el último es la página
actual), `className`.
`SectionHeading`: `title`, `description`, `info` (props de InfoTip), `actions`, `as` `'h2' | 'h3'`
('h2'), `id` (para `aria-labelledby` de la sección), `className`.

### SrOnly, ThemeToggle, Mark

`SrOnly`: `as` ('span'), `id`, `children`.
`ThemeToggle`: `variant` `'icon' | 'segmented'` ('icon': botón "Tema oscuro" con `aria-pressed`;
'segmented': Claro, Oscuro, Sistema), `className`.
`Mark`: `size` (32), `on` `'auto' | 'light' | 'dark'` (auto sigue al tema; fija para fondos que no
cambian), `label` (con texto es imagen con nombre; sin él, decorativa), `className`.

## Galería /dev/ui

`src/features/dev-ui/routes.jsx` solo declara la ruta cuando `import.meta.env.MODE !== 'production'`,
así que el build de producción no trae ni la ruta ni el chunk (comprobado con `grep` sobre `dist/`).
Es pública (`handle.public`) y trae su propio `<main>`. Si existe `src/features/dev-ui/ChartsGallery.jsx`
(de C2) se agrega sola como sección "Gráficas" (`import.meta.glob`), sin tocar la página.

Pendiente de otro stream: `src/app/router.jsx` todavía la filtra con `import.meta.env.DEV`, que es
falso en el build de e2e (`vite build --mode e2e`). Ver `docs/requests/C1.md`.
