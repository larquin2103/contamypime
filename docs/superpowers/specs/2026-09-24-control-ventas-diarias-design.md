# Control de Ventas Diarias — diseño (24-09-2026)

**Aprobado por el dueño, sección a sección, el 24-09-2026.** Lo pide el cliente **Burger Premium**
para sustituir su hoja de papel «Control de Ventas Diarias» (foto:
`e:\code\burguer\WhatsApp Image 2026-09-22 at 3.40.55 PM.jpeg`). **Es su documento primario**: la
veracidad de cada cifra es el requisito principal.

## 1. Objetivo y criterio de éxito

Un reporte nuevo en *Reportes → Ventas*, **«Control de Ventas Diarias»**, con filtro de fechas, que
por cada día y ubicación liste los productos **en orden alfabético** con estas columnas:

**Producto · Saldo inicio · Entrada · Salida · Merma · Venta · Ajuste · Precio · Importe · Saldo final**

Cada día lleva una cabecera con «ID de Venta» y «Entregado por».

**Éxito:**
- en cada fila, `Saldo final = Saldo inicio + Entrada − Salida − Merma − Venta + Ajuste`;
- el saldo final es igual al saldo del libro mayor al cierre de ese día, en esa ubicación;
- el saldo inicio de cada día es el saldo final del anterior;
- ninguna cifra sale de la caché (`products.stock` / `stockByLocation`).

Es **solo lectura**: no escribe en la base, no toca la sincronización ni cambia ningún reporte
existente.

## 2. Decisiones del dueño

| Pregunta | Decisión |
|---|---|
| Ubicación | **Selector**: almacén, áreas, cocina y cualquier ubicación con movimientos. Por defecto, la primera área de venta. |
| Ajustes por conteo físico y carga inicial | **Columna «Ajuste»** con signo, entre Venta y Precio. |
| Venta, Precio, Importe | **Libro más control de dinero.** Venta = salidas por venta del libro, netas de anulaciones. Precio = el de la ficha. Importe = Venta × Precio. Al pie, el control contra lo cobrado. |
| Productos | Los que tengan **saldo o algún movimiento** en esa ubicación dentro del rango, en orden alfabético, con **filtro opcional de categoría**. |
| Varios días | **Un bloque por día**, en el mismo PDF/Excel. |
| Cabecera | **Turnos del día**: «Entregado por» = los vendedores con turno en esa ubicación ese día; «ID de Venta» = el folio corto de cada turno (últimos 6 caracteres del id, en mayúsculas, como el ticket). |

## 3. Qué suma cada columna

Todo sale de `stockMovements`, filtrado por ubicación con `(m.location || WAREHOUSE) === location`
(el criterio del submayor y de `recomputeStock`) y agrupado por **día local** (`localDay`). Cada
movimiento se clasifica con el **`ledgerKey` existente** de `reportsService.js`, que se **inyecta**
en el módulo puro: una sola fuente de verdad, y su código no se toca.

| Columna | Claves de `ledgerKey` |
|---|---|
| Saldo inicio | suma con signo de todo lo anterior al día |
| Entrada | `compras` + `traspIn` + `producido` |
| Salida | −(`traspOut` + `consumo` + `deuda` + `terceros`) |
| Merma | −`merma` |
| Venta | −`ventas` (neto: la anulación de mesa, `order_void`, entra en positivo y la descuenta) |
| Ajuste | `ajustes` + `cargaIni`, con signo |
| Precio | `baseValuer().price(p)`: MN; si el producto está en divisa, a la tasa vigente |
| Importe | `round2(Venta × Precio)` |
| Saldo final | Saldo inicio + neto del día |

Entrada, Salida, Merma y Venta se muestran positivas, como en el papel. La suma usa el signo real.
Las cantidades se redondean con `cleanQty` (3 decimales, para no perder gramos en los productos por
peso) y el dinero con `round2`. El cotejo con el submayor, que usa `round2`, tolera 0,011.

**Qué productos salen:**
- activos o no, los que en esa ubicación tengan saldo inicio ≠ 0, algún movimiento en el día o
  saldo final ≠ 0; los que están todo en cero no ocupan fila;
- ordenados con `localeCompare(…, 'es')`;
- con el filtro de categoría (`categoryId`), si se elige.

## 4. Controles de veracidad (se imprimen en el reporte)

1. **Cuadre por fila y encadenado entre días**, por construcción. Las pruebas lo comprueban
   producto a producto.
2. **Control de dinero, al pie de cada día — VERSIÓN VIGENTE: DESCRIPTIVA (24-09-2026).**
   Tres revisiones independientes encontraron causas falsas en cada ronda: inferir *qué pasó*
   (cobro duplicado, no cobrado, cobrado otro día…) desde los totales del libro es ambiguo por
   naturaleza. Decisión del dueño: el control **no interpreta**, muestra hechos.
   - **Descomposición exacta:** `Importe − consumo cobrado = precio + redondeo + unidades`.
     - **Precio:** línea a línea, `cantidad × (ficha − precio cobrado)`, solo si difieren en medio
       centavo o más; se lista cada producto con su precio cobrado y el de la ficha.
     - **Redondeo:** el de cada línea al centavo, los precios congelados que difieren de la ficha en
       menos de medio centavo, las cantidades del Importe a la milésima frente al libro en crudo y
       el de los propios totales. Así las partes impresas suman la diferencia impresa.
     - **Unidades:** por mesa o venta y producto, `(libro del día − cobrado del día) × ficha`.
   - **Cada mesa o venta con descuadre sale con sus HECHOS, sin causa:**
     - **mesa:** libro y cobrado por producto, estado actual, cobros (día y unidades), consumo y
       anuladas del día (cuántas después del primer cobro y cuántas marca el control de integridad
       sin su línea), y sus movimientos en otros días;
     - **venta directa:** si la venta no está en este aparato, está anulada, es de otro día o de otra
       ubicación, y las líneas cobradas sin cantidad.
   - **Una mesa se lista aunque su importe sume 0**, y dos precios que se compensan también.
   - **Cuarta revisión: el redondeo no puede ser un saco residual.** Solo recoge restos acotados:
     medio centavo como mucho por línea o partida, más los totales. Todo lo demás tiene nombre y
     sus líneas:
     - **importe de línea distinto de cantidad × precio;**
     - **precio**, con el umbral sobre el importe de la línea y no por unidad;
     - **cantidades del libro con más de 3 decimales**, porque la columna Venta va a la milésima;
     - **cobrado de productos sin precio de ficha** en este aparato: no está en el catálogo, o tiene
       precio en divisa sin tasa vigente.

     El libro de un grupo se imprime en crudo, hasta la millonésima. Los hechos dicen «ventas netas
     de esta mesa en otros días», incluidos los días con neto 0, y dónde está el movimiento de una
     venta de otra ubicación.
   - **Quinta revisión: la línea se parte EXACTAMENTE contra la ficha sin redondear, sin
     umbral.** Con F = ficha tal cual (`priceOf`) y P = la ficha a 2 decimales que usa el Importe:
     `cantidad × P − importe de línea = cantidad × (P − F)` (ficha con más de 2 decimales)
     `+ cantidad × (F − precio cobrado)` (**precio**) `+ (cantidad × precio − importe)` (redondeo
     de la línea, o importe de línea distinto si pasa de medio centavo).

     Así 300 líneas pequeñas a unos centavos de la ficha son **precio**, no redondeo, y una ficha
     de 3 decimales cobrada exacta no es un «precio distinto». El redondeo imprime de cuántas
     partidas sale. «Sin tasa» exige precio en divisa: se inyecta `isForeignPriced`.
   - **Sexta revisión** (sin críticos ni importantes). Partes propias:
     - **líneas cobradas sin precio unitario**, frente a la ficha, sin adivinarles un precio;
     - **líneas cobradas sin cantidad**, que ya no se mezclan con los descuadres de unidades.

     «Sin tasa» se decide por la **tasa vigente** (`lacksRate`, inyectado), no por una ficha 0. La
     venta directa dice también **de qué día** es su movimiento, si no es el del reporte.
   - **«Sin explicar»** es una salvaguarda **aritmética**: las partes se definen de modo que sumen
     la diferencia, así que solo saltaría ante un fallo de coma flotante o de la propia lógica.
     **La veracidad de cada parte no la prueba esa línea**, sino las pruebas y el fuzz con generador
     independiente, que comprueban el valor de cada parte, el redondeo incluido.
   - Un día con solo redondeo dice «NO CUADRA solo por redondeo al centavo».
   - Con filtro de categoría, el cobrado total va rotulado «de las ventas completas, todas las
     categorías».
   - **Validado:**
     - fuzz de verdad conocida sobre todas las ramas, con y sin filtro: **0 errores en 28.500
       días**; los 6 controles negativos de mutación detectan;
     - los 6 respaldos reales cuadran, y los hechos impresos coinciden con los medidos
       directamente en el respaldo: `143f3098`, `180a7687` y `a4f37f9b`.

   *Lo que sigue es el historial de las versiones anteriores, con causas interpretadas; queda como
   registro.* Para las ventas no anuladas de ese día (`localDay`) cuya `sourceLocation` es la
   ubicación elegida:
   - **consumo cobrado** = suma de `items[].lineTotal`, a su precio congelado;
   - se compara con la suma de Importes del bloque y se imprime la diferencia;
   - aparte se imprime `cobrado total (totalBase) = consumo − descuentos (discountAmount) +
     servicio (serviceChargeAmount)`.
   - Causas detectables que se listan si hay diferencia. **Corregidas el 24-09-2026 tras generar el
     reporte real de Burger**, donde la heurística de «cambio de precio» daba una explicación
     engañosa y no nombraba las causas verdaderas:
     - **precio cobrado distinto del de la ficha**: alguna línea se cobró a un precio unitario
       distinto (antes bastaba cualquier cambio de precio, aunque no explicara nada);
     - **unidades anuladas después de cobrar** la mesa (el H1 de Burger: el libro las devolvió al
       stock y la venta sigue cobrada);
     - **movimiento de anulación sin su línea** (`atomicity.js`), en ese día y esa ubicación;
     - **mesas de medianoche** (consumo un día, cobro otro) y **mesas abiertas** hoy;
     - **ventas sin movimiento de stock** (control 4).
   - **Revisión final (24-09-2026): conciliación POR GRUPO, con importe.** Las causas de arriba
     se detectaban por presencia y podían nombrar una que no explicaba nada (C1: una mesa anulada
     días después sin cobrar salía como «cobrada otro día», y el −37.920 del día de su anulación
     quedaba sin causa). Ahora la diferencia se descompone en grupos —cada mesa y cada venta
     directa—: `(Venta del libro × precio de ficha) − cobrado` por grupo, cuya suma **es** la
     diferencia por construcción (el Importe total se acumula sin redondeo intermedio). A cada
     grupo se le asigna la causa de su **estado real**, con su importe; lo que no se pueda
     asignar sale como **«Sin explicar»**, que en los 4 respaldos reales vale **0 en todos** los
     días-ubicación. Para una **mesa cobrada el mismo día**: lo devuelto al stock después del
     cobro es «anulado después de cobrar»; el resto se juzga en **unidades** (consumo −
     anulaciones previas al cobro, frente a lo cobrado) y el **signo** decide: sobra consumo →
     «consumo registrado sin cobrar»; falta → primero las anulaciones huérfanas previas
     (anulación duplicada, mesa `180a7687`) y solo lo que no cubren, «cobrado más de lo que el
     libro registra consumido»; cero → precio. Se juzga el instante del cobro y no la marca
     de «huérfana», porque el detector empareja por instante y una anulación legítima sale
     huérfana si su línea quedó sellada con una hora posterior (mesa `143f3098`, 22-09 tarde).
   - **Auditoría previa a `main` (24-09-2026): tres causas falsas más, corregidas.**
     - **Redondeo (pesadas):** cada línea se cobra redondeada al centavo y el Importe no; los
       restos de menos de medio centavo por venta se descartaban y, acumulados, salían como
       «Sin explicar». Ahora ningún importe se descarta: esos restos son la causa **«redondeo al
       centavo»**, que además absorbe el redondeo de las causas impresas, así que **las causas
       impresas suman la diferencia impresa**. «Sin explicar» queda para lo que supere medio
       centavo sin asignar. Con fuerza bruta (20.000 días con pesadas): 0 «Sin explicar» ahora,
       5.439 antes.
     - **Cobro duplicado:** por pedido vale la **primera** venta viva; cualquier otra viva del
       mismo pedido es «cobro duplicado» por su importe, y el resto del grupo se juzga sin ella
       (antes salía «falta un movimiento de consumo» y mandaba a buscar filas perdidas).
     - **Consumo de otro día:** se busca solo en esta ubicación y categoría, y explica **su**
       parte (unidades × precio); el resto sigue el árbol normal (antes todo el resto iba a esa
       causa, y con filtro de categoría contaba la de otra categoría).
     - **Segunda revisión independiente: cuatro fallos más de esos arreglos, corregidos
       rediseñando la conciliación para que sea EXACTA por construcción.** Cada línea cobrada se
       descompone sin resto en **precio** (cantidad × (ficha − precio cobrado)), **redondeo**
       (cantidad × precio cobrado − importe de la línea) y **unidades** (del libro − cobradas) ×
       ficha, por grupo y producto. El precio y el redondeo salen de cada línea, así que ya no
       dependen de cuántas líneas tenga la venta; solo el descuadre de unidades se interpreta por
       el estado de la mesa. Toda causa con casos se imprime aunque sume 0 (dos cobros mal hechos
       que se compensan no desaparecen). **Cobro duplicado = el solape** de cada venta duplicada
       con la válida, por producto y cantidad; lo que la duplicada cobre de más es un cobro válido
       de lo agregado. Las mesas se examinan **aunque su diferencia sea 0**: una unidad sin cobrar
       compensada por otra de otro día ya no se esconde. Una comprobación interna exige que las
       partes de cada grupo sumen su diferencia; si no, sale «Sin explicar».
     - **Validado con un fuzz de VERDAD CONOCIDA** (escenarios generados a partir de los hechos,
       exigiendo cada causa con su importe exacto y ninguna falsa): 0 errores en 17.000 días con
       cuatro semillas, frente a 432 de 3.000 en la versión anterior. **No cubre** anulaciones
       huérfanas, ventas sin movimiento ni mesas sin cobro: esas ramas las cubren las pruebas y
       los respaldos reales.
     - **Sin corregir, anotado:** una venta anterior al almacén con ubicaciones (sin
       `sourceLocation`) puede salir como «venta sin movimiento» en el almacén y en su área. En
       los 6 respaldos reales no hay ninguna.
   - **La Venta de un día puede salir NEGATIVA**: una mesa anulada sin cobrar devuelve su consumo
     al stock el día de la anulación (Burger: +37.920 el 09-09 y −37.920 el 20-09). Es el libro
     tal cual; el control de dinero lo nombra.
   - Sin diferencia: «CUADRA». (Las fuentes estándar de jsPDF no tienen el carácter «✔».)
3. **Control de la caché**, al final del reporte. Para cada producto listado se compara la
   existencia actual según el libro (todo el historial, en esa ubicación) con
   `stockByLocation[location]`. Se listan las diferencias; sin ellas, «CUADRA (la caché coincide con
   el libro)». **No altera ninguna cifra del reporte.** Incluye también los productos de la
   categoría con caché en esa ubicación y **ningún** movimiento en ella: su libro es 0. Antes no se
   miraban y el control podía decir CUADRA sin haberlos visto.
4. **Control de integridad del libro.** Se reutiliza `findAtomicityBreaks` de `src/lib/atomicity.js`:
   si en el rango hay ventas sin su movimiento (`sale-sin-mov`) o anulaciones sin movimiento, se
   avisa con el número exacto. En ese aparato la Venta del libro sale corta, y el control de dinero
   lo mostrará.

## 5. Arquitectura

1. **`src/lib/dailySalesControl.js`**, puro, probado con node. Su función principal,
   `buildDailyControl(input)`, recibe `{ products, movements, sales, shifts, users, orders,
   priceChanges, location, categoryId, from, to, classify, priceOf, today }` y devuelve
   `{ days: [...], cacheCheck, integrity }`. No importa Dexie.
2. **`reportsService.js`**: una función **nueva al final**,
   `buildDailySalesControl({ from, to, location, categoryId, divisas })`, que:
   - lee las tablas con `toArray()`;
   - llama a `buildDailyControl` con `classify: ledgerKey` y `priceOf: (await baseValuer()).price`;
   - devuelve `{ title, subtitle, head, rows, filename, orientation: 'landscape' }` para
     `exportExcel` / `exportPdf`, con filas separadoras por día y las líneas de control.
   - **Las líneas de texto van A LO ANCHO** (`{ content, colSpan: 10 }`, que autoTable admite sin
     tocar `exportPdf`). Medido con las opciones reales: la columna Producto pasa de 136 mm a 60 mm
     y las celdas partidas en dos líneas, de 50 a 0. Para el Excel, `exportExcel` pasa las filas por
     `plainRows` (`src/lib/reportCells.js`), que convierte esa celda en su texto y deja **todo lo
     demás idéntico**: 12 reportes existentes salen byte a byte iguales (decisión del dueño, con
     control negativo).

   Ningún otro builder cambia.
3. **`ReportsScreen.jsx`**: una ficha en la categoría *Ventas* con **dos selectores** (ubicación y
   categoría). Usa el rango de fechas común y los botones Excel/PDF de siempre.
   - Ubicaciones ofrecidas: almacén, áreas configuradas, cocina y elaboración si procede, y **toda
     ubicación que aparezca en `stockMovements`** (para no esconder restos como el «Cocina»
     histórico de Burger).
   - Solo para mando: la pantalla ya lo exige.

## 6. Pruebas y verificación

1. **Suite pura `dailySalesControl.test.mjs`:**
   - cada tipo de movimiento va a su columna;
   - `order_void` descuenta la Venta;
   - un movimiento sin `location` cuenta en el almacén y no en un área;
   - cada fila cuadra y el inicio de un día es el final del anterior;
   - orden alfabético con ñ y tildes; filtro de categoría; los productos en cero no aparecen;
   - la cabecera sale de los turnos;
   - control de dinero: consumo, servicio, descuento, diferencia y causas;
   - la caché que difiere se lista, y la que coincide da «CUADRA»;
   - la integridad avisa.
   - Controles negativos en la regla de ubicación, en el signo de la venta y en el encadenado.
2. **Validación con respaldos reales** (`docs/auditoria/validar-control-ventas.mjs`, fuera del
   bundle), con Burger (A1 y A2 del 21 y 22-09) y La Patrona (A y B):
   - para cada producto, ubicación y día, el saldo final es igual al de un **segundo cálculo
     independiente** del libro;
   - los totales del período coinciden con **`buildProductsLedgerSummary`**, otro camino de código
     que ya existe;
   - La Patrona A avisa de las 8 ventas sin movimiento del 22-09, y B no.
3. **Invariantes:**
   - `src/db`, `src/features/sync` y las reglas sin cambios;
   - `reportsService.js` solo con altas;
   - build exit 0 y peso medido;
   - 0 identificadores sin definir;
   - revisión independiente antes de fusionar.

## 7. Lo que no se podrá garantizar

- Cómo se ve el PDF en el teléfono del cliente: no se abre aquí.
- **Si el aparato tiene el libro incompleto (H3), el reporte lo avisa pero no puede inventar las
  filas que faltan**: sus cifras son las del libro de **ese** aparato.
- Que los nombres de productos del papel existan en el sistema: «Tres leches» y «Javas» no
  aparecen en el respaldo de Burger.
