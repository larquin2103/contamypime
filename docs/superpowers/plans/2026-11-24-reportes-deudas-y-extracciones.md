# Reportes de deudas internas y de extracciones de caja — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dos reportes nuevos de solo lectura en Reportes → *Turnos y caja*: «Deudas internas» (lista por fecha + resumen por deudor) y «Extracciones y retiros de caja» (extracciones del turno + retiros al cierre, totales por moneda).

**Architecture:** Toda la lógica en un módulo PURO nuevo, `src/lib/cashOutReports.js` (sin Dexie ni React, probado con node), con el patrón de `productSalesHistory.js`: una función `build*` que calcula y otra `*Report` que arma `{ title, subtitle, head, rows, filename, orientation }`. En `reportsService.js` solo se añaden dos builders finos AL FINAL que leen Dexie e inyectan etiquetas. `ReportsScreen.jsx` gana dos entradas en la categoría `turnos`.

**Tech Stack:** React 18 + Vite 6, Dexie, node puro para las pruebas (sin framework).

**Spec:** `docs/superpowers/specs/2026-11-24-reportes-deudas-y-extracciones-design.md` (aprobado por el dueño el 24-11-2026).

## Global Constraints

- Rama `claude/awesome-dirac-484azm` (base `cf3344f`). **Nada a `main`**, sin PR, sin push salvo que el dueño lo pida.
- **Solo lectura:** cero `.add/.put/.update/.delete/.bulkPut/.modify/.transaction(` en el código nuevo.
- **Cero cambios** en `src/db/`, `src/features/sync/`, `src/repositories/`, `firestore.rules`, `firestore.indexes.json`, `package*.json`, `vite.config.js`, `index.html`, `FinancesScreen.jsx`, `CashScreen.jsx`, `ShiftScreen.jsx`.
- En `reportsService.js`: solo líneas AÑADIDAS (imports ampliados en el sitio y funciones al final). Los reportes existentes quedan idénticos.
- Función **base**: sin `hasModule`. La columna Moneda de deudas, solo con `divisas` Y algún producto en divisa (data-driven).
- **Monedas nunca se suman entre sí** ni se convierten con la tasa.
- **Cantidades no se suman** entre productos en el resumen por deudor.
- Textos fijos (exactos): «Pendiente», «Saldada <fecha> · <método>», «(producto no encontrado)», «—», «Retiro al cierre de turno», «no se registra», «Extracción», «Retiro al cierre», «Resumen por deudor».
- Español en UI, comentarios y commits; imitar el estilo vecino; `npm run build` exit 0 antes de cada commit. Commits sin línea de coautoría (regla global del dueño).

## Review Focus

1. **Deuda de un producto con precio en USD y `divisas` APAGADO** → se rotula MN, sin columna Moneda (lo de siempre en la app). Prueba `D8`.
2. **Deuda llegada por traspaso JSON (`handoffService` hace `bulkPut` de `pendingDebts`) sin su movimiento del libro** → ubicación «—» y aviso al pie, sin romper. Prueba `D3`.
3. **Turno cerrado viejo sin `ownerWithdrawal`, o con todo en 0, o sin `closedAt`** → no genera fila ni error. Prueba `W2`.
4. **Importes guardados como texto** (`amount: '500'`, `ownerWithdrawal: { MN: '300' }`) → se tratan como número. Prueba `W4`.
5. **Día local:** una deuda a las 23:30 de Cuba cae en su día local, no en el UTC. El módulo recibe `dayOf` inyectado (`localDay` en la app); la validación con respaldos corre con `TZ=America/Havana`. Prueba `D1` (frontera del rango) + Task 3.

---

### Task 1: Módulo puro — deudas internas

**Files:**
- Create: `src/lib/cashOutReports.js`
- Create: `src/lib/cashOutReports.test.mjs`

**Interfaces:**
- Produces:
  - `buildDebts({ debts=[], movements=[], products={}, from='', to='', dayOf, userName=(id)=>'', locationName=(loc)=>'', divisas=false })` → `{ lines, byDebtor, totals, foreign, missingMovements }`
    - `lines[]` (más recientes primero): `{ at, product, unit, location, qty, value, currency, debtor, authorizedBy, registeredBy, settled, settledAt, settleMethod, note, settleNote }`
    - `byDebtor[]` (orden alfabético por nombre, `localeCompare(…, 'es')`): `{ debtor, count, byCurrency: { [cur]: { total, pending, settled } } }`
    - `totals`: `{ [cur]: number }` · `foreign`: boolean · `missingMovements`: número de deudas sin movimiento.
  - `debtsReport(result, { from='', to='', formatDateTime=(x)=>x, formatMoney=(v,c)=>`${v} ${c}`, settleLabel=(m)=>m||'' })` → objeto exportable con `title: 'Deudas internas'`, `filename: 'deudas_internas'`, `orientation: 'landscape'`.

- [ ] **Step 1: Capturar la línea base de las suites ANTES de tocar nada**

Corre las 42 suites con los comandos exactos de `CLAUDE.md` (sección «Pruebas») y guarda la salida de CADA una en `<scratch>/base/<nombre>.txt`, donde `<scratch>` = `C:\Users\larquin\AppData\Local\Temp\claude\ee183b6b09d202b8\8231c060-52c0-4c3f-af65-cb775bb2362c\scratchpad`.
Expected: 0 fallos en las 42.

- [ ] **Step 2: Escribir las pruebas que fallan (`cashOutReports.test.mjs`)**

Mismo arnés que `productSalesHistory.test.mjs` (`eq`/`ok`, contadores, `process.exit(fail ? 1 : 0)`, línea final `N OK / M fallos`). `dayOf = (iso) => iso.slice(0, 10)`. Productos: `A` Arroz kg MN, `B` Refresco u MN, `U` Ron u `priceCurrency:'USD'`. Casos:

```js
// D1 rango inclusivo por día local: deudas del 2026-11-01, -05, -10 con from '2026-11-05', to '2026-11-10' → 2 líneas; sin rango → 3
// D2 orden: lines[0].at es la más reciente
// D3 ubicación: movimiento {type:'internal_debt_out', refType:'internal_debt', refId:d.id, location:'Víveres'} → location 'L:Víveres' (locationName = l => 'L:'+l);
//    deuda sin movimiento → location '' y missingMovements === 1; en el reporte la celda es '—' y hay una fila de aviso que contiene '1 deuda'
// D4 producto inexistente → product '(producto no encontrado)', unit ''
// D5 authorizedBy '' → celda '—' en el reporte; 'Yuniel' → 'Yuniel'
// D6 estado: pendiente → 'Pendiente'; saldada {settledAt:'2026-11-07T10:00', settleMethod:'payroll', settleNote:'abril'}
//    con settleLabel = m => ({payroll:'Descontada del pago'}[m]) → 'Saldada 2026-11-07T10:00 · Descontada del pago'; nota 'x' → 'x · Saldo: abril'
// D7 resumen: Aylin 2 deudas (100 pendiente + 50 saldada), Beto 1 (30) → byDebtor = [{debtor:'Aylin',count:2,byCurrency:{MN:{total:150,pending:100,settled:50}}},{debtor:'Beto',...}]
//    y ninguna clave de cantidad en byDebtor
// D8 divisas=false con producto U → currency 'MN', foreign false, head SIN 'Moneda' (11 columnas)
// D9 divisas=true con U (valueAtTime 20) y B (valueAtTime 240) → foreign true, head con 'Moneda' tras 'Valor' (12), totals {MN:240, USD:20},
//    fila de aviso que contiene 'se deduce'; divisas=true SIN productos en divisa → head idéntico al de D8
// D10 total: totals.MN === round2(suma de valueAtTime de las líneas) y la fila 'TOTAL' del reporte lleva ese número
// D11 vacío → rows === [[{content:'Sin deudas internas en el periodo.', colSpan: head.length}]]
// D12 forma: toda fila que NO es de texto a lo ancho tiene length === head.length
// D13 'Resumen por deudor' aparece como fila de texto, y debajo una línea por deudor (y por moneda si foreign) con
//    formatMoney de total, pendiente y saldado
```

- [ ] **Step 3: Correr y ver el fallo**

Run: `node src/lib/cashOutReports.test.mjs`
Expected: falla al importar (`cashOutReports.js` no existe).

- [ ] **Step 4: Implementar `buildDebts` y `debtsReport` en `src/lib/cashOutReports.js`**

- Imports relativos con `.js` (`./currency.js` para `round2` e `isForeignPriced`), como `productSalesHistory.js`. Cabecera de comentario en español: qué responde, de dónde sale cada columna y qué NO se garantiza (moneda deducida).
- Movimiento de la deuda: el primero con `refId === d.id` (`refType === 'internal_debt'`). Valor: `round2(Number(d.valueAtTime || 0))`.
- `currency = divisas && isForeignPriced(product) ? product.priceCurrency : 'MN'`; `foreign` = alguna línea con currency ≠ 'MN'.
- Head: `['Fecha','Producto','Ubicación','Cantidad','U/M','Valor', ...(foreign?['Moneda']:[]), 'Deudor','Autorizó','Registró','Estado','Nota']`.
- Pie, en este orden: una fila `TOTAL` por moneda (columna Valor, y Moneda si foreign); aviso de moneda deducida (si foreign); aviso de deudas sin movimiento (si >0); fila de texto «Resumen por deudor» y sus líneas `<Deudor> — N deuda(s) · total X · pendiente Y · saldado Z`. Filas de texto como `[{ content, colSpan: head.length }]` (lo aplana `plainRows` en Excel).
- `subtitle`: el mismo formato de periodo que `productSalesReport` («Todo el periodo» / «Periodo: … a …»).

- [ ] **Step 5: Correr y ver pasar**

Run: `node src/lib/cashOutReports.test.mjs`
Expected: `… OK / 0 fallos`, exit 0.

- [ ] **Step 6: Build y commit**

Run: `npm run build` → exit 0.
```bash
git add src/lib/cashOutReports.js src/lib/cashOutReports.test.mjs
git commit -m "Reportes: modulo puro del reporte de deudas internas (lista por fecha y resumen por deudor)"
```

### Task 2: Módulo puro — extracciones y retiros de caja

**Files:**
- Modify: `src/lib/cashOutReports.js` (añadir al final)
- Modify: `src/lib/cashOutReports.test.mjs` (añadir casos W*)

**Interfaces:**
- Consumes: el arnés y los helpers de Task 1.
- Produces:
  - `buildWithdrawals({ cashMovements=[], shifts=[], from='', to='', dayOf, userName=(id)=>'', shiftLabel=(shift)=>'' })` → `{ lines, totals }`
    - `lines[]`: `{ at, kind: 'extraccion'|'retiro', shift, registeredBy, amount, currency, reason, authorizedBy }`, orden `at` descendente y, a igual `at`, `extraccion` antes que `retiro` y monedas en el orden de `ownerWithdrawal`.
    - `totals`: `{ extraccion: {cur:n}, retiro: {cur:n}, total: {cur:n} }`
  - `withdrawalsReport(result, { from='', to='', formatDateTime=(x)=>x })` → `title: 'Extracciones y retiros de caja'`, `filename: 'extracciones_caja'`, `orientation: 'landscape'`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
// W1 solo cashMovements con type 'withdrawal' (un type 'otro' se ignora); rango por createdAt
// W2 retiro: turno {closedAt:'2026-11-05T20:00', ownerWithdrawal:{MN:300, USD:0, MLC:0}, closedBy:'u2'} → 1 línea MN 300, kind 'retiro',
//    reason 'Retiro al cierre de turno', registeredBy userName('u2'); turno sin ownerWithdrawal, con todo 0, o sin closedAt → 0 líneas; rango por closedAt
// W3 en el reporte: retiro → Autorizó 'no se registra'; extracción con authorizedBy '' → '—'; Tipo 'Extracción' / 'Retiro al cierre'
// W4 textos numéricos: amount '500' y ownerWithdrawal {MN:'300'} → 500 y 300 (números)
// W5 totales sin convertir: extracción MN 500 + extracción USD 20 + retiro MN 300 →
//    totals = {extraccion:{MN:500,USD:20}, retiro:{MN:300}, total:{MN:800,USD:20}}; filas de pie 'Extracciones', 'Retiros al cierre', 'TOTAL' por moneda presente
// W6 orden descendente por fecha
// W7 shiftId sin turno conocido → celda Turno '—'
// W8 vacío → [[{content:'Sin extracciones ni retiros en el periodo.', colSpan: 8}]]
// W9 forma: filas de datos y de pie con length === head.length (8)
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `node src/lib/cashOutReports.test.mjs` → fallos W*, D* siguen en verde.

- [ ] **Step 3: Implementar `buildWithdrawals` y `withdrawalsReport`**

Head exacto: `['Fecha','Tipo','Turno','Registró','Monto','Moneda','Motivo','Autorizó']`. Registró del retiro = `closedBy || sellerId`. Importes con `round2(Number(x) || 0)`; una moneda de retiro solo entra si su importe es > 0.

- [ ] **Step 4: Correr y ver pasar**

Run: `node src/lib/cashOutReports.test.mjs` → `0 fallos`, exit 0.

- [ ] **Step 5: Build y commit**

```bash
npm run build
git add src/lib/cashOutReports.js src/lib/cashOutReports.test.mjs
git commit -m "Reportes: modulo puro del reporte de extracciones y retiros de caja"
```

### Task 3: Cablear los dos reportes y validar con los respaldos reales

**Files:**
- Modify: `src/features/reports/reportsService.js` (ampliar imports en el sitio; dos funciones al FINAL)
- Modify: `src/features/reports/ReportsScreen.jsx` (imports y dos items en la categoría `id: 'turnos'`)

**Interfaces:**
- Consumes: `buildDebts`, `debtsReport`, `buildWithdrawals`, `withdrawalsReport` (Tasks 1-2).
- Produces:
  - `buildInternalDebtsReport({ from = null, to = null, divisas = false } = {})`: lee `db.internalDebts.toArray()`, `db.stockMovements.where('type').equals(MOVEMENT_TYPES.INTERNAL_DEBT_OUT).toArray()` (índice `type`, sin barrer el libro), `userMap()`, `productMap()`. Inyecta `dayOf: localDay`, `locationName: locationLabel`, `formatDateTime`, `formatMoney`, `settleLabel: (m) => DEBT_SETTLE_LABELS[m] || m || ''`.
  - `buildCashWithdrawalsReport({ from = null, to = null } = {})`: lee `db.cashMovements.toArray()`, `db.shifts.toArray()`, `userMap()`. `shiftLabel` = `<vendedor> · <área>` con `areaLabel(s.area)`, como `buildShiftsReport`.
  - Items de `ReportsScreen` (al final de la categoría `turnos`, `range: true`, sin `show`):
    - `{ key: 'debts', title: 'Deudas internas', desc: 'Productos sacados como deuda: fecha, producto, cantidad, valor, deudor, quién autorizó y estado, con resumen por deudor', builder: buildInternalDebtsReport, range: true }`
    - `{ key: 'withdrawals', title: 'Extracciones y retiros de caja', desc: 'Dinero sacado de la caja: extracciones del turno (motivo y quién autorizó) y retiros al cierre, con totales por moneda', builder: buildCashWithdrawalsReport, range: true }`

- [ ] **Step 1: Implementar los dos builders y las dos entradas**

Comentario de cabecera de cada builder en el estilo vecino («Solo LEE. El cálculo vive en lib/cashOutReports.js…»). Si `DEBT_SETTLE_LABELS` no está importado, añadirlo a la línea de `constants` existente.

- [ ] **Step 2: Build**

Run: `npm run build` → exit 0.

- [ ] **Step 3: Validación contra los 8 respaldos reales (script fuera del repo)**

Script en `<scratch>/validar-cashout.mjs` (NO se commitea), corrido con `TZ=America/Havana`, sobre `C:\Users\larquin\Downloads\respaldo_mypicuadre_2026-*.json` (`b.tables`). Por respaldo, alimenta `buildDebts`/`buildWithdrawals` con las tablas (`dayOf` = día local real, `locationName` identidad) y compara contra un **recuento independiente** escrito aparte en el script:
- nº de líneas de deuda = nº de `internalDebts`; Σ valor = Σ `valueAtTime`; por deudor, Σ y nº coinciden;
- cada deuda: su ubicación = la del `stockMovements` con su `refId` (o `''` si no hay), y cuántas quedan sin movimiento;
- nº de líneas de extracción = nº de `cashMovements` `withdrawal`; nº de líneas de retiro = Σ por turno de monedas > 0 en `ownerWithdrawal`; totales por moneda coinciden;
- **control negativo:** alterar un `valueAtTime` y un `amount` en una copia en memoria hace fallar el cotejo.

Expected (perfil medido al planificar): 28 deudas, 8 extracciones MN, retiros en 61 turnos en total; 0 discrepancias; el control negativo detecta.

- [ ] **Step 4: Commit**

```bash
git add src/features/reports/reportsService.js src/features/reports/ReportsScreen.jsx
git commit -m "Reportes: deudas internas y extracciones/retiros de caja en Turnos y caja"
```

### Task 4: Auditoría de cierre y acta

**Files:**
- Modify: `CLAUDE.md` (sección «Reportes»: una viñeta por reporte; sección «Pruebas»: la suite nueva en el bucle de node directo y el recuento de suites/aserciones)

- [ ] **Step 1: Todas las suites, byte a byte contra la línea base**

Corre las 42 + `cashOutReports` (43). Las 42 preexistentes: salida idéntica a `<scratch>/base/` (`cmp` fichero a fichero), con **control negativo** (un byte añadido a una copia, detectado). Expected: 0 fallos, 42 idénticas.

- [ ] **Step 2: Ficheros sensibles y líneas borradas**

Run: `git diff --stat cf3344f HEAD -- src/db src/features/sync src/repositories firestore.rules firestore.indexes.json package.json package-lock.json vite.config.js index.html src/features/cash src/features/shifts` → **vacío**.
Run: `git diff cf3344f HEAD -- src ':!*.test.mjs' | grep '^-[^-]'` → solo sustituciones en el sitio de líneas de import (leerlas una a una).

- [ ] **Step 3: Cero escrituras y cero identificadores libres**

`grep -E "\.(add|put|bulkPut|update|delete|modify|bulkAdd)\(|\.transaction\("` sobre el diff de producción → 0 (los `Map/Set` en memoria se leen y se descartan uno a uno).
Identificadores libres con esbuild + acorn en `cashOutReports.js`, `reportsService.js`, `ReportsScreen.jsx` → 0, con control negativo (un `noExisteNunca()` inyectado en una copia se detecta).

- [ ] **Step 4: Mutaciones (control negativo de la suite)**

Una a una, sobre `cashOutReports.js` y revirtiendo con `git checkout --` tras cada una; cada mutación debe hacer fallar la suite:
1. ignorar `divisas` (siempre `isForeignPriced`) · 2. sumar las monedas en un solo total · 3. no filtrar `type === 'withdrawal'` · 4. incluir monedas de retiro con importe 0 · 5. orden ascendente · 6. emparejar el movimiento por `productId` en vez de `refId` · 7. «Autorizó» del retiro = nombre de quien cerró.

- [ ] **Step 5: Peso**

Construir `cf3344f` en un worktree aparte y la rama; comparar el chunk principal y el CSS con el **mismo** `gzip -9`. Anotar bytes crudos y gzip.

*`/help` no se toca:* el artículo `reportes-panel` de `helpContent.js` no enumera reportes, así que no hay lista que actualizar (verificado al planificar).

- [ ] **Step 6: Acta en `CLAUDE.md` y commit**

Viñetas en «Reportes» (qué muestra cada uno, de dónde sale, moneda deducida, «no se registra», validación con los 8 respaldos) y el recuento nuevo de suites/aserciones con la fecha. Declarar lo que NO se garantiza: nadie lo ha ejecutado en un dispositivo; moneda deducida; turnos viejos sin `ownerWithdrawal`.
```bash
npm run build
git add CLAUDE.md
git commit -m "Acta - reportes de deudas internas y de extracciones de caja"
```
Borrar `<scratch>/base`, el script de validación y el worktree de medición al terminar.
