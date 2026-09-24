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
2. **Control de dinero, al pie de cada día.** Para las ventas no anuladas de ese día (`localDay`)
   cuya `sourceLocation` es la ubicación elegida:
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
   - Sin diferencia: «CUADRA». (Las fuentes estándar de jsPDF no tienen el carácter «✔».)
3. **Control de la caché**, al final del reporte. Para cada producto listado se compara la
   existencia actual según el libro (todo el historial, en esa ubicación) con
   `stockByLocation[location]`. Se listan las diferencias; sin ellas, «CUADRA (la caché coincide con
   el libro)». **No altera ninguna cifra del reporte.**
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
   - la caché que difiere se lista, y la que coincide da «✔»;
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
