# Módulo `fichas` — Ficha de costos y gastos (Res. 148/2023 MFP)

Documento **único de traspaso** del módulo. Recoge todo lo que estaba disperso en la memoria
local de una máquina para que el trabajo pueda **continuarse desde otra PC y otra sesión** sin
volver a leer la Gaceta ni a rehacer el diseño.

> **Estado al 01-09-2026: F0, F1 y F2 HECHAS. F3 en adelante, pendientes.**
> **Ya existen** `src/lib/fichaCosto.js` (motor puro) con `src/lib/fichaCosto.test.mjs`
> (**134 aserciones**), la versión **Dexie v18** con la tabla `costSheets`,
> `src/repositories/costSheetsRepo.js` y las etiquetas en `src/db/constants.js`.
> **Todavía NO existen** la licencia `fichas`, la ruta `/fichas` ni ninguna pantalla, y
> `costSheets` **NO está registrada en `SYNC_COLLECTIONS`** (se registra en F4, ver §9.3).
> Nadie importa el repo todavía, así que la app desplegada sigue sin ofrecer nada del módulo.
> Rama de desarrollo: `claude/awesome-dirac-484azm` (nada a `main` sin autorización).
>
> **Mantener este bloque al día en CADA fase.** Este fichero existe para continuar el trabajo
> desde otra PC; si miente sobre su propio estado, la siguiente sesión rehace lo hecho.

**Diseño visual aprobado (referencia obligatoria antes de programar pantallas):**
https://claude.ai/code/artifact/1134b7b2-d636-4a6a-9856-19e3ddb3a879 — *"Ficha de Costo
148/2023"*, versión v2, aprobada el 31-08-2026. Se abre desde cualquier PC con la cuenta del
dueño. Las maquetas de ese artefacto son la referencia contra la que se construyen las fases.

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

**Decisión del bundle, cerrada por defecto (31-08-2026):** `RemesasScreen` entra por import
estático y su peso lo pagan también los negocios sin la licencia (hallazgo 7 de `CLAUDE.md`). La
pantalla de ficha será igual de grande. Al aprobar, el dueño **no eligió entre las dos opciones**,
así que rige lo que decía el documento: se implementa **`React.lazy` + `Suspense` solo para
`/fichas` y `/ficha/:id` desde F4** (aditivo, no cambia ninguna ruta existente), **midiendo el
bundle antes y después** y poniendo el número en el mensaje del commit de F4. Es reversible en un
commit si la medición no compensa el patrón nuevo.

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
  que cada pantalla reinvente la condición. Códigos: `insumo-sin-tasa`, `actividad-desconocida`,
  `correlacion-sin-precio`, `indirectos-exceden`, `utilidad-sobre-maximo`, `subsidio`. **Todos
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
| **F3** | Licencia: `LICENSE_MODULES.COSTSHEETS` + label + gate. | Pendiente |
| **F4** | Lista + identificación (`/fichas`, bloque 1) + `React.lazy` con medición del bundle + **registrar `costSheets` en `SYNC_COLLECTIONS`** (viene de F2). | Pendiente |
| **F5** | Anexo de insumos (bloque 2 + importar receta + portadores). | Pendiente |
| **F6** | Anexo de salario (bloque 3). | Pendiente |
| **F7** | Indirectos, tributos, utilidad y precio (bloques 4-7 con semáforos). | Pendiente |
| **F8** | Firmas, aprobación y revisiones (bloques 8-9 + `auditEvents`). | Pendiente |
| **F9** | Exportación por hoja (`fichaReports.js`): 3 hojas, cada una a su propio PDF y Excel, con encabezado de identificación y pie de firmas. **Incluye los campos opcionales `header`/`footer` en `exportPdf`/`exportExcel` (decisión 5 de §3) y la comprobación de que un reporte preexistente sale idéntico.** | Pendiente |
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
   antes de actualizar** es el plan de retroceso real.
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
