# Módulo `fichas` — Ficha de costos y gastos (Res. 148/2023 MFP)

Documento **único de traspaso** del módulo. Recoge todo lo que estaba disperso en la memoria
local de una máquina para que el trabajo pueda **continuarse desde otra PC y otra sesión** sin
volver a leer la Gaceta ni a rehacer el diseño.

> **Estado al 03-09-2026: F0 a F9 HECHAS. El módulo está FUNCIONALMENTE COMPLETO: la ficha
> calcula su precio, se aprueba, se revisa, y las TRES HOJAS OFICIALES se exportan a PDF y Excel.
> Faltan F10 (integración: pestaña de auditoría y ayuda) y F11 (auditoría antes de `main`).
> Estado exacto: §9.13.**
> **Ya existen** `src/lib/fichaCosto.js` (motor puro) con `src/lib/fichaCosto.test.mjs`
> (**137 aserciones**), la versión **Dexie v18** con la tabla `costSheets`,
> `src/repositories/costSheetsRepo.js`, las etiquetas en `src/db/constants.js`, el módulo de
> licencia `fichas`, las pantallas `src/features/costsheets/CostSheetsScreen.jsx` (lista) y
> `CostSheetScreen.jsx` (editor, **solo el bloque 1**), las rutas `/fichas`, `/ficha/nueva` y
> `/ficha/:id`, la tarjeta gateada del Home, **`costSheets` YA registrada en
> `SYNC_COLLECTIONS`** y, de F5, `InputsBlock.jsx` (bloque 2: anexo de insumos, portadores e
> importación desde receta) con el acordeón de bloques, y de F6 `LaborBlock.jsx` (bloque 3: el
> anexo de salario en tarjetas) y de F7 `OtherDirectBlock.jsx`, `IndirectBlock.jsx`,
> `TaxesBlock.jsx` y `UtilityBlock.jsx` (bloques 4 a 7, con los tres controles) y de F8
> `RefsBlock.jsx` y `SignBlock.jsx` (bloques 8 y 9: Fila 16, firmas y ciclo de vida) y de F9
> `features/reports/fichaReports.js` con su suite propia (las tres hojas oficiales).
> **`/auditoria` sigue sin pestaña de Fichas** (F10): los eventos de `costSheet` se escriben desde
> F4 y hoy **no tienen pantalla que los muestre**. Las suites pasan de 6 a **7**.
> Rama de desarrollo: `claude/awesome-dirac-484azm` (nada a `main` sin autorización).
>
> **Mantener este bloque al día en CADA fase.** Este fichero existe para continuar el trabajo
> desde otra PC; si miente sobre su propio estado, la siguiente sesión rehace lo hecho.

**Diseño visual (referencia obligatoria antes de programar pantallas):**
https://claude.ai/code/artifact/1134b7b2-d636-4a6a-9856-19e3ddb3a879 — *"Ficha de Costo
148/2023"*, **APROBADA POR EL DUEÑO EL 31-08-2026** (el propio artefacto lo dice al pie). Trae la
tesis del diseño, las cuatro decisiones, **seis vistas** del ejemplo "Pan suave" (lista, gasto
material, salario, semáforo del coeficiente, base de la utilidad y correlación), el mapa de las 16
filas, los tres controles, la hoja de exportación, los anti-objetivos y las doce fases.

> **CORRECCIÓN 02-09-2026 (verificada, importante).** La versión anterior de este bloque decía
> que este artefacto **SE HABÍA PERDIDO** y que había una reconstrucción del 01-09
> (`ad25b6d3-c095-408c-96a7-aa557cc6a86a`) pendiente de aprobación. **Es al revés:**
> `Artifact action:"list" scope:"all"` del 02-09-2026 lista `1134b7b2` viva y **no** lista
> `ad25b6d3`. La v2 aprobada se leyó completa el 02-09. **La reconstrucción del 01-09 es la que
> no existe: no usarla como referencia ni buscarla.** Consecuencia práctica: F4 **nunca estuvo
> bloqueada por falta de diseño aprobado**.
>
> **Lo que la maqueta aprobada NO trae: el bloque 1 (*Identificación*).** Sus seis vistas no lo
> incluyen. Se programó en F4 desde la prosa del §7, con los mismos tokens y clases, y con el
> visto bueno del dueño (02-09-2026) para hacerlo así.

**Fuente normativa:** Gaceta Oficial No. 64 Ordinaria del 6-jul-2023, pp. 1376-1387,
Resolución **148/2023** del Ministerio de Finanzas y Precios: *"Metodología para la elaboración
de la ficha de costos y gastos de productos y servicios para la evaluación de precios y
tarifas"*. PDF local de la máquina donde se leyó: `C:\Users\Ramon\Downloads\goc-2023-o64.pdf`
(14 páginas). **Ese PDF no está en el repo**; si hace falta releerlo desde otra máquina, hay que
descargarlo de la Gaceta (ver §9, "Cómo releer el PDF").

---

## 1. Qué es

Un módulo de licencia nuevo, **`fichas`** ("Fichas de costo"), que construye la Ficha de costos
y gastos de la Res. 148/2023 **reutilizando los productos que ya están en el catálogo y el stock
de MypiCuadre**, y la exporta en el formato oficial (el Apartado Segundo obliga a **mostrar las
bases** del precio ante control, negociación o concertación: no basta con calcular en pantalla).

**Dependencias nuevas a instalar: NINGUNA.** Todo está en `package.json` (`dexie`, `react`,
`react-router-dom`, `lucide-react`, `xlsx`, `jspdf`, `jspdf-autotable`; los tres últimos ya
entran por `import()` dinámico).

---

## 2. Base normativa (interpretación cerrada, no volver a discutirla)

### 2.1 Obligaciones que aplican a una MYPIME (actor económico no estatal)

- **Art. 3** — La Ficha es de **confección obligatoria** también para actores no estatales, con
  independencia del método de formación de precios que se use.
- **Art. 5** — Es de **obligatorio cumplimiento** desagregar en anexos independientes los
  **insumos principales** y el **gasto de salario directo**.
- **Art. 6** — El actor no estatal **puede ajustar** formato, modo de exposición y contenido del
  modelo a sus características. Esto legitima presentar la ficha en tarjetas verticales y ocultar
  filas que no apliquen, y **es la razón por la que los límites del Anexo II y el coeficiente de
  indirectos se implementan como AVISO, nunca como bloqueo.**
- **Apartado Segundo** — Obliga a **mostrar las bases** de los precios, así que el módulo tiene
  que **exportar el documento**.

### 2.2 Las 16 filas (Anexo I)

Encabezado: Producto o Servicio, Código, UM, Nivel de Producción, % de utilización de capacidad.
Dos columnas de valores: **Costo Base** y **Costo Nuevo**.

1. **Gasto Material** = 1.1 + 1.2 + 1.3 + 1.4
   - 1.1 Insumos (materias primas, materiales básicos y auxiliares, artículos de completamiento
     y semielaborados) = suma del anexo de insumos (norma de consumo × precio unitario)
   - 1.2 Combustibles y lubricantes (incluye tasas de recargo)
   - 1.3 Energía eléctrica (tarifa que paga la entidad / producción)
   - 1.4 Agua (tarifa vigente / producción)
2. **Salario directo** o retribución directa = suma del anexo de salario. **Incluye vacaciones.**
3. **Otros gastos directos:** mantenimientos y reparaciones recibidos, **depreciación** de AFT
   directos, amortización de intangibles. La norma **exige desglosar** depreciación/amortización
   y las partidas de mayor peso.
4. **Gastos asociados a la producción** (indirectos de producción: mantenimiento, explotación de
   equipos, dirección de la producción, control de calidad, depreciación de AFT de producción)
   - 4.1 De ello, salarios
5. **COSTO TOTAL = 1 + 2 + 3 + 4**
6. Gastos generales y de administración — 6.1 De ello, salarios
7. Gastos de distribución y venta — 7.1 De ello, salarios
8. Gastos financieros: **SOLO** intereses, comisiones bancarias y primas de seguro
9. Financiamiento a la OSDE (no debe exceder la fila 6). **NO aplica a un actor no estatal.**
10. Gastos tributarios = **(2 + 4.1 + 6.1 + 7.1) × (tipo Seg. Social + tipo Utilización de la
    Fuerza de Trabajo)**. **Excluye expresamente la Contribución al Desarrollo Local.**
11. **TOTAL DE GASTOS = 6 + 7 + 8 + 9 + 10**
12. **TOTAL DE COSTOS Y GASTOS = 5 + 11**
13. Utilidad (por gastos, ver Anexo II; por correlación, derivada)
14. **PRECIO O TARIFA = 12 + 13**
15. **Precio o tarifa unitario ajustado = 14 / nivel de producción**
16. Datos sobre precios de referencia (fila explicativa: comparables internos/externos con
    evidencia: facturas, solicitudes de información, conciliaciones)

### 2.3 ERRATA de la propia Gaceta (no equivocarse al implementar)

El cuerpo (p. 1383) dice *"Fila 12: … suma de las Filas 6+11"*, pero el modelo del Anexo I
(p. 1380) rotula **"TOTAL DE COSTOS Y GASTOS (5+11)"**. La única lectura coherente es **5 + 11**
(con "6+11" la fila 6 se contaría dos veces y las filas 1-4 desaparecerían del precio).
**Se implementa 5 + 11.**

### 2.4 Control A — Coeficiente máximo de gastos indirectos (Art. 9 y descripción de filas 4/6/7)

```
Fila 4 + Fila 6 + Fila 7  ≤  coeficiente × Fila 2
```

- Producción: hasta **1,5**. Servicios: hasta **1,0**.
- **Gastronomía popular** (Art. 16): los indirectos **no exceden el importe del salario directo**
  (coeficiente 1,0).
- Excederlo exige consulta previa al MFP ("previa demostración"). En la app: **aviso, no cerrojo**.

### 2.5 Control B — Tasa máxima de utilidad por método de gastos (Anexo II)

- Producción de bienes (excepto agropecuaria, alta tecnología, informática, ciencia e
  investigación): **25 %**
- Producción **agropecuaria** (excepto derivadas del azúcar): **30 %** (excepcionalmente hasta
  **40 %** previa consulta al MFP)
- Servicios y comercialización (incluidos servicios agropecuarios; excepto alta tecnología,
  informática, ciencia e investigación): **15 %**
- Alta tecnología, informática, ciencia e investigación: **30 %**

**LA BASE NO ES EL TOTAL** (nota ** del Anexo II). Es el detalle que casi todos pierden:

```
Base = Fila 12 − (1 + 6 + 7 + 8 + 9 + 10) = Fila 2 + Fila 3 + Fila 4
       (salario directo + otros directos + asociados a la producción)
```

- **Excepción:** en producción **agropecuaria**, alta tecnología, informática y ciencia e
  investigación la base es el **total de costos y gastos (Fila 12 completa)**.
- **Gastronomía popular (Art. 16):** hasta **10 %**, descontando *"el consumo material, los
  gastos generales y de administración, los financieros, tributarios y el financiamiento a la
  OSDE"*. **NO menciona distribución y venta**, luego
  `Base gastronomía = 12 − (1 + 6 + 8 + 9 + 10) = 2 + 3 + 4 + 7`.
  Se implementa **literal**, con la diferencia documentada.
- **CORRECCIÓN 01-09-2026:** la versión anterior decía "son **cuatro** bases distintas". Son
  **TRES fórmulas** repartidas sobre **cinco actividades**: `2+3+4` (bienes y servicios), la
  **Fila 12 completa** (agropecuaria y alta tecnología/informática/ciencia) y `2+3+4+7`
  (gastronomía). No hay una cuarta fórmula; buscarla hace perder el tiempo. La suite asegura las
  **cinco actividades**, que es más de lo que pedía esta línea.

### 2.6 Control C — Método por correlación (Arts. 8, 10, 12 y fila 13)

Precio formado por correlación con similares de exportación/importación/sustitutos internos de
calidad equivalente. Entonces **Fila 13 = precio por correlación − Fila 12**. Si sale
**negativa** hay **subsidio**, que la norma prohíbe como regla: **aviso rojo**.

### 2.7 Anexo "Desagregación de los insumos fundamentales" (7 columnas)

(1) Código, (2) Productos, (3) UM, (4) Costo Base, (5) Norma de consumo, (6) Precio unitario,
(7) Costo propuesto = **5 × 6**. Con **Total insumos** y dos filas fijas al pie: **Combustibles y
lubricantes (LITROS)** y **Energía eléctrica (kw)**. Firmas *Elaborado por* / *Aprobado por* con
cargo.

- Columna 6: *"el monto que se pague al suministrador"* si es comprado; **al costo de producción
  sin utilidad** si lo produce la propia entidad.
- Columna 4 "Costo Base": solo se usa si es **modificación de precio** o el producto nuevo tiene
  un **comparable**.

### 2.8 Anexo "Gasto de salario de los obreros" (9 columnas)

(1) Operación, (2) Gasto de salario del Costo Base, (3) Cantidad de trabajadores,
(4) Categoría ocupacional, (5) Grupo escala, (6) Salario/hora, (7) Pagos adicionales por hora
(nocturnidad, peligrosidad), (8) Norma de tiempo en horas, (9) Gasto = **3 × (6 + 7) × 8**.
Con Total y firmas.

- Si una operación tiene **normas de tiempo distintas**, van filas independientes.
- Si intervienen **grupos escala distintos**, van filas independientes.
- *"Los precios no se pueden incrementar por motivo de la aplicación del Decreto 53."*

### 2.9 Lo que la Resolución NO dice (no inventar)

- **No fija los tipos** de Contribución a la Seguridad Social ni del Impuesto sobre la
  Utilización de la Fuerza de Trabajo: remite a la legislación tributaria. En la app van
  **configurables, por defecto 0**.
- El Anexo II norma a **entidades estatales y sociedades mercantiles 100 % cubanas**; para la
  MYPIME es **referencia** (Art. 6).
- Arts. 14/15 (margen comercial de comercializadoras y precio minorista estatal) quedaron **fuera
  de alcance** del módulo a propósito.

---

## 3. Decisiones cerradas con el dueño (no reabrir sin él)

**Las 4 del 30-08-2026:**

1. **Alcance: solo documento de análisis.** La ficha LEE el catálogo y calcula el precio
   sugerido, pero **NUNCA escribe en `products` ni cambia precios**. Se descartó a propósito
   aplicar el precio con `productsRepo.changePrice` y se descartó escribir `product.cost` (habría
   dos autores del mismo campo: colisiona con el promedio ponderado de `kitchenRepo.produce`).
2. **Precio unitario del insumo: `product.cost` congelado y editable.** Snapshot append-only en
   la ficha (como las mermas y las líneas de venta), sobrescribible a mano línea por línea. No se
   deriva de `purchases` (falla en productos sin compras) ni se teclea siempre a mano.
3. **Sí importar insumos desde una receta de `cocina`** (`recipesRepo.get(id).items` ya es
   `[{ productId, qty }]` = norma de consumo por unidad). La ficha se queda con **su copia
   congelada**, no queda atada a la receta. Sin la licencia `cocina`, la opción ni aparece.
   - **LA ESCALA, cerrada en F5 (02-09-2026) y verificada por un revisor independiente.** Esta
     decisión no decía a qué escala está cada lado, y los dos NO coinciden: la diferencia vale
     **×(nivel de producción)**. `recipes.items[].qty` es el consumo de **UNA** unidad del
     elaborado (`kitchenRepo.produce:105` hace `round2(Number(it.qty) * u)`), mientras que la
     columna (5) del anexo es el consumo del **NIVEL DE PRODUCCIÓN COMPLETO** — lo fija el
     fixture "Pan suave": 25 kg de harina para las **200** unidades (125 g por pan) y la Fila 15
     divide la 14 entre 200. **Al importar se MULTIPLICA por el nivel**, se **exige** el nivel
     antes de importar y la pantalla dice por cuánto multiplica. Sin eso la ficha se subvalúa por
     un factor igual al nivel, **en silencio**. La regla vive en `recipeToInputs`
     (`lib/fichaCosto.js`, puro) con sus aserciones de node: **no volver a derivarla a ojo**.
4. **Anexo de salario completo (9 columnas de la norma) pero en tarjetas**, no en tabla
   horizontal. El formato tabular oficial de 9 columnas sale solo en el PDF/Excel.

**La 5.ª, añadida al aprobar el 31-08-2026:**

5. **Cada hoja de la ficha se exporta a su PROPIO PDF, por separado.** No hay un PDF único con
   los tres anexos. Cada hoja se sostiene sola: encabezado de identificación (producto, código,
   UM, nivel de producción, % de capacidad, versión y estado), cuerpo, y pie de firmas
   *Elaborado por* / *Aprobado por* con cargo. La acción vive en el bloque 9 del editor: una hoja
   de exportación con 3 filas × (PDF | Excel).
   - **Una sola tabla por archivo:** `exportExcel`/`exportPdf` solo saben pintar una tabla, y
     cada hoja ES una tabla. Esa parte encaja tal cual.
   - **CORRECCIÓN 01-09-2026 (verificada en código, decisión del dueño).** La versión anterior de
     esta decisión decía que el encabezado y el pie de firmas se añadirían "dentro de
     `fichaReports.js`, por encima de `exportPdf`, sin modificarla". **Eso es imposible:**
     `exportPdf` (`src/features/reports/reportsService.js:1504`) construye el `jsPDF` **dentro** y
     termina llamando a `doc.save()`; no devuelve el documento ni admite ganchos. `exportExcel`
     (`:1492`) solo hace `aoa_to_sheet([head, ...rows])`. Envolverlas desde fuera no puede añadir
     nada al archivo.
   - **Camino aprobado: ampliar las dos funciones compartidas de forma ADITIVA.** Se les añaden
     dos campos **opcionales** del reporte, `report.header` y `report.footer`. `exportPdf` los
     pinta antes de `autoTable` y después de la tabla; `exportExcel` los inserta como filas al
     principio y al final de la hoja. **Los ~20 reportes actuales no pasan ninguno de los dos, así
     que su salida queda idéntica** (regla 2: cambio aditivo, comportamiento por defecto igual al
     clásico). `fichaReports.js` solo arma `header`/`footer` y los entrega.
   - **Verificación obligatoria en F9 (no opcional):** exportar en PDF y en Excel **al menos un
     reporte preexistente** (p. ej. *Inventario por ubicación*, que no usa rango) antes y después
     del cambio y comprobar que el archivo sale igual. Sin esa comprobación F9 no se da por hecha.
   - Orientación por hoja: 1 Ficha (16 filas, 2 columnas) vertical · 2 Insumos (7 columnas)
     vertical · 3 Salario (9 columnas) **horizontal**.

**Decisión del bundle: REVOCADA Y SUSTITUIDA EL 02-09-2026 (decisión del dueño, con evidencia).**

La maqueta aprobada el 31-08 eligió **`React.lazy`** para `/fichas` y `/ficha/:id` con este
motivo escrito: *"quien no tenga la licencia nunca descarga el código de la ficha"* y *"sobre
datos móviles cubanos, eso se nota"*. **Ese motivo es falso en esta PWA, y se comprobó
empíricamente antes de programar F4:**

- `vite.config.js` precachea `globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}']`, es decir
  **todo** el JS emitido a `dist/`.
- En el `dist/sw.js` recién construido están ya los chunks diferidos de `xlsx`, `jspdf`,
  `jspdf.plugin.autotable`, `html2canvas`, `purify` y los tres de `firebase` (45 entradas,
  3540,24 KiB de precache).
- Luego un chunk de `/fichas` **se descargaría igual en cada instalación y cada actualización**,
  con licencia o sin ella. `React.lazy` aquí **no ahorra un byte de datos móviles**: solo adelgaza
  el parseo del bundle principal al arrancar.
- La única variante que sí ahorraría datos sería excluir ese chunk del precache (`globIgnores`),
  y eso **rompe el offline** de la ficha: contra la regla offline-first. **Descartada.**

**Se implementa IMPORT ESTÁTICO**, como las 30 pantallas vecinas (regla 7: imitar el código
vecino): cero patrones nuevos en `router.jsx` y cero superficie de fallo en runtime. El coste real
medido en F4 está en §9.8. Nota para quien reabra esto: el riesgo del patrón diferido **sí estaba
cubierto** (`main.jsx:26-35` atiende `vite:preloadError` con una recarga única y candado en
`sessionStorage`); no se descartó por miedo, se descartó porque su beneficio no existía.

---

## 4. Datos: Dexie v18, UNA tabla

```js
db.version(18).stores({ costSheets: 'id, groupId, status, productId, createdAt, updatedAt' })
```

Aditiva pura: una tabla vacía, **sin `.upgrade()`**, sin tocar stores existentes (mismo perfil
que v13 `cocina` y v16/v17 `remesas`).

Registro:

```js
{ id, groupId, version, status: 'borrador'|'aprobada'|'sustituida', name, productId,
  code, unit, productionLevel, capacityPct, activity, method: 'gastos'|'correlacion',
  baseFromSheetId, inputs[], carriers: { fuel, energy, water }, labor[], otherDirect[],
  rows: { r4, r41, r6, r61, r7, r71, r8, r9, taxSS, taxFT }, utilityPct, correlationPrice, refs[],
  elaboratedBy, approvedBy, approvedAt, createdAt, updatedAt, deletedAt }
```

- **`utilityPct` (decisión del dueño, 01-09-2026, añadida tras la revisión de F1).** El Anexo II
  fija tasas **máximas** y para una MYPIME son **referencia, no obligación** (Art. 6), pero el
  motor calculaba siempre en el techo y la ficha no podía representar un margen menor, que es una
  situación normal en un negocio. La ficha **nace con el máximo de su actividad ya puesto**, así
  que sin tocar el campo se comporta **exactamente igual que antes de existir**. Va en
  **PORCENTAJE** (25 = 25 %), como `capacityPct`. Pasarse del máximo **no se recorta**: sale el
  aviso `utilidad-sobre-maximo` con el **exceso en importe**.
- **`inputs` y `labor` como arrays DENTRO del documento**, igual que `recipes`: la ficha la edita
  **un solo actor** (el mando); no hay dos dispositivos añadiendo líneas en segundos, así que el
  argumento que obligó a `orderItems` a ser filas sueltas aquí no aplica.
- **Append-only real:** el borrador se edita en sitio (con `updatedAt`); una ficha **aprobada es
  inmutable** y "corregirla" crea una **revisión nueva** (mismo `groupId`, `version + 1`),
  marcando la anterior `sustituida`. La revisión hereda la anterior como **Costo Base**, que es
  exactamente para lo que la norma pide esa columna. Eliminar = lógico (`deletedAt`).
- **`tsAfter` NO se aplica** (decisión consciente): la ficha no es una cabecera que dos teléfonos
  muten en segundos, que es el criterio documentado en `CLAUDE.md`. Se sella con `now()`, como
  `recipes`.
- **Sync:** `{ name: 'costSheets', pk: 'id' }` en `SYNC_COLLECTIONS`, LWW por `updatedAt`, lote de
  400 (no lleva fotos: `PHOTO_COLLECTIONS` en `pushEngine.js:42` solo mete en lotes de 50 a
  `images`/`deliveries`/`collections`, y `costSheets` no entra ahí). `firestore.rules` usa comodín
  `{document=**}`, así que **no hay que redesplegar reglas**.
- **`approve()` TIENE que sellar también `updatedAt`. No es estilo: es la diferencia entre que la
  aprobación suba o no suba.** Verificado en código: `TS_FIELDS` (`src/features/sync/collections.js:97`)
  es `['updatedAt','settledAt','closedAt','openedAt','effectiveFrom','createdAt']` y **`approvedAt`
  NO está en esa lista**; `pushEngine` selecciona lo que sube con `syncTs(r) > cursor`
  (`pushEngine.js:138-139`). Una aprobación que solo escriba `approvedAt`/`status` **no cambia
  `syncTs`, no supera el cursor y NUNCA se sube**: el otro dispositivo seguiría viendo la ficha en
  borrador, sin error visible en ninguna parte. Lo mismo vale para cualquier transición futura de
  `status` (`sustituida`, `deletedAt`): **toda mutación de `costSheets` sella `updatedAt`**, que es
  además la regla general de `CLAUDE.md`. Se resuelve así y **no** añadiendo `approvedAt` a
  `TS_FIELDS`, para no tocar un fichero del que dependen las 30 colecciones que hoy sincronizan
  bien.
- **F0 obligatoria:** comprobar **empíricamente** que `costSheets` no colisiona con una propiedad
  de la instancia Dexie 4.x (`tables`, `name`, `verno`, `on`, `core` sí colisionan **en
  silencio**). Es el mismo chequeo que se hizo con `remittances`/`collections`.

---

## 5. Motor de cálculo: puro y probado con node

`src/lib/fichaCosto.js` (sin Dexie, sin React) + `src/lib/fichaCosto.test.mjs`:

**ESCRITO Y EN VERDE: 134 aserciones, 0 fallos** (F1 el motor; F2 le añadió las guardas del
ciclo de vida: `FICHA_STATUS`, `canEditSheet`, `canApproveSheet`, `canReviseSheet`,
`canDeleteSheet` y `nextVersion`, que viven aquí y no en el repo para poder probarlas con node).

`round2`, `inputsTotal`, `carriersTotal`, `laborTotal` (3×(6+7)×8), `otherDirectTotal`, `taxRow`,
`totals` (las 16 filas), `indirectCheck` (Art. 9), `utilityBase` (**3 fórmulas, 5 actividades**),
`maxUtility`, `utilityRate`, `priceRows` (13, 14, 15), `subsidyWarning`.

**Tres funciones más de las que listaba este párrafo**, todas para lo mismo: el motor es puro y
**no lanza** (ningún lib de `src/lib/` lo hace; lanzan los repos), así que lo que sabe y no puede
resolver lo **devuelve** en vez de callárselo.
- `missingRateInputs(inputs)` — líneas en divisa sin la tasa congelada. Sin ella, el importe es 0
  y la pantalla bloquea, como `kitchenRepo.produce`. Exigido por la aserción "insumo en divisa
  con y sin tasa" del párrafo de abajo.
- `utilityRate(sheet)` — tasa efectiva en fracción (ver `utilityPct` en §4).
- `fichaWarnings(sheet)` — **una sola fuente** para los semáforos de los bloques 5 y 7, en vez de
  que cada pantalla reinvente la condición. Códigos (**ocho** desde F7; los dos últimos que se añadieron van
  en el orden del recorrido del editor, ver §9.11): `insumo-sin-tasa`, `actividad-desconocida`,
  `correlacion-sin-precio`, `importe-negativo`, `de-ello-sobre-fila`, `indirectos-exceden`,
  `utilidad-sobre-maximo`, `subsidio`. **Cada uno tiene su etiqueta** en
  `FICHA_WARNING_LABELS` (`src/db/constants.js`) y la suite lo exige: un código sin etiqueta se le
  enseñaría al dueño en crudo. **Todos
  son avisos** (Art. 6): ninguno bloquea la ficha. El orden es estable y sigue el recorrido del
  editor (bloque 5 antes que bloque 7).

**CONVENCIÓN DE UNIDADES (equivocarse aquí vale 100×):** los campos que acaban en `Pct` van en
**porcentaje** (`utilityPct: 25`, `capacityPct: 78`); los tipos tributarios `taxSS`/`taxFT` van en
**fracción** (12,5 % es `0.125`); `maxUtility` y `utilityRate` devuelven **fracción**.

**El redondeo es POR LÍNEA y luego se suma, a propósito.** El anexo imprime la columna (7) fila
por fila y su *Total* tiene que cuadrar con la suma de lo impreso, que es lo que mira un inspector.
Sumar en crudo y redondear al final daría un anexo cuyo total no cuadra con sus propias filas.
**No "arreglarlo" en F9.**

**Tres decisiones que el motor NO puede tomar solo y ya están cerradas con el dueño:**
- **Actividad desconocida o vacía → `maxUtility` devuelve `null`, nunca 0.** Devolver 0 hacía que
  la ficha entregara un precio **igual al costo, en silencio**, que es el peor resultado posible
  en un sistema cuyo trabajo es fijar precios.
- **Sin salario directo (Fila 2 = 0) el Control A NO OPINA** (`applies: false`, `coefficient:
  null`). Si no, una comercializacion sin nómina viviría en ámbar permanente y el semáforo se
  volvería ruido. Decisión del dueño, 01-09-2026.
- **Por correlación sin precio capturado no hay subsidio.** Un campo en blanco no es un subsidio;
  antes salía el aviso rojo con −31 565,00 antes de teclear un dígito.

Aserciones: cada fila y subtotal, las cuatro bases de utilidad, el límite 1,5/1,0/gastronomía,
correlación con y sin subsidio, insumo en divisa con y sin tasa, redondeo a 2, ficha vacía sin
`NaN`. **El bucle de pruebas de `CLAUDE.md` pasa de 5 a 6 suites** (recordar añadirla al bucle:
las suites se corren una a una con `node`, no hay `npm test`).

### 5.1 Fixture obligado: ejemplo "Pan suave" (200 u)

Ejemplo numérico **verificado a mano fila por fila** que recorre entero el artefacto aprobado.
**Usarlo tal cual como fixture de `fichaCosto.test.mjs` en F1:** si las pruebas usan otros
números, el motor deja de cuadrar con el documento que el dueño ya vio y aprobó.

**Encabezado:** Pan suave · código PAN-001 · UM `u` · nivel de producción **200** · utilización de
capacidad 78 % · actividad *producción de bienes* · método *por gastos*.

**Columna Costo Nuevo (la que se captura):**

| | Concepto | Detalle | Importe MN |
|---|---|---|---|
|1.1|Insumos|harina 25 kg × 420 = 10 500 · levadura 0,5 kg × 1 800 = 900 · aceite 1,5 L × 950 = 1 425 · azúcar 2 kg × 380 = 760 · sal 0,4 kg × 150 = 60|13 645,00|
|1.2|Combustible|12 L × 100,00|1 200,00|
|1.3|Energía|340 kw × 2,50|850,00|
|1.4|Agua|8 m³ × 15,00|120,00|
|**1**|**Gasto material**|1.1+1.2+1.3+1.4|**15 815,00**|
|**2**|**Salario directo**|amasado 2×(350+50)×6 = 4 800 · empaque 1×(300+0)×3 = 900|**5 700,00**|
|**3**|Otros directos|depreciación 600 + mantenimiento 300|**900,00**|
|**4**|Asociados a la producción|(4.1 de ello salarios = 1 900,00)|**3 200,00**|
|**5**|**COSTO TOTAL**|1+2+3+4|**25 615,00**|
|**6**|Generales y administración|(6.1 salarios = 2 400,00)|**4 100,00**|
|**7**|Distribución y venta|(7.1 salarios = 700,00)|**1 600,00**|
|**8**|Financieros|intereses y comisiones|**250,00**|
|**9**|OSDE|no aplica a actor no estatal|**0,00**|
|**10**|Tributarios|(2+4.1+6.1+7.1) = 10 700 × **tipos 0**|**0,00**|
|**11**|**TOTAL DE GASTOS**|6+7+8+9+10|**5 950,00**|
|**12**|**TOTAL DE COSTOS Y GASTOS**|**5+11** (errata de la Gaceta resuelta)|**31 565,00**|
|**13**|Utilidad|25 % de la base 9 800,00|**2 450,00**|
|**14**|**PRECIO O TARIFA**|12+13|**34 015,00**|
|**15**|**PRECIO UNITARIO**|14 ÷ 200|**170,08**|
|16|Precios de referencia|2 comprobantes| |

**Los tres controles con este ejemplo:**

- **A · coeficiente de indirectos → ÁMBAR.** 4+6+7 = **8 900,00** contra el límite
  1,5 × Fila 2 = **8 550,00**. **Exceso 350,00**, coeficiente aplicado **1,56**. La pantalla
  muestra el importe del exceso, no un porcentaje, y **no bloquea** (Art. 6).
- **B · base de la utilidad.** Base = 2+3+4 = **9 800,00** (NO la Fila 12). Con la base mal puesta
  (Fila 12 = 31 565,00) la utilidad daría **7 891,25**, 3,2 veces más, y el precio unitario
  **197,28** en vez de 170,08. **Esta es la aserción más importante de la suite.**
- **C · correlación → ROJO.** Con precio del similar 28 000,00:
  Fila 13 = 28 000 − 31 565 = **−3 565,00** (subsidio) y unitario **140,00**.

**Columna Costo Base** (revisión anterior, para probar las dos columnas y el delta):
1 = 14 980,00 (1.1 = 12 900 · 1.2 = 1 150 · 1.3 = 820 · 1.4 = 110) · 2 = 5 400,00 · 3 = 900,00 ·
4 = 3 050,00 (4.1 = 1 800) · **5 = 24 330,00** · 6 = 3 900,00 (6.1 = 2 300) · 7 = 1 500,00
(7.1 = 660) · 8 = 240,00 · 9 = 0,00 · 10 = 0,00 · **11 = 5 640,00** · **12 = 29 970,00** ·
13 = 2 337,50 (25 % de 9 350,00) · **14 = 32 307,50** · **15 = 161,54**.
Delta del gasto material Base→Nuevo: **+5,6 %**.

---

## 6. Qué se reutiliza (nada se reinventa)

`productsRepo` + `stockByLocation` + `matchesQuery` (patrón de selección múltiple de
`TransferScreen`) · `product.cost` congelado · `isForeignPriced`/`foreignToBase`/`ratesRepo`
congelando el par `priceCurrency`/`priceRate` (invariante de `kitchenRepo.produce`: sin tasa,
bloquea) · `recipesRepo` para importar insumos · `UNIT_LABELS` · `round2`/`formatMoney`/`cleanQty`
· `.cuadre-banner` y `.badge` para semáforos · `auditEvents` para alta, aprobación y revisión
(**escribirlos NO basta: hay que darles pantalla, ver §9 F10**) ·
`xlsx`/`jspdf` por import dinámico · `hasModule(...)` **gateado en la consulta**, no solo en el
render.

---

## 7. Interfaz (teléfono Android, sistema de diseño existente)

Autoridad visual = `src/styles/global.css` tal cual (tokens, `.card .btn .field .badge
.cuadre-banner .total-row .kpi__delta .empty-state .seg`). Cero colores, fuentes o librerías
nuevas; los dos temas salen gratis.

**Tesis:** una hoja de 16 filas × 2 columnas es inusable en un móvil. La ficha se rompe en
**bloques acordeón con su total en la cabecera**, y el **precio unitario vive fijo en una barra
inferior** (patrón `.pay-bar` del POS) que se actualiza mientras escribes: nunca se pierde de
vista el resultado.

- **`/fichas` (lista):** `.seg` Borradores/Aprobadas/Todas, buscador, tarjeta con el precio
  unitario en grande, `.badge` de estado (v2, v3 en revisiones) y `.dot` con el color del control
  de indirectos. Estado vacío que explica qué es y por qué (Art. 3).
- **`/ficha/:id` (editor), 9 bloques:**
  1. **Identificación** — producto del catálogo **o texto libre** para servicios; el tipo de
     actividad del Anexo II y el método van primero porque cambian todo lo de abajo.
  2. **Gasto material** — buscador, lista alfabética con la existencia al lado, chip **"Solo con
     existencia" encendido por defecto y apagable**, botón "Traer insumos de una receta", y
     bloque aparte **Portadores** para combustible/energía/agua con cantidad + UM (LITROS/kw/m³)
     + precio unitario, porque en una MYPIME esos NO son productos del catálogo.
  3. **Salario** — una tarjeta por operación, 9 campos apilados, `3×(6+7)×8` al pie, botón "Otra
     norma de tiempo" que duplica la operación como exige la norma.
  4. **Otros directos** — depreciación y amortización sugeridas.
  5. **Indirectos** — **semáforo del coeficiente** en `.cuadre-banner` mostrando el **importe
     exacto del exceso**; aviso y no cerrojo. **Sin salario directo (Fila 2 = 0) el semáforo se
     apaga** y en su lugar va la nota "sin salario directo no hay base para este control": el
     motor devuelve `applies: false` y `coefficient: null`, y **`null` se pinta "—", nunca
     "0,00"** (un cero se lee como "perfecto"). La suma de indirectos sí se sigue mostrando.
  6. **Financieros / OSDE / tributos** — **fila 9 plegada** con nota "no aplica a actores no
     estatales"; fila 10 calculada sola con la base visible.
  7. **Utilidad y precio** — muestra **qué base** se usa y por qué, la tasa máxima del Anexo II, y
     debajo **la tasa del dueño (`utilityPct`) en un campo editable**, que nace con el máximo ya
     puesto. Pasarse del máximo pinta ámbar con el **exceso en importe**, nunca recorta. En
     correlación deriva la utilidad y **el campo de tasa no aplica** (ahí la utilidad se deriva
     del precio del similar, no se elige); el **aviso rojo de subsidio solo sale cuando hay un
     precio del similar capturado** — un campo en blanco no es un subsidio.
  8. **Precios de referencia.**
  9. **Firmas, Aprobar ficha y Nueva revisión** (+ la hoja de exportación de la decisión 5).
     **La exportación vive AQUÍ y solo aquí, NO en `/reportes`** (corrección 01-09-2026,
     verificada). Motivo de código: en `ReportsScreen.jsx:89` la firma de una tarjeta es
     `card(key, title, desc, builder, useRange)` y **todos** los builders reciben como mucho un
     rango de fechas. No existe ningún mecanismo para "elige UNA ficha", que es justo lo que
     necesitan las tres hojas. Meterlas en `/reportes` obligaría a inventar un selector de ficha
     ajeno a esa pantalla; el editor ya sabe qué ficha está abierta.
- **Costo Base vs Costo Nuevo en móvil:** se captura el Nuevo; el Base aparece debajo en `.muted`
  con **delta y %**, y **solo** cuando la ficha es revisión o hay comparable.
- **El color del delta va INVERTIDO respecto al signo** (corrección 01-09-2026, verificada). En
  `src/styles/global.css:1798-1800`, `.kpi__delta--up` es `var(--ok)` (**verde**) y
  `.kpi__delta--down` es `var(--danger)` (**rojo**): están pensados para ventas, donde subir es
  bueno. **En una ficha de costo subir es MALO.** Un "+5,6 % de gasto material" pintado en verde
  le miente al dueño en la única pantalla cuyo trabajo es avisarle de que el costo se le fue.
  Regla: **costo al alza → `.kpi__delta--down` (rojo); costo a la baja → `.kpi__delta--up`
  (verde); sin cambio → `.kpi__delta--flat`.** No se crean clases nuevas ni se toca `global.css`
  (eso cambiaría el color de los deltas del panel del dueño, que hoy están bien): la ficha
  **elige** la clase según el signo. El nombre de la clase queda contraintuitivo en este uso, así
  que la línea que la asigna lleva su comentario explicando por qué.
- **No negociable:** `type="number"` **junto con** `inputMode="decimal"` en todo importe. **El
  `type="number"` es la mitad que protege y esta línea no lo pedía** (corrección 01-09-2026): en
  un teclado cubano el dueño escribe "0,5 kg de levadura" con **coma**, y una coma en un campo de
  texto libre se convierte en **cero** silenciosamente, dejando ese insumo a coste cero y
  subvaluando el producto. Con `type="number"` el navegador rechaza la coma y el valor llega
  vacío, que sí se ve. Verificado que es lo que ya hacen `TransferScreen:182-183`,
  `MermaScreen:142`, `KitchenScreen:174` y `CashScreen:115`; la ficha hace lo mismo.
- **No negociable:** cada total muestra su fórmula
  ("1+2+3+4"), autoguardado del borrador con `updatedAt`, `label` real en cada campo, **cero
  scroll horizontal** (la tabla ancha vive solo en el PDF).
- **Anti-objetivos:** sin gráficas, sin KPIs decorativos, sin animaciones, sin tour de
  onboarding, sin asistente de 7 pasos, sin colores fuera de los tokens.

---

## 8. Reportes y licencia

**Reportes:** `src/features/reports/fichaReports.js`, **archivo propio** (precedente
`remesasReports.js`). Tres documentos oficiales: Ficha (16 filas, 2 columnas, vertical),
Desagregación de insumos (7 columnas, vertical) y Gasto de salario (9 columnas, **horizontal**).
Builders de **solo lectura**.

**Dónde se exportan (corrección 01-09-2026):** los tres documentos **NO son tarjetas de
`/reportes`**; se descargan desde el **bloque 9 del editor**, que es el único sitio que sabe qué
ficha está abierta (razón de código en §7, bloque 9). `fichaReports.js` es el módulo que arma las
tres hojas, no una sección de la pantalla de Reportes.

**Matiz sobre `reportsService.js` (corrección 01-09-2026):** la versión anterior de este párrafo
decía "no se toca `reportsService.js`". **Se toca, y a propósito:** F9 añade a `exportPdf` y
`exportExcel` los campos **opcionales** `report.header` y `report.footer` (decisión 5 de §3). Es un
cambio **aditivo**: los ~20 reportes existentes no los pasan y su salida queda idéntica. Lo que
sigue intacto es que **ningún builder de `reportsService.js` se modifica** y que la lógica de
ficha vive entera en `fichaReports.js`.

**Licencia:** `LICENSE_MODULES.COSTSHEETS = 'fichas'`, etiqueta "Fichas de costo". Solo **mando**
(dueño/administrativo: expone costos y ganancia). Gateado **en la consulta**
(`canFichas ? costSheetsRepo.list() : Promise.resolve([])`). Quitar la licencia **no borra nada**:
la tabla queda intacta y la ruta/tarjeta dejan de ofrecerse. La brecha de control de licencias
sigue abierta: ver `docs/SEGURIDAD-LICENCIAS.md`.

---

## 9. Plan por fases (cada una: build limpio + pruebas node + commit en `claude/awesome-dirac-484azm`)

| Fase | Contenido | Estado |
|---|---|---|
| **F0** | Verificación previa **sin código**: colisión de `costSheets` en Dexie comprobada empíricamente, bundle base medido, este documento. Riesgo cero. | ✅ **HECHA 01-09-2026** (evidencia abajo) |
| **F1** | Motor puro + pruebas (`lib/fichaCosto.js` + `.test.mjs`) con el fixture "Pan suave". **Riesgo cero: nadie lo importa aún.** | ✅ **HECHA 01-09-2026** · 113 aserciones · revisada (ver §9.2) |
| **F2** | Datos: Dexie v18, `costSheetsRepo`, constantes/etiquetas. **`SYNC_COLLECTIONS` se movió a F4** (ver §9.3). | ✅ **HECHA 01-09-2026** · bundle +90 bytes |
| **F3** | Licencia: `LICENSE_MODULES.COSTSHEETS` + label. **El gate se aplica en F4**, con la primera pantalla. | ✅ **HECHA 01-09-2026** · bundle +45 bytes |
| **F4** | Lista + identificación (`/fichas`, `/ficha/nueva`, `/ficha/:id`, bloque 1) + **import estático** (la decisión de `React.lazy` se revocó con evidencia, ver §3) + **`costSheets` registrada en `SYNC_COLLECTIONS`** (venía de F2) + **el gate de licencia** (venía de F3) + tarjeta del Home. | ✅ **HECHA 02-09-2026** · bundle +22 170 bytes · detalle en §9.8 |
| **F5** | Anexo de insumos (bloque 2 + importar receta + portadores) + acordeón de bloques + `inputLineFor`/`recipeToInputs` en el motor. | ✅ **HECHA 02-09-2026** · bundle +10 834 bytes · 14 aserciones nuevas · revisada · detalle en §9.9 |
| **F6** | Anexo de salario (bloque 3) + `emptyLaborOp`/`splitLaborOp` en el motor. | ✅ **HECHA 02-09-2026** · bundle +4 333 bytes · 20 aserciones nuevas · revisada · detalle en §9.10 |
| **F7** | Indirectos, tributos, utilidad y precio (bloques 4-7 con los tres controles) + `pctToRate`/`rateToPct`, `utilityBaseRows`, `indirectCheck().max`, `negativeAmounts` y `subOverParentRows` en el motor. | ✅ **HECHA 03-09-2026** · bundle +18 928 bytes · 49 aserciones nuevas · revisada · detalle en §9.11 |
| **F8** | Precios de referencia, firmas, aprobación y revisiones (bloques 8-9 + `auditEvents`) + **las dos columnas Costo Base**, derivadas por `reviseFrom` en el motor. | ✅ **HECHA 03-09-2026** · bundle +10 711 bytes · 25 aserciones nuevas · revisada · detalle en §9.12 |
| **F9** | Exportación por hoja (`fichaReports.js`): 3 hojas, cada una a su propio PDF y Excel, con encabezado de identificación y pie de firmas + `header`/`footer` opcionales en `exportPdf`/`exportExcel`. | ✅ **HECHA 03-09-2026** · bundle +7 059 bytes · suite propia de 61 aserciones · **identidad byte a byte comprobada** · detalle en §9.13 |
| **F10** | Integración: tarjeta en Home gateada, **pestaña *Fichas* en `/auditoria` (gateada)**, sección en `/help`, este documento y `CLAUDE.md` (6 suites). | Pendiente |
| **F11** | Auditoría profunda antes de `main` (regla 5): esquema, fugas de licencia, LWW, bundle antes/después, y decir qué NO se probó. | Pendiente |

### 9.1 Evidencia de F0 (ejecutada el 01-09-2026)

Las dos comprobaciones que pedía F0, hechas **empíricamente** en la máquina de desarrollo, no
razonadas:

**a) `costSheets` NO colisiona con la instancia Dexie.** Sondeo sobre la Dexie **realmente
instalada** (`4.4.4`), recorriendo la cadena de prototipos de una instancia y preguntando por cada
nombre:

```
dexie instalada: 4.4.4
libre      costSheets      <- el nombre que queremos
COLISIONA  tables
COLISIONA  name
COLISIONA  verno
COLISIONA  on
libre      core
```

**Matiz honesto:** el sondeo corre sobre una instancia **sin abrir** (`db.open()` necesita
`indexedDB`, que no existe en node). Por eso `core` sale "libre" aquí aunque `CLAUDE.md` lo liste
como colisión: Dexie asigna `db.core` **durante** `open()`. Lo que sí queda probado es lo que
importa: `costSheets` no choca con nada de la clase. La lista de nombres prohibidos de `CLAUDE.md`
sigue siendo válida y **no** se debe reducir con este resultado.

**b) Bundle base, para comparar en F4.** Build de `512c9f1` con `npm run build`, **exit 0**:

| Métrica | Valor |
|---|---|
| Fichero | `dist/assets/index-C0lGbTIP.js` |
| Tamaño | **856 445 bytes** = 856,45 kB (1000) = 836,37 KiB (1024) |
| gzip | **248,33 kB** |
| Precache del service worker | 45 entradas, 3540,11 KiB |

Vite informa en **kB de 1000**; el explorador de archivos de Windows enseña **KiB de 1024**. Son el
mismo fichero: al comparar en F4 hay que usar **la línea de vite**, que es la que dio el 856,45 de
partida.

---

### 9.2 Revisión de F1 (01-09-2026) y lo que quedó abierto

F1 pasó por una revisión de código independiente que re-derivó el fixture "Pan suave" a mano y
verificó estructuralmente el aislamiento. **Cero hallazgos críticos.** Confirmó: la aritmética
cuadra fila por fila, ninguna aserción contradice este documento, cero importadores del módulo,
sin `import.meta.glob` ni `require.context` en todo `src/`, `SYNC_COLLECTIONS` y `db.js` intactos
→ Rollup no puede alcanzarlo, **no entra al bundle y no puede tocar la sincronización**.

Sus seis hallazgos importantes ya están **cerrados** y viven en el motor y en este documento:
tasa de utilidad escribible (§4 `utilityPct`), actividad desconocida devuelve `null` en vez de
regalar la ganancia, Control A que no opina sin nómina, correlación sin precio que ya no grita
subsidio, convención de unidades escrita (§5) y este bloque de estado puesto al día.

**Lo que sigue abierto y hay que recordar:**
- **`otherDirectTotal` ignora importes negativos.** `[600, -100]` da **600**, no 500. Es coherente
  con que las 16 filas son magnitudes de gasto, pero si en F7 se quiere permitir una línea de
  corrección negativa, hay que decidirlo entonces.
- **El §2 sigue sin contrastarse contra el PDF de la Gaceta**, que no está en el repo. Todo el
  valor del módulo cuelga de esa interpretación: si la Fila 12 o la base de la utilidad
  estuvieran mal leídas, **las 113 aserciones estarían verificando el error con toda precisión**.
  Debe salir explícito en la lista de F11.

---

### 9.3 F2: por qué `SYNC_COLLECTIONS` se movió a F4 (decisión del dueño, 01-09-2026)

El plan ponía el registro de sync en F2. **Se mueve a F4**, que es la fase que empieza a escribir
fichas de verdad. El motivo no es estético: **`db.js` ya se había impuesto esa disciplina** al
crear las tablas de `remesas` en v15, con esta nota literal:

> *"NO se agregan a `SYNC_COLLECTIONS` aquí: cada tabla se registrará para la sincronización en la
> fase que empiece a escribirla (junto a su código), para no tocar la capa de sync mientras están
> vacías."*

Coste real de registrarla antes de tiempo, **verificado en el código**: cada colección de
`SYNC_COLLECTIONS` añade un `getDocs` de **colección completa** en cada pull (`syncEngine.js:43`,
sin cursor) y un **`onSnapshot` permanente por dispositivo** (`syncEngine.js:83`). En el plan
gratis de Firebase eso es coste puro por una tabla que estará vacía durante F2, F3 y F4.

**Consecuencia buena:** F2 no toca `src/features/sync/` en absoluto, así que su riesgo de romper la
sincronización es **cero por construcción**, no por revisión. `git status src/features/sync/` sale
vacío en el commit de F2.

**Lo que hay que acordarse en F4:** añadir `{ name: 'costSheets', pk: 'id' }` a `SYNC_COLLECTIONS`.
Si se olvida, las fichas **no viajarán entre dispositivos y no habrá ningún error visible**.

### 9.4 F2: verificación (01-09-2026)

- **El esquema v18 es aditivo puro, comprobado sobre el fichero, no de memoria.** `costSheets:`
  aparece **una sola vez** en todo `db.js` (no redefine ningún store) y el único `.upgrade()` del
  fichero es el preexistente de v5.
- **El string de índices se probó contra la Dexie real**, extrayéndolo de `db.js` con `grep` en vez
  de copiarlo: PK `id` (no autoincremental), índices `groupId, status, productId, createdAt,
  updatedAt`, y `db.costSheets` resuelve a una `Table` (sin colisión silenciosa).
- **Bundle: +90 bytes** (856 445 → 856 535; gzip 248,33 → 248,35 kB). Se verificó **qué** son esos
  bytes buscando dentro del `dist`: está el bloque v18 y **no está nada más** — `fichaWarnings`,
  `utilityBase`, `missingRateInputs`, `costSheetsRepo` y hasta las etiquetas de `constants.js`
  salen **ausentes**, porque todavía nadie las importa y Rollup las descarta.
- **Las guardas del ciclo de vida viven en `lib/fichaCosto.js`, no en el repo**, por el mismo
  motivo que las reglas de `lib/remesas.js`: el repo habla con Dexie y no se puede correr sin
  `indexedDB`, así que lo que hay que poder probar con node sale del repo. El repo las usa como
  candado y la pantalla las usará para habilitar botones: **una sola fuente**.
- **Las líneas a medio teclear NO se descartan.** A diferencia de `recipesRepo.cleanItems` (que
  tira las filas con cantidad 0), aquí solo se normaliza la forma: una ficha se escribe a lo largo
  de un rato con autoguardado, y borrarle al dueño la línea que está escribiendo sería peor que
  guardar una fila vacía. El motor ya trata lo vacío como cero.

---

### 9.5 F4: verificación YA HECHA (01-09-2026). No repetirla.

Antes de escribir una línea de F4 se mapeó **toda** la superficie que toca la sincronización,
leyendo el código, no citando `CLAUDE.md`. **Estos cinco puntos están cerrados: la próxima sesión
no tiene que volver a comprobarlos.**

| Qué | Dónde se verificó | Resultado |
|---|---|---|
| Fusión de una colección nueva | `pullEngine.js:18-42` | Genérica (`db[col.name]`), LWW puro por `syncTs`, con guarda `if (!table)` |
| `recomputeStock` | `pullEngine.js:38-39` | Solo se dispara con `stockMovements`/`products`. Una ficha **no toca inventario** |
| Lote de subida | `pushEngine.js:42` | 400; `costSheets` no está en `PHOTO_COLLECTIONS`, así que no baja a 50 |
| Reglas de Firestore | leído `firestore.rules` entero | `match /{document=**}` bajo `/businesses/{businessId}` cubre `costSheets`. **NO hay que redesplegar reglas** |
| Respaldo y restauración | `backupService.js:39` y `:103` | Enumeran `db.tables` **dinámicamente** → `costSheets` entra sola. **No hay que tocar `backupService.js`** |

### 9.6 CORRECCIÓN al plan de retroceso de v18 (verificada, importante)

Este documento (§10.2) y el hallazgo 6 de `CLAUDE.md` dicen que hacer `/backup` es "el plan de
retroceso real". **Es cierto solo si el respaldo se hace ANTES de que el teléfono abra el build
nuevo**, y eso no estaba escrito en ninguna parte.

`backupService.js:86`:

```js
if ((bk.meta.schema || 1) > db.verno) {
  throw new Error('El respaldo se hizo con una versión más nueva de la app. Actualiza la app primero.')
}
```

El respaldo sella `meta.schema = db.verno` (`:49`). Consecuencia: **un respaldo hecho ya en v18 NO
se puede restaurar en un build v17**. Sumado a que la IndexedDB del aparato queda en v18 en cuanto
abre el build nuevo (y un build v17 ya no puede abrirla), el retroceso solo existe con un respaldo
**tomado en v17**.

**Regla operativa para el día de la fusión a `main`:** respaldo del dispositivo bueno **antes** de
desplegar, guardado fuera del teléfono. Un respaldo tomado después no sirve para volver atrás.
Hoy no hay riesgo: `origin/main` sigue en `4e28ab0` (v17) y de ahí se despliega.

### 9.7 Estado exacto para continuar (01-09-2026, fin de sesión)

**Hecho y subido a `claude/awesome-dirac-484azm`** (7 commits por delante de `main`):

| Commit | Fase |
|---|---|
| `512c9f1` | Las 5 correcciones validadas del plan |
| `bc115e6` | F0, verificación previa con evidencia (§9.1) |
| `af78b09` | F1, motor puro (80 aserciones) |
| `5e292ea` | F1, cierre de los 6 hallazgos de la revisión (§9.2) |
| `1e7b4dc` | F2, Dexie v18 + `costSheetsRepo` + etiquetas (§9.3, §9.4) |
| `dc714a8` | F3, módulo de licencia `fichas` |

**Números de referencia para comparar:** 6 suites, **233 aserciones**, 0 fallos
(21+16+9+32+137+18). `npm run build` exit 0. Bundle **856 580 bytes**, gzip **248,38 kB**
(base de F0: 856 445 / 248,33; el módulo ha costado **+135 bytes** en tres fases porque nada suyo
entra todavía al bundle).

**F4 está BLOQUEADA esperando que el dueño apruebe la maqueta** (enlace arriba). En cuanto la
apruebe, F4 consiste exactamente en:

1. `features/costsheets/CostSheetsScreen.jsx` (lista) y el bloque 1 del editor, contra la maqueta.
2. Rutas `/fichas` y `/ficha/:id` en `router.jsx` con **`React.lazy` + `Suspense`**. Es un patrón
   **nuevo en este repo** (verificado: cero `React.lazy`/`Suspense` en todo `src/`). Ya está
   comprobado que **no rompe el offline**: `vite.config.js` precachea `**/*.{js,css,...}`, así que
   el chunk diferido entra en el precache del service worker igual que los de xlsx/jspdf.
3. **Gate de licencia** con `hasModule(LICENSE_MODULES.COSTSHEETS)`, **gateado en la consulta y no
   solo en el render** (`canFichas ? costSheetsRepo.list() : Promise.resolve([])`), más la tarjeta
   en Home. El gate venía escrito en F3; se movió aquí porque hasta ahora no había nada que gatear.
4. **Registrar `{ name: 'costSheets', pk: 'id' }` en `SYNC_COLLECTIONS`.** Viene de F2 (§9.3).
   **Si se olvida, las fichas no viajan entre dispositivos y NO hay ningún error visible.**
5. Medir el bundle **contra los 856 580 bytes de arriba** y poner el número en el commit.
6. Agente revisor al terminar (F4 lo merece: primera pantalla, patrón nuevo y el único punto del
   módulo que toca la sincronización).

> **§9.7 quedó SUPERADA el 02-09-2026.** F4 no estaba bloqueada (la maqueta aprobada existe, ver
> el bloque de la cabecera) y el punto 2 cambió de decisión (import estático en vez de
> `React.lazy`, ver §3). Se conserva como historia de la sesión anterior. El estado real es §9.8.

---

### 9.8 F4: qué se hizo y qué se verificó (02-09-2026)

**Ficheros nuevos:**

- `src/features/costsheets/CostSheetsScreen.jsx` — lista `/fichas`. `.seg`
  Borradores/Aprobadas/Todas, buscador (reusa `matchesQuery`, que sabe caer a
  `buildSearchTokens` cuando el registro no es un producto), tarjeta con el **precio unitario en
  grande**, `.badge` de estado y el **punto del control de indirectos** visible sin abrir la ficha.
  Estado vacío que explica el Art. 3.
- `src/features/costsheets/CostSheetScreen.jsx` — editor. **Solo el bloque 1** (Identificación):
  producto del catálogo **o** texto libre, código, UM, **tipo de actividad y método primero**
  (mandan sobre todo lo de abajo), nivel de producción y % de capacidad. Barra inferior fija
  (`.pay-bar`) con el precio unitario, que se mueve mientras se teclea.

**Ficheros tocados (los tres, aditivos):** `src/app/router.jsx` (tres rutas nuevas, imports
estáticos), `src/features/home/Home.jsx` (tarjeta gateada en *Gestión*, icono `Calculator`) y
`src/features/sync/collections.js` (`{ name: 'costSheets', pk: 'id' }`).

**Medición del bundle (la línea de vite, kB de 1000):**

| | Base F3 | F4 | Diferencia |
|---|---|---|---|
| `dist/assets/index-*.js` | 856 580 B (856,58 kB) | **878 750 B (878,75 kB)** | **+22 170 B** |
| gzip | 248,38 kB | **254,68 kB** | +6,30 kB |
| Precache | 45 entradas · 3540,24 KiB | **45 entradas · 3561,89 KiB** | +21,65 KiB |

El número de entradas del precache **no cambia**: con import estático no nace ningún chunk nuevo.
Con `React.lazy` habrían sido 46 entradas y **el mismo total descargado** (ver §3).

**Pruebas y build:** 6 suites, **233 aserciones, 0 fallos** (F5 las subió a 247). `npm run build` **exit 0**.

**Verificado leyendo el código, no citando este documento:**

| Qué | Dónde | Resultado |
|---|---|---|
| `costSheets` no rompe el push | `pushEngine.js:127-190` | El bucle es genérico; `costSheets` no está en `PHOTO_COLLECTIONS` → lote de 400; `toCloud` = `JSON.parse(JSON.stringify(...))` mata los `undefined` que Firestore rechaza |
| ...ni el pull | `pullEngine.js:18-42` | `mergeIncoming` es genérica con guarda `if (!table)`; `recomputeStock` **solo** se dispara con `stockMovements`/`products`, y una ficha no toca inventario |
| Nadie más lee `SYNC_COLLECTIONS` | `grep` en todo `src/` | Solo `pushEngine` y `syncEngine`. Ningún consumidor con lista dura que haya que actualizar |
| Respaldo | `backupService.js:39` y `:103` | Enumeran `db.tables` dinámicamente → `costSheets` entra sola, sin tocar nada |
| `listAudit()` no revienta | `db.js:32` | `auditEvents: 'id, entity, entityId, createdAt'` → `entity` **sí** está indexado |
| Sin fuga de licencia | las dos pantallas | El gate va **en la consulta** (`canFichas ? repo.list() : Promise.resolve([])`), no solo en el render, y `canFichas = isManager && hasModule(...)` |
| Auditoría no muestra basura | `AuditScreen.jsx:152-161` | Ninguna pestaña lista `auditEvents` en crudo: los eventos de `costSheet` quedan escritos y **sin pantalla** hasta F10, como ya decía este documento |

**Decisiones de detalle que se tomaron programando (por si hay que revisarlas):**

- **El autoguardado NO corre al abrir.** Solo se dispara con una bandera `dirty` que enciende el
  propio tecleo. Sin esa guarda, **abrir una ficha sellaría `updatedAt`** y el registro subiría a
  la nube sin haber cambiado nada. Hay además un volcado al desmontar la pantalla, para que salir
  antes de que venza el temporizador (600 ms) no pierda el último tecleo.
- **El punto del control de indirectos reusa las clases del salón** (`.dot--busy` verde,
  `.dot--long` ámbar, `.dot--free` punteado). Se reusan por el **color**, que es el correcto, para
  no tocar `global.css`. Es el mismo criterio que el documento fija para `.kpi__delta`.
- **Sin salario directo el punto se pinta vacío**, nunca verde: el motor devuelve
  `applies: false` y un verde se leería como "perfecto".
- **El selector de producto no corta la lista.** Se listan todas las coincidencias, como el
  Catálogo: un corte silencioso escondería justo el producto que se busca.
- **La ficha aprobada se pinta en VERDE, no en ámbar.** Aprobada no es un problema: es el estado
  al que aspira. Ámbar queda para *sustituida* y *eliminada*.
- **El alta exige nombre.** `/ficha/nueva` no crea nada hasta pulsar *Crear ficha* con un nombre
  (propio o traído del catálogo): así no nacen borradores vacíos que todavía no se pueden borrar
  desde la interfaz.

**Lo que se sabe que falta y NO es un olvido:**

- **No hay forma de eliminar una ficha desde la interfaz hasta F8.** `costSheetsRepo.remove`
  (borrado lógico) existe y está escrito, pero su botón vive en el bloque 9. Si al probar se crean
  fichas de prueba, se quedan en la lista hasta F8. Se puede adelantar si el dueño lo pide.
- **Los eventos de `costSheet` en `auditEvents` no tienen pantalla hasta F10.**
- Los bloques 2 a 9 del editor no existen: la pantalla lo dice en voz alta en una tarjeta, para
  que nadie crea que la ficha ya calcula.

**Lo que NO se puede garantizar de F4 (regla 5):** se validó por **código + build + 6 suites
node**. **No se ejecutó la app**: ni se creó una ficha, ni se comprobó el autoguardado en un
teléfono, ni se vio viajar un `costSheets` entre dos dispositivos. La primera vez que un aparato
abra este build, su IndexedDB pasa a **v18 y no puede volver** (§9.6).

---

### 9.9 F5: qué se hizo, qué dijo el revisor y qué queda abierto (02-09-2026)

**Fichero nuevo:** `src/features/costsheets/InputsBlock.jsx` — bloque 2 entero (1.1 insumos, los
tres portadores, Fila 1 con su fórmula, importación desde receta y el delta del Costo Base).
**Tocados:** `CostSheetScreen.jsx` (acordeón de bloques, uno abierto a la vez),
`src/lib/fichaCosto.js` (+`inputLineFor`, +`recipeToInputs`), `src/lib/fichaCosto.test.mjs`
(+14 aserciones) y `src/styles/global.css` (3 clases `.ficha-*` **al final**, como
`.kitchen-grid`). **No se tocan** `costSheetsRepo` (ya aceptaba `inputs`/`carriers`), `db.js` ni
`src/features/sync/`.

| | F4 | F5 | Diferencia |
|---|---|---|---|
| `dist/assets/index-*.js` | 878 750 B | **889 584 B** | **+10 834 B** |
| gzip | 254,68 kB | **257,52 kB** | +2,84 kB |
| Suites node | 233 aserciones | **247 aserciones** | +14 |

**Lo que el revisor independiente confirmó** (revisó el diff, el plan, el motor y los vecinos;
corrió las 6 suites y el build): la **escala es correcta**, verificada por tres vías
(`kitchenRepo.js:105`, el fixture del §5.1 y la sanidad física de 125 g de harina por pan); los
importes salen **íntegros del motor** sin reimplementar una sola fórmula; el gate de `cocina` está
**en la consulta**; las 3 clases nuevas no tocan ninguna pantalla existente y sus dos tokens
(`--surface-2`, `--accent-light`) están definidos **en los dos temas**. **Cero hallazgos
críticos.**

**Sus seis hallazgos importantes, todos cerrados en el commit de arreglos:**

1. **Importar una receta no bloqueaba un insumo en divisa sin tasa** (el selector sí lo hacía).
   Nacía con `priceRate: 0` e importe **cero en silencio**. Ahora la regla vive en
   `recipeToInputs`, que lo deja fuera y **dice cuál**.
2. **La cantidad escalada no se redondeaba:** `0,003 × 200` daba `0.6000000000000001`, y esa
   cifra es la **columna (5) que F9 imprime**. `inputLineFor` la limpia a la **milésima** (misma
   regla que `lib/qty.js`, replicada para que el motor siga sin imports).
3. **Un fallo del autoguardado era invisible:** el `<p className="error">` había quedado *dentro*
   del bloque 1, y el acordeón abre uno a la vez, así que tecleando en el bloque 2 un guardado
   fallido no dejaba rastro. Sacado fuera del acordeón.
4. **Cambiar el nivel de producción después de capturar desfasa el anexo.** Se resolvió con una
   **nota fija** en el bloque 2 (las normas son las del nivel completo; si cambias el nivel, hay
   que revisarlas) en vez del semáforo que proponía el revisor: saber "a qué nivel se capturó"
   exige un **campo nuevo en el registro**, y la forma del documento (§4) es decisión del dueño.
   **Queda abierto para él.** La nota cubre además el caso manual, que el semáforo no cubría.
5. **La columna (4) "Costo Base" por línea no la llena nadie** y `revise` copia el array tal cual,
   así que una revisión nacería con esa columna oficial **en ceros**. **QUEDA ABIERTO Y ASIGNADO
   A F8:** o F8 la deriva de `baseFromSheetId` cruzando por `productId`, o se captura a mano. Lo
   implementado hoy es el delta **agregado** de la Fila 1, que es otra cosa. **Si nadie lo cierra,
   F9 imprime una columna vacía sin que se note.**
6. **Hueco de pruebas.** La regla de la escala vivía dentro del componente. Se extrajo al motor
   (`recipeToInputs`), mismo precedente que `shouldReconcileDelivered` en `lib/remesas.js`, con
   aserciones que anclan el fixture "Pan suave" contra futuras reinterpretaciones.

**Sus menores, también aplicados:** `useMemo` en el `totals` del bloque, criterio único para el
campo vacío, `min="0"` en las seis entradas nuevas (el motor ya ignora los negativos en el
importe, pero el valor **se imprime**), la cabecera del bloque como `<h3>` (la jerarquía se leía
al revés) y el bloque 1 **no plegable** mientras la ficha es nueva (al plegarlo se iba con él el
botón *Crear ficha*). **No aplicado:** `readOnly` frente a `disabled` en los numéricos de una
ficha no editable (cosmético) y el insumo de **texto libre**, que el §7 no pide — **anotado aquí
para decidirlo antes de F9**: una ficha de servicio cuyo insumo no esté en el catálogo hoy no se
puede desagregar.

**Lo que NO se puede garantizar de F5 (regla 5):** código + build + 6 suites node. **No se
ejecutó la app**: no se capturó un insumo real, no se importó una receta de verdad, no se vio el
acordeón ni el autoguardado en un teléfono. El delta de Costo Base **no es ejercitable hasta F8**.
El hallazgo 3 (error invisible) se dedujo de la estructura del JSX, no de verlo fallar.

---

### 9.10 F6: qué se hizo, qué dijo el revisor y qué queda abierto (02-09-2026)

**Fichero nuevo:** `src/features/costsheets/LaborBlock.jsx` — bloque 3 entero: el anexo "Gasto de
salario de los obreros" con sus **nueve columnas en tarjetas**, una por operación (decisión 4 del
§3), el pie `3 × (6 + 7) × 8` por tarjeta y la Fila 2 al final. **Tocados:** `CostSheetScreen.jsx`
(bloque 3 en el acordeón), `src/lib/fichaCosto.js` (+`emptyLaborOp`, +`splitLaborOp`),
`src/lib/fichaCosto.test.mjs` (+20 aserciones) e `InputsBlock.jsx` (`type="button"` defensivo).
**No se tocan** `costSheetsRepo` (ya persistía `labor`: `cleanLabor` en `:85`, alta en `:190`,
`update` en `:230`), `db.js` ni `src/features/sync/`.

| | F5 | F6 | Diferencia |
|---|---|---|---|
| `dist/assets/index-*.js` | 889 584 B | **893 917 B** | **+4 333 B** |
| gzip | 257,52 kB | **258,41 kB** | +0,89 kB |
| Suites node | 247 aserciones | **267 aserciones** | +20 |

**Lo que el revisor independiente confirmó** (reconstruyó el fixture pasando los valores **como
cadenas**, que es lo que produce el formulario): salen **4 800 / 900 / 5 700** clavados;
`laborTotal([op])` es **exactamente idempotente** con `laborTotal(lista)`, así que el pie de cada
tarjeta, el total del bloque y el `t.r2` de la cabecera del acordeón **no pueden divergir**; el
repo ya normalizaba las **ocho columnas capturables** y sus nombres coinciden uno a uno con la
operación en blanco; el autoguardado no se rompió (el candado `loadedId` sigue impidiendo que la
recarga pise lo que se escribe, y `dirty` que abrir una ficha selle `updatedAt`); cero fugas de
licencia y cero cambios en la sincronización; y las once clases CSS usadas existen, sin ninguna
nueva. **Cero hallazgos críticos.**

**Sus cuatro hallazgos importantes, cerrados:**

1. **La documentación se quedó sin actualizar**, contra la instrucción textual de la cabecera de
   este fichero. Es lo que estás leyendo: §9.10, la tabla de fases, la cabecera y `CLAUDE.md`.
2. **La regla del §2.8 volvía a vivir dentro del componente sin cobertura** — el hallazgo 6 de F5
   otra vez. Con una consecuencia **medible**: si alguien "mejora" el duplicado copiando también
   la norma de tiempo (la lectura ingenua de "duplicar"), la **Fila 2 se dobla en silencio**
   (5 700 → 10 500), el precio unitario se dispara y **ninguna aserción falla**. Se extrajo a
   `splitLaborOp` en el motor, anclada por `laborTotal(splitLaborOp(SALARIO, 0)) === 5700`.
3. **El duplicado arrastraba `baseCost`**, la columna (2). Hoy no tiene efecto (vale cero siempre
   y no hay campo que la edite), pero cuando F8 cierre esa columna, partir una operación habría
   **contado su Costo Base dos veces** y el delta Base→Nuevo saldría mal. `splitLaborOp` lo pone
   a cero, con su comentario.
4. **La forma de una fila estaba duplicada** en el componente y en `cleanLabor`. Se cierra con
   `emptyLaborOp()` en el motor: una sola verdad, y probable con node.

**Sus menores, aplicados:** cada etiqueta lleva **su número de columna** (así el pie
`3 × (6 + 7) × 8` se puede seguir campo por campo, como en el bloque 2), la moneda también en
"Pagos adicionales", las notas **una sola vez por bloque** en vez de una por tarjeta, la fórmula
en el total de la Fila 2 y `type="button"` en los botones del módulo.

**Un punto donde el revisor no tenía la evidencia:** propuso que el contador "1 / N" pudiera
significar "fila 1 de las 2 de ESTA operación". No pudo abrir la maqueta; se comprobó en ella y
**es índice global**: pinta *"Empaque 2 / 2"* y Empaque tiene una sola fila (bajo la otra lectura
diría "1 / 1"). Queda como está.

**Desviación declarada de la maqueta, que el revisor respalda:** la maqueta enseña **un** botón al
pie, *"Otra norma de tiempo"*, pero sobre un estado ya poblado; con la lista vacía no tiene qué
duplicar y con dos tarjetas no puede saber cuál. Se implementan **los dos**: *Agregar operación*
al pie y *Otra norma de tiempo* dentro de cada tarjeta. Es un hueco de la maqueta, no del código.
**Pendiente del visto bueno del dueño.**

**LO QUE QUEDA ABIERTO Y HAY QUE RECORDAR:**

- **F8 tiene ahora DOS columnas de Costo Base que llenar, no una:** la (4) del anexo de insumos
  (§9.9 hallazgo 5) y la (2) del anexo de salario. Ninguna se captura hoy y `revise` copia los
  arrays tal cual, así que **una revisión nacería con las dos en ceros**. Si nadie las cierra,
  **F9 imprime dos columnas oficiales vacías sin que se note.**
- **F9 debe filtrar las filas de salario en blanco.** `LaborBlock` es el primer bloque que puede
  parir filas 100 % vacías (las de insumos siempre vienen del catálogo o de una receta), y
  `cleanLabor` **a propósito** no descarta filas incompletas (autoguardado). Sin filtro, el anexo
  oficial imprimiría una fila vacía.
- **Decisiones del dueño, no de la revisión:** (a) un `uid` por operación en vez de la clave por
  índice — cambiaría la forma del registro del §4, y el revisor verificó que **hoy no causa ningún
  error de valores**, solo una aspereza con el doble toque en "quitar"; (b) si *"Otra norma de
  tiempo"* debería llamarse de otro modo para cubrir también el reparto por **grupo escala**, que
  el §2.8 exige igual; (c) `.form-row .field` no lleva `min-width: 0`, así que dos campos por fila
  **podrían** desbordar a 360 px — es **preexistente en media app**, no de F6, y arreglarlo toca
  una clase compartida (regla 2).

**Lo que NO se puede garantizar de F6 (regla 5):** código + build + 6 suites node, más una
comprobación aparte del camino real de la pantalla (valores como cadena, vacíos, negativos, texto
no numérico y el duplicado), que ya vive en la suite. **No se ejecutó la app**: no se capturó una
operación real, no se probó el duplicado ni el autoguardado en un teléfono, y nadie midió el ancho
en una pantalla de 360 px.

---

### 9.11 F7: qué se hizo, qué dijo el revisor y qué queda abierto (03-09-2026)

**Ficheros nuevos:** `OtherDirectBlock.jsx` (bloque 4, Fila 3), `IndirectBlock.jsx` (bloque 5,
Filas 4/6/7 + Control A), `TaxesBlock.jsx` (bloque 6, Filas 8/9/10) y `UtilityBlock.jsx`
(bloque 7, Filas 13/14/15 + Controles B y C). **Tocados:** `CostSheetScreen.jsx`,
`src/lib/fichaCosto.js`, `src/lib/fichaCosto.test.mjs`, `src/db/constants.js`
(`FICHA_WARNING_LABELS`) y `costSheetsRepo.js` (una sola línea: usa `rateToPct` del motor en vez
de su propia copia). **No se tocan** `db.js`, `router.jsx`, `collections.js` ni
`src/features/sync/`.

| | F6 | F7 | Diferencia |
|---|---|---|---|
| `dist/assets/index-*.js` | 893 917 B | **912 845 B** | **+18 928 B** |
| gzip | 258,41 kB | **263,23 kB** | +4,82 kB |
| Suites node | 267 aserciones | **316 aserciones** | +49 |

**CINCO REGLAS NORMATIVAS QUE SE LLEVARON AL MOTOR** (y no a la pantalla), todas con aserciones:

1. **`pctToRate`/`rateToPct` — la trampa de 100× de esta fase.** Los tipos tributarios se
   **guardan en fracción** (12,5 % = `0.125`) pero se **teclean en porcentaje**, al revés que
   `utilityPct`/`capacityPct`. Un solo uso equivocado multiplica o divide la Fila 10 por cien y
   arrastra la 11, la 12 y el precio. Cadena asegurada: 12,5 % → `0.125` → Fila 10 = **1 337,50**
   (no 133 750) → Fila 12 = 32 902,50.
2. **`utilityBaseRows` — qué filas componen la base de la utilidad.** La pantalla enseña **la
   resta**, no solo el resultado, y para eso necesita saber qué filas entran. Esa rama es la
   excepción del Anexo II: reimplementarla en la pantalla dejaría **dos interpretaciones del
   Anexo II** en el mismo programa. Aserción que lo ata: para las **cinco** actividades, sumar
   las filas devueltas da exactamente `utilityBase`.
3. **`indirectCheck().max`** — el techo del Art. 9 se devuelve **siempre**, también cuando el
   control no opina: es propiedad de la actividad, no del cálculo. Derivarlo como `limit/r2` en
   la pantalla se rompería justo cuando `r2 = 0`, que es cuando el control se apaga.
4. **`negativeAmounts`** y 5. **`subOverParentRows`** — los dos datos imposibles. Ver abajo.

**DECISIÓN DE F7 SOBRE LOS IMPORTES NEGATIVOS — el punto que el §9.2 dejó abierto: CERRADO.**
`otherDirectTotal` (y `pos()` en general) los sigue **ignorando**, porque las 16 filas son
magnitudes de gasto. **No se cambia el motor.** Lo que se arregla es que dejaban de verse: ahora
`negativeAmounts` los detecta en **las ocho filas capturadas y en el desglose de la Fila 3**, y
salen por `fichaWarnings`. Y con ellos `subOverParentRows`, porque un “de ello, salarios” mayor
que su fila entra en la base de la Fila 10 y **sube el impuesto**.

**El efecto en cascada que esto destapó, y que está anclado con aserciones:** una Fila 6 en
**−4 100** no se resta, **se anula**. Al anularse (a) 4 100 desaparecen del precio —el unitario
cae de 170,08 a **149,57**—, (b) el aviso de indirectos **desaparece** porque 4+6+7 baja de 8 900
a 4 800, y (c) salta el otro aviso, porque su propio 6.1 (2 400) queda por encima de una fila que
ahora vale cero. Un solo dato mal pegado mueve el precio y deja el impuesto sobre un subtotal
huérfano.

**Lo que el revisor independiente confirmó:** reconstruyó el fixture con los valores **como
cadena** (que es lo que produce el formulario), sin reusar el fixture de la suite, y comprobó
**68 valores**: las Filas 1→12, el Control A (8 900 / 8 550 / exceso **350** / coeficiente
**1,56** / techo 1,50), el Control B (base **9 800**, Fila 13 = 2 450, 15 = **170,08**) y el
Control C (28 000 → **−3 565**, unitario **140,00**). **Cero discrepancias.** Verificó también que
ninguna pantalla reimplementa una fórmula, que `cleanRows` persiste **las diez** filas, que los
tres controles son avisos y nunca cerrojos, que las **30** clases CSS usadas existen (ninguna
nueva, `global.css` no se tocó), que ninguna afirmación normativa está inventada, y que **cero**
cambios tocan la sincronización. **Cero hallazgos críticos.**

**Sus tres hallazgos importantes, cerrados:**

1. **La documentación volvió a quedarse sin actualizar** — reincidencia del hallazgo 1 de F6. Es
   lo que estás leyendo.
2. **La decisión sobre los negativos se había aplicado a UN bloque de tres.** Las Filas 4, 4.1, 6,
   6.1, 7, 7.1, 8 y 9 pasaban por el mismo `pos()` sin una palabra, y **esas sí entran en el
   precio**. Ahora el aviso es el mismo en los tres bloques y lo decide el motor.
3. **Los dos avisos locales solo existían con su bloque ABIERTO**, y el acordeón abre uno a la vez
   (misma clase de problema que el hallazgo 3 de F5). Se resolvió como recomendaba: **suben a
   `fichaWarnings`** y además hay un **resumen de avisos FUERA del acordeón**, así que se ven con
   los bloques plegados y **F8 tendrá dónde consultarlos antes de aprobar**.

**Sus menores, aplicados:** el texto de los tipos tributarios se **resincroniza** si el valor
guardado cambia desde fuera (la guarda es exacta: `setTax` deja siempre
`pctToRate(texto) === guardado`, así que no puede dispararse mientras se teclea); el `.seg` del
método ya **no reescribe** el método que ya está puesto (sellaba `updatedAt` y subía el registro a
la nube sin cambio real); las **tres copias** de la conversión fracción→porcentaje se sustituyen
por `rateToPct` (una de ellas estaba en el repo); con actividad desconocida el techo del Art. 9 se
pinta **“—”** en vez de afirmar un 1,00 que es un valor por defecto y no la norma; y los atajos
del bloque 4 dejan de usar `.chip-btn`, que en el resto de la app es un chip de **filtro** y no de
**añadir**.

**Una corrección al mensaje del commit de F7:** decía que los tres controles salen de
`fichaWarnings`. El Control A se pinta desde `indirectCheck(sheet)` directamente, porque el bloque
necesita `sum`/`limit`/`max` de todos modos. **No pueden divergir** (la condición es literalmente
la misma), pero la frase no describía el código.

**LO QUE QUEDA ABIERTO Y HAY QUE RECORDAR:**

- **F8: DOS columnas de Costo Base que llenar** — la (4) del anexo de insumos y la (2) del de
  salario. `revise` copia los arrays tal cual, así que una revisión nacería con las dos en ceros y
  **F9 imprimiría dos columnas oficiales vacías** sin que se note.
- **F9: filtrar las filas en blanco.** Ya eran las de salario; ahora también **las filas 4.1, 6.1
  y 7.1 en cero**, que el documento oficial imprimiría vacías.
- **Fusión de dos dispositivos sobre la MISMA ficha:** el autoguardado manda el `form` **completo**
  y el formulario solo se recarga una vez por `sheet.id`, así que un cambio remoto en otro anexo de
  la misma ficha **se pisa**. Es coherente con la decisión “la ficha la edita un solo actor” (§4),
  pero queda dicho.
- **Una tasa tecleada igual al máximo de su actividad es indistinguible de “sin tocar”** tras
  recargar la pantalla (`teniaPropia` compara contra el máximo), así que cambiar de actividad la
  sustituye. Es la heurística que la regla describe; distinguirlo exigiría un campo nuevo. **No es
  un bug: está escrito aquí para que no se lea como tal más adelante.**
- **Decisión del dueño, no de la revisión:** el `uid` por fila (§9.10(a)) ahora afecta a **tres**
  listas (insumos, salario y otros directos). Sigue sin causar ningún error de valores; solo una
  aspereza de foco al quitar una fila.
- **Nota de coma flotante, para que nadie la “arregle”:** `29 915 / 200` **no es** 149,575 en
  doble precisión, es 149,574999…, así que **149,57 es correcto** y es también lo que daría
  `toFixed(2)`. No es un fallo de `round2`.

**Lo que NO se puede garantizar de F7 (regla 5):** código + build + 6 suites node, más una
comprobación aparte de 44 aserciones sobre el fixture completo por los caminos de pantalla. **No
se ejecutó la app**: ningún semáforo visto, ningún 12,5 % teclado en un teclado real, ningún
acordeón en un teléfono, ninguna ficha capturada de punta a punta, ninguna fusión entre dos
dispositivos. Y **el §2 sigue sin contrastarse contra el PDF de la Gaceta**, que no está en el
repo: si la Fila 12 o la base estuvieran mal leídas, las 316 aserciones estarían verificando el
error con toda precisión. Sigue siendo tarea de F11.

---

### 9.12 F8: qué se hizo, qué dijo el revisor y qué queda abierto (03-09-2026)

**Ficheros nuevos:** `RefsBlock.jsx` (bloque 8, Fila 16) y `SignBlock.jsx` (bloque 9: firmas,
aprobar, revisar, eliminar e historial). **Tocados:** `CostSheetScreen.jsx`,
`src/lib/fichaCosto.js` (+`baseCostsFrom`, +`reviseFrom`), `src/repositories/costSheetsRepo.js`
(`revise` delega en el motor), `InputsBlock.jsx` y `LaborBlock.jsx` (pintan el Costo Base por
línea) y la suite. **No se tocan** `db.js`, `router.jsx`, `collections.js` ni
`src/features/sync/`. Los eventos de auditoría (`create`/`approve`/`revise`/`delete`) los
escribía ya el repo desde F2: F8 solo los dispara, y **siguen sin pantalla hasta F10**.

| | F7 | F8 | Diferencia |
|---|---|---|---|
| `dist/assets/index-*.js` | 912 845 B | **923 556 B** | **+10 711 B** |
| gzip | 263,23 kB | **266,03 kB** | +2,80 kB |
| Suites node | 316 aserciones | **337 aserciones** | +21 |

**LAS DOS COLUMNAS "COSTO BASE" QUEDAN CERRADAS. Se DERIVAN, no se teclean.** Era la apertura que
§9.9 (hallazgo 5) y §9.10 dejaron asignada a F8: la columna (4) del anexo de insumos y la (2) del
de salario no las llenaba nadie, `revise` copiaba los arrays tal cual y **una revisión nacía con
las dos columnas oficiales en ceros**, que F9 habría impreso vacías sin que se notara.

La clave es que la revisión copia los arrays **posicionalmente**: en ese instante la línea *i* de
la copia **es** la línea *i* de la anterior, así que **no hay ningún emparejamiento heurístico**
que pueda fallar con dos insumos del mismo producto o dos operaciones del mismo nombre (el
revisor lo comprobó a propósito con esos dos casos). Y se calculan con las **mismas** funciones
que valoran la columna nueva (`inputsTotal([l])`, `laborTotal([o])`), así que Base y Nueva no
pueden discrepar por redondeo. Una línea en divisa congela su importe **en MN** con su tasa
congelada, para que las dos columnas sean comparables.

**Interpretación normativa (confirmada por el revisor):** la columna (4) es un **importe**, no un
precio unitario. §2.7 la pone en paralelo a (7) *Costo propuesto = 5 × 6*, y §2.8 pone la (2) en
paralelo a (9) *Gasto = 3 × (6+7) × 8*. El argumento decisivo es de cuadre: **solo con esa lectura
la suma de la columna (4) es la Fila 1.1 de la versión anterior**, que es lo que la columna *Costo
Base* del Anexo I necesita.

**`reviseFrom` vive en el MOTOR, no en el repo.** Es el mismo movimiento que `recipeToInputs`
(F5), `splitLaborOp` y `emptyLaborOp` (F6), y por el mismo motivo: el repo habla con Dexie y no se
puede correr con node, así que un literal armado allí **queda sin cobertura**. El revisor lo
demostró: con `...baseCostsFrom(prev)` puesto **antes** de `...copia`, las dos columnas nacen en
`undefined` (→ 0 al primer autoguardado), las 16 filas siguen idénticas y **ninguna aserción
falla**. Ahora `costSheetsRepo.revise` no arma ningún literal: llama a `reviseFrom`, y la suite
prueba **el código real**.

**UNA INVARIANTE QUE NO ESTABA ESCRITA: crear una revisión no puede mover ni un importe.** Si lo
moviera, al dueño le cambiaría el precio de una ficha por el simple hecho de abrir su corrección.
Se comprueba que las 16 filas y el precio salen idénticos, que la columna (4) no se mueve al
reteclear el precio (y la nueva sí), que las dos columnas nacen con **número** y nunca en
`undefined`, y que **la v3 hereda de la v2 y no de la v1** — si heredara de la v1, el Costo Base
mentiría sobre cuál fue el precio anterior.

**Lo que el revisor independiente confirmó:** `approve` sella `updatedAt`, `revise` lo sella en
**los dos** registros que toca y `remove` también, así que **la aprobación sí sube a la nube** (el
peligro del §4: `approvedAt` no está en `TS_FIELDS`). Las tres corren en transacción, así que **no
puede quedar una sustituida sin sucesora**, y `revise` relee `canReviseSheet` **dentro** de la
transacción, así que un doble toque no puede abrir dos ramas del mismo grupo. La UI ofrece
exactamente lo que el repo permite (usa las mismas funciones puras). Las 18 clases CSS usadas
existen, ninguna nueva. `toCloud` es `JSON.parse(JSON.stringify(...))` y `baseCostsFrom` solo
escribe números: **ningún `undefined` que Firestore rechace**. **Cero hallazgos críticos.**

**Sus cinco hallazgos importantes, cerrados:**

1. **La documentación sin actualizar, TERCERA vez consecutiva** (fue hallazgo 1 en F6 y en F7). Es
   lo que estás leyendo. **Cambio de proceso, no solo de fichero: desde F9 el §9.x va DENTRO del
   commit de la fase.**
2. **A `SignBlock` le faltaba `key={sheet.id}`.** Guarda en estado local la firma tecleada, y la
   pantalla **no se desmonta** al navegar a la revisión: el camino *aprobar v1 → Nueva revisión*
   dejaba el campo *Aprobado por* **preescrito con la firma de la v1** y el botón de aprobar
   habilitado sin que nadie hubiera escrito nada. Perforaba justo la garantía que esta fase añade.
   El precedente estaba en el mismo fichero (`TaxesBlock`, F7).
3. **El autoguardado podía escribir el formulario de la ficha ANTERIOR sobre la revisión nueva.**
   Tras `revise`, `navigate` cambia `id` de inmediato y el `form` sigue siendo el de la versión
   anterior; teclear en esa ventana habría borrado las columnas recién derivadas, **en silencio**.
   Cerrado con `if (loadedId.current !== id) return` en el efecto, en `flush` y en el volcado al
   desmontar.
4. **La suite replicaba el literal de `revise` a mano.** Cerrado extrayendo `reviseFrom` (arriba).
5. **La columna derivada no se pintaba en ninguna parte**, así que cualquier error sobre ella era
   silencioso hasta el PDF. Ahora cada línea de los bloques 2 y 3 muestra su **(4)/(2) Costo
   base** con su delta **de color invertido** (subir el costo es malo), que es literalmente lo que
   pide el §7 y que hasta hoy solo existía como delta *agregado* de la Fila 1.

**Sus menores, aplicados:** el autoguardado no arma temporizador mientras corre una acción del
ciclo de vida (si el dueño teclea **durante** el `await` de aprobar, a los 600 ms saltaba *"una
ficha aprobada no se edita"* sobre una aprobación correcta); el historial de versiones es
**navegable** (sin eso, desde la v2 no había forma de abrir la v1) y dice **las dos cosas** de una
versión eliminada (*"aprobada, eliminada"*); eliminar una **aprobada** avisa con todas las letras
de que el grupo queda **sin sucesión posible**; `type="button"` en la cabecera del acordeón; y los
comentarios que decían *"queda asignada a F8"* ya no mienten.

**LO QUE QUEDA ABIERTO:**

- **§2.7 dice que la columna (4) se usa "si es modificación de precio O EL PRODUCTO NUEVO TIENE UN
  COMPARABLE".** F8 cierra el primer caso (la derivación al revisar) y **el segundo se queda sin
  vía**: no hay campo para teclear un Costo Base en una v1 con comparable externo. **Decisión del
  dueño:** ¿se añade un campo capturable por línea, o se acepta que ese caso se resuelve
  declarando el comparable en la Fila 16?
- **F9 hereda TRES filtros de filas en blanco, no dos:** las de salario (§9.10), las Filas 4.1,
  6.1 y 7.1 en cero (§9.11) y ahora las **referencias de la Fila 16 vacías** — `cleanRefs` no
  descarta una referencia sin fuente ni precio, a propósito, por el autoguardado.
- **F9 debe imprimir el `baseCost` POR LÍNEA** en las columnas (4) y (2). Es el consumidor único
  de lo que F8 deriva.
- **`currentOfGroup` (`costSheetsRepo.js`) sigue sin ningún llamador** desde F2. Se conserva a
  propósito para F9/F10 (marcar cuál es la versión viva de un grupo); sin linter, nadie más lo va
  a ver. Si F10 no lo usa, hay que quitarlo.
- **Doble revisión desde dos dispositivos:** si A revisa la v1 estando B offline con la v1 aún
  aprobada, B también revisa, y tras la fusión el grupo tiene **dos v2 borrador**. Es coherente
  con la decisión "la ficha la edita un solo actor" (§4) y con el aviso de fusión de `CLAUDE.md`,
  pero queda dicho.
- **Eliminar una aprobada no tiene vuelta atrás desde la interfaz.** El dato no se pierde
  (borrado lógico + auditoría), pero no hay pantalla de restauración. **Decisión del dueño:** o se
  limita el borrado a borrador/sustituida, o F10 añade un "restaurar" en la pestaña de auditoría.
- **Discrepancia con la maqueta, declarada:** su vista del bloque 8 pinta un clip (📎) en cada
  referencia, o sea un **adjunto**. El registro del §4 no tiene campo para eso (`refs` es
  `{source, price, note}`) y **no se ha inventado uno**. Si el dueño quiere adjuntar el
  comprobante, es un campo nuevo y probablemente el módulo `imagenes`.

**Lo que NO se puede garantizar de F8 (regla 5):** código + build + 6 suites node, más una
comprobación aparte de 25 aserciones sobre el ciclo de vida entero. **No se ejecutó la app**: no
se aprobó una ficha real, no se creó una revisión real, no se vio un `confirm()` en un teléfono, y
**nadie ha comprobado en runtime que una aprobación viaje entre dos dispositivos**, que es el caso
que el §4 marca como peligroso. Y **el §2 sigue sin contrastarse contra el PDF de la Gaceta**: si
la columna (4) fuera el precio unitario base en vez del importe, el anexo de F9 imprimiría la
magnitud equivocada y **ninguna de las 337 aserciones fallaría**. Sigue siendo tarea de F11.

---

### 9.13 F9: exportación de las tres hojas oficiales (03-09-2026)

**Fichero nuevo:** `src/features/reports/fichaReports.js` — las tres hojas, con su suite propia
`fichaReports.test.mjs` (**61 aserciones**; las suites pasan de 6 a **7**). **Tocados:**
`reportsService.js` (los dos exportadores) y `SignBlock.jsx` (la hoja de exportación del bloque 9).

| | F8 | F9 | Diferencia |
|---|---|---|---|
| `dist/assets/index-*.js` | 923 556 B | **930 615 B** | **+7 059 B** |
| gzip | 266,03 kB | **268,17 kB** | +2,14 kB |
| Suites node | 337 aserciones (6) | **398 aserciones (7)** | +61 |

**LA COMPROBACIÓN OBLIGATORIA DEL §3 (decisión 5), HECHA — y más fuerte de lo que pedía.** El plan
exigía exportar un reporte preexistente antes y después del cambio y comprobar que el archivo sale
igual, y decía que *"sin esa comprobación F9 no se da por hecha"*. No hay navegador aquí, pero **sí
hay algo mejor**: `xlsx` y `jspdf` corren en **node**, y son ellos quienes construyen el fichero
(`downloadBlob` solo lo entrega). Así que se generaron los ficheros de verdad con el código viejo y
con el nuevo y se compararon **byte a byte**:

- **Excel:** *Inventario por ubicación* y *Ventas (detalle)* salen **idénticos**, con la escritura
  probada determinista primero (dos escrituras iguales dan los mismos bytes). También con
  `header`/`footer` a `null`, a `undefined` y a algo que no es una lista: la guarda es
  `Array.isArray`.
- **PDF:** *Inventario por ubicación* y *Cierres de turno* salen **idénticos**. jsPDF sella en el
  trailer un `/ID [ <hex32> <hex32> ]` **aleatorio** que hace que dos PDF iguales difieran en 62
  bytes; se comprobó que **esa es la única diferencia** (mismo tamaño, todo lo demás igual) y se
  normaliza para comparar. La fecha de creación se fija con `setCreationDate`.
- Y la prueba complementaria, para que las anteriores no sean vacías: **con** `header`/`footer` el
  fichero **sí cambia**, el encabezado va en la primera fila y el pie al final.

**Cómo son los dos campos nuevos.** `report.header` y `report.footer` son **listas de líneas**
opcionales. En Excel entran como filas al principio y al final; en PDF se pintan entre el subtítulo
y la tabla, y bajo ella. Sin ellos, `startY` sigue valiendo **28** y la hoja sigue siendo
`[head, ...rows]`: exactamente lo de antes. **Ojo: `head` (las columnas de la tabla) y `header`
(las líneas de arriba) son cosas distintas y se parecen demasiado**; hay un comentario en el código
avisándolo.

**Los builders son PUROS, al revés que todos los demás del proyecto.** Reciben la ficha ya cargada
(la pantalla la tiene en memoria) y no tocan Dexie. No es un capricho: permite **probarlos con
node**, y lo que imprimen es el documento con el que el dueño sostiene un precio ante un control —
lo último del módulo que puede fallar en silencio, porque nadie lee un PDF con una calculadora al
lado. **La aserción que más importa de esa suite: en los dos anexos, la SUMA DE LO IMPRESO da el
TOTAL IMPRESO.** Es lo que mira un inspector, y es la razón por la que el motor redondea por línea
y no al final (§5).

**Consecuencia de la pureza:** `fichaReports.js` importa con **extensión `.js`**, al revés que el
resto del proyecto. Node la exige en ESM y Vite la acepta igual; sin ella el fichero no se podría
correr con `node`. Los cuatro módulos que importa (`lib/currency`, `lib/dates`, `lib/fichaCosto`,
`db/constants`) no tienen a su vez ningún import, así que la cadena entera es ejecutable fuera del
navegador.

**Decisiones de esta fase:**

- **El agua NO aparece en el anexo de insumos.** El modelo del §2.7 lleva al pie **dos** filas
  fijas —combustibles y lubricantes (LITROS) y energía eléctrica (kw)— y no una tercera. Se
  respeta el modelo y **no se inventa una fila**: el agua está en la **Fila 1.4 de la hoja 1**.
  Queda dicho por si el dueño prefiere lo contrario.
- **Las referencias de la Fila 16 van al PIE de la hoja 1, no en la tabla.** La fila es
  explicativa y no lleva importe, así que en la tabla solo consta cuántas hay; el detalle
  (fuente, qué se compara y precio) va abajo, que es donde el Apartado Segundo quiere las
  **bases** del precio. De paso resuelve el filtro que §9.12 dejó anotado: las referencias vacías
  **no se imprimen**.
- **La columna "Costo Base" de la hoja 1 existe siempre**, aunque vaya vacía cuando no hay versión
  anterior: es una de las dos columnas del modelo oficial, y vacía dice *"no hay con qué
  comparar"*, que es la verdad.
- **Se exporta lo que hay EN PANTALLA**, incluido lo que aún no ha llegado al autoguardado: es lo
  que el dueño está mirando. El encabezado dice si la ficha es **borrador** o **aprobada**, y la
  pantalla lo avisa.
- **Los importes van como números**, no como texto, igual que en el resto de los reportes: así
  Excel los suma.

**LO QUE QUEDA ABIERTO:**

- **Los filtros de filas en blanco que §9.10 y §9.11 dejaron anotados**: las de salario y las
  Filas 4.1/6.1/7.1 en cero **siguen imprimiéndose**. Se decidió NO filtrarlas: son filas del
  modelo oficial (la 4.1 existe aunque valga cero) y una operación de salario a medio teclear es
  visible en el anexo, que es donde el dueño la va a ver antes de firmar. **Si el dueño prefiere
  que se filtren, es una línea por anexo.** Lo que sí se filtra son las referencias vacías, porque
  la Fila 16 no es una fila del modelo sino una lista.
- **La segunda mitad del §2.7** (columna (4) para un producto nuevo **con comparable**) sigue sin
  vía de captura: §9.12 la dejó como decisión del dueño y F9 no la cambia. Hoy esa columna solo se
  llena en una revisión.
- **La maqueta enseña la hoja de exportación con 3 filas × (PDF | Excel)**, que es lo que se
  implementó, pero **no pude contrastarla contra el artefacto en esta sesión**; se siguió la
  descripción del §3 y del §8.

**Lo que NO se puede garantizar de F9 (regla 5):** la identidad de los reportes preexistentes está
probada **generando los ficheros**, que es lo más fuerte que se puede hacer sin navegador; pero
**nadie ha abierto un PDF ni un Excel de la ficha para mirarlo**. No sé si el encabezado cabe, si
las 9 columnas del anexo de salario entran en horizontal sin cortarse, ni si el pie de firmas cae
en la página siguiente cuando la tabla es larga. **Eso solo se ve abriendo el fichero**, y es lo
primero que conviene mirar en el canal de pruebas. Y el §2 sigue sin contrastarse contra el PDF de
la Gaceta: si la interpretación estuviera mal, el documento se imprimiría mal con toda precisión.

---

**Por qué F10 lleva pestaña de auditoría** (corrección 01-09-2026, verificada). F8 escribe eventos
en `auditEvents`, pero **hoy nadie podría leerlos**: `AuditScreen.jsx:152-161` tiene las pestañas
fijas (Turnos, Ventas, Inventario, Precios, Bajas, + Cocina y Entregas gateadas) y la de *Bajas*
(`:165-180`) no lista `auditEvents` en general, sino lo que devuelve `productsRepo.listDeleted()`,
que filtra `entity === 'product' && action === 'delete'` (`productsRepo.js:121-124`). Un evento con
`entity: 'costSheet'` quedaría escrito y **sin ninguna pantalla que lo muestre**: dato ciego. F10
añade la pestaña siguiendo el patrón exacto de Cocina y Entregas (`:158` y `:161`), **gateada con
`hasModule` y con la consulta gateada también** (`canFichas ? costSheetsRepo.list() : []`), no solo
el render.

**Cómo releer el PDF de la Gaceta** (si hiciera falta desde otra máquina): en la PC original
`Read` no podía abrirlo (falta `poppler`) y python no tenía librerías de PDF; la receta que
funcionó fue extraer los streams con `re` + `zlib` y decodificar con el `ToUnicode` del propio
PDF. Con la §2 de este documento **no debería hacer falta volver al PDF**.

---

## 10. Lo que NO se puede garantizar (regla 5: decirlo siempre)

1. Todo se valida por **código + build + pruebas node**; no hay runtime en el dispositivo del
   dueño. **Nada se declara "probado" sin que él lo pruebe.**
2. **v18 es de ida:** no hay manejo de `VersionError`; en cuanto un teléfono abra el build nuevo
   su IndexedDB queda en v18 y no puede volver a v17. **Hacer `/backup` de un dispositivo bueno
   ANTES de actualizar** es el plan de retroceso real, y el **antes** es obligatorio: un respaldo
   tomado ya en v18 **NO se puede restaurar** en un build v17, porque `backupService.js:86`
   rechaza cualquier respaldo cuyo `meta.schema` supere al esquema de la app. Detalle verificado
   en §9.6.
3. Los tipos de Seguridad Social y de Utilización de la Fuerza de Trabajo **no están en la
   Resolución**: van configurables, por defecto 0. **No inventar porcentajes.**
4. El Anexo II norma a entidades estatales; para la MYPIME es referencia (Art. 6), por eso todo
   es aviso y no bloqueo.
5. **Fuera de alcance a propósito:** margen comercial minorista y tributos del Art. 15, ficha
   ramal (punto 6 de la Resolución) y la Carta Tecnológica como documento propio.

---

## 11. Cómo se entregan los diseños de este proyecto (para la próxima ronda)

El dueño aprueba mirando pantallas, no leyendo especificaciones: pide un **artefacto visual
publicado** (no texto en la terminal, no un `.md`) y pide explícitamente que se usen las skills
**`impeccable`** y **`design-taste-frontend`**.

- Publicar con la herramienta `Artifact` y **republicar sobre el mismo `file_path`** para
  conservar la URL.
- **Todo en español.**
- Las maquetas se construyen con los **tokens y clases reales de `src/styles/global.css`** (navy
  `#0a1c38`, verde `#2bbd6e`, `.card .btn .seg .badge .cuadre-banner .pay-bar`). Los teléfonos
  conservan el tema oscuro de la app aunque el documento siga el tema del lector: son aparatos,
  no superficies del documento. Lo impreso (PDF, ticket) va siempre tinta sobre papel, en los dos
  temas.
- Un **ejemplo numérico único y verificable** recorriendo todo el documento vale más que cifras
  sueltas por sección (por eso existe "Pan suave").
- Filtro anti-slop que sí se aplica aquí: **cero em-dash y cero en-dash** en texto visible;
  **máximo un eyebrow por cada 3 secciones**; sin puntos de color decorativos (solo si llevan
  estado real); sin eyebrows numerados.
- Dos reglas de esa skill se anulan a propósito y conviene decirlo al entregar: la **serif** en
  titulares (separa la voz del documento normativo de la voz de la app, que es sans) y el veto a
  las **maquetas hechas con divs** (aquí la maqueta *es* el objeto que se aprueba).
- El artefacto debe decir en voz alta **lo que no se puede garantizar**.
