# Fase 7 — Módulo `cocina` (recetas y tablero de elaboración)

Plan de implementación **antes de tocar código** (Regla 4 y 5 del proyecto). Este documento
es la referencia única del módulo: qué es, qué se toca, qué NO se toca, casos borde,
degradación de licencia y plan de verificación. Todo es **aditivo, gateado y append-only**;
el comportamiento clásico queda **idéntico** sin la licencia.

> **Fase 7** en la secuencia del dueño (la Fase 6 fue el módulo `divisas`).
> Estado: **PLANEADO** (sin código todavía). Pendiente: luz verde del dueño para implementar.
> Rama de desarrollo confirmada: `claude/awesome-dirac-484azm` (nada a `main`).

---

## 1. Qué es

Un módulo para negocios con **cocina/producción** (cafetería, comida elaborada). El dueño
define **recetas** (qué insumos consume cada plato y en qué cantidad) y el **cocinero**, desde
un **tablero tipo mesas**, con **3 toques** elabora y envía el producto terminado a un área de
venta. Todo el movimiento (entrada de insumos, elaboración, salida al área) queda registrado
con su **análisis financiero**, y el tablero muestra **cuántas unidades de cada receta se pueden
elaborar** con el stock que hay en cocina (para pedir insumos a tiempo).

Es **independiente** del módulo `elaboracion` (no lo requiere ni lo toca).

---

## 2. Decisiones validadas con el dueño

1. **Cocina = ubicación fija propia + rol dedicado, independiente de `elaboracion`.**
   - Ubicación centinela reservada `__cocina` (como `__almacen` / `__elaboracion`, pero sin
     relación con esta última).
   - Rol nuevo **Cocinero**: **sin turno ni caja**. Solo opera el tablero de recetas. No ve el
     almacén, ni costos, ni datos del dueño (rol acotado, como `ELABORATION`).
   - **El dueño abastece** la cocina (salida almacén → `__cocina`).
   - **El cocinero produce y envía a cualquier área** de venta desde el tablero.

2. **La receta crea su propio producto** (el elaborado que se vende). Al definir la receta se
   captura precio de venta / unidad / foto y se **auto-da de alta** el producto en el catálogo,
   quedando ligado a la receta por `outputProductId`.

### Defaults tomados (el dueño puede vetar cualquiera)
- **D1 — Consumo por unidad:** la receta define el consumo para **1 unidad** del elaborado; el
  cocinero teclea cuántas unidades producir. (Alternativa no elegida: lotes con "rinde".)
- **D2 — Foto:** se guarda como foto del **propio producto elaborado** (`refType:'product'`);
  se ve siempre en el tablero, y también en Catálogo si está activo `imagenes`.
- **D3 — Destino:** el selector lista **todas** las áreas configuradas.
- **D4 — Abastecer:** vive en la pantalla de cocina del mando; **no** se modifica la pantalla
  clásica de "Salida a áreas".

---

## 3. Cumplimiento de reglas del proyecto

- **Rama única (Regla 1):** todo en la rama de desarrollo. **Nada a `main`** sin autorización.
- **No afectar producción (Regla 2):** todos los cambios son **aditivos**. No se modifica la
  lógica de `salesRepo`, `transfersRepo`, `conversionsRepo`, ni ninguna pantalla clásica en su
  comportamiento por defecto. Las tocadas solo **agregan** ramas gateadas por `hasModule`.
- **Gateado sin fugas (Regla 3):** todo detrás de `hasModule(LICENSE_MODULES.KITCHEN)`. El rol,
  los menús, el tablero, las pantallas y el reporte solo aparecen con la licencia desbloqueada.
- **Append-only (Regla 6):** recetas y producciones nunca se borran (baja lógica). Toda mutación
  actualiza su `updatedAt`/`createdAt` (de esto depende la sync).
- **Idioma español (Regla 7):** UI, comentarios y commits en español, imitando el estilo vecino.
- **Build limpio (Regla 8):** `npm run build` antes de cada commit. Sin imports pesados nuevos
  (xlsx/jspdf ya son dinámicos).
- **Commits por bloque, sin PR (Regla 9).**

---

## 4. Modelo de datos

### 4.1 Constantes nuevas — `src/db/constants.js`
```js
// Rol acotado de cocina (módulo 'cocina'). No abre turno ni maneja caja: solo
// opera el tablero de recetas (elaborar y enviar a áreas). No ve almacén ni costos.
ROLES.COOK = 'cook'
ROLE_LABELS[ROLES.COOK] = 'Cocinero'

// Ubicación fija de la cocina (centinela reservado, independiente del almacén y de
// elaboración). Guarda el stock de insumos entregados por el dueño.
export const COCINA = '__cocina'
export const COCINA_LABEL = 'Cocina'
```
`locationLabel(loc)` gana un caso: `if (loc === COCINA) return COCINA_LABEL`.

### 4.2 Módulo de licencia — `src/lib/license.js`
```js
LICENSE_MODULES.KITCHEN = 'cocina'
LICENSE_MODULE_LABELS.cocina = 'Cocina y recetas'
```

### 4.3 Dexie **v13** (migración aditiva: solo tablas vacías) — `src/db/db.js`
```js
db.version(13).stores({
  recipes: 'id, active, outputProductId, createdAt',
  productions: 'id, recipeId, toArea, byUserId, createdAt'
})
```
- **`recipes`** — receta definida por el dueño:
  `{ id, name, unit, outputProductId, items:[{ productId, qty }], normas, active, createdAt, updatedAt }`
  Los `items` viven como **array dentro del doc** (la edita **solo el dueño**, baja concurrencia
  → LWW por `updatedAt`, igual que `transfers`/`sales` guardan su `items`).
- **`productions`** — bitácora **append-only** de cada elaboración (snapshot para el reporte,
  como `mermas`/`purchases` acompañan al libro mayor):
  `{ id, recipeId, recipeName, units, toArea, ingredients:[{ productId, name, unit, qty, unitCostMN }], outputCostUnit, byUserId, createdAt }`

### 4.4 Movimientos del libro mayor: **se reutilizan, no se crean tipos nuevos**
La elaboración reúsa `CONVERSION_OUT/IN` y el envío reúsa `TRANSFER_OUT/IN`. El submayor/kardex
(`reportsService.ledgerKey`) **ya los clasifica** → **cero cambios** en reportes base. Se
confirma en implementación que `ledgerKey` cubre `conversion_*` y `transfer_*` (lo hace hoy para
mayorista y Bloque 20).

---

## 5. Rol Cocinero

- **`AuthProvider`** (`src/app/providers/AuthProvider.jsx`): flag derivado
  `isCook = user?.role === ROLES.COOK`. No entra en `isManager`.
- **Navegación:** el cocinero solo alcanza `/cocina` (y `/help`). El resto de rutas siguen
  gateadas por rol como hoy; su Home muestra únicamente el tablero de cocina.
- **Cambio de rol (Fase 8 B2):** `ASSIGNABLE_ROLES` gana `COOK`, pero **solo se ofrece en la UI
  cuando `hasModule('cocina')`** (sin fugas). `usersRepo.setRole` sigue con su doble candado
  OWNER (el dueño nunca es origen ni destino) y su bloqueo si el usuario tiene turno abierto.
- **Seguridad:** como el resto de roles, el rol autoritativo se relee de Dexie al montar
  (`AuthProvider` ya corrige manipulación de `sessionStorage`).

---

## 6. Flujos

### 6.1 Abastecer la cocina — el dueño/mando
Panel "Abastecer cocina" dentro de la pantalla de recetas del mando. Reúsa el motor de traspaso
**sin tocarlo**:
```js
transfersRepo.move({ fromLocation: WAREHOUSE, toLocation: COCINA, items, byUserId })
```
Genera `TRANSFER_OUT` (almacén) + `TRANSFER_IN` (`__cocina`). Es la **contrapartida** de los
productos entregados a la cocina (queda en el libro mayor y en el reporte de traspasos existente).

### 6.2 Definir recetas — el dueño (`/recetas`, solo dueño)
Formulario (imita `ProductForm` en estilo):
- Nombre del elaborado · **foto** · unidad · **precio de venta** · área/categoría opcional.
- **Insumos:** checklist del catálogo (buscador, como `TransferPanel`) + **cantidad por unidad**
  de cada insumo.
- **Normas de consumo** (texto libre).

Al guardar (`recipesRepo.create`):
1. `productsRepo.create({ name, unit, price, area, categoryId, cost: 0 })` → `outputProductId`
   (costo 0; el costo real se deriva al producir, por promedio ponderado).
2. `db.recipes.add({ ...receta, outputProductId })`.
3. Foto vía `imagesRepo.set('product', outputProductId, dataUrl)`.

Editar: nombre/precio/unidad → actualizan el producto (`productsRepo.update` / `changePrice` con
historial); insumos/normas → solo la receta. **Baja de receta = lógica** (`active:false`); el
producto y su historial **quedan** (append-only). Se reúsa el catálogo; **no** se reimplementa
alta de productos.

### 6.3 Tablero de cocina — el cocinero (`/cocina`, cocinero + mando)
Rejilla tipo `SalonScreen` (profesional):
- **Tarjeta por receta** con **foto**, nombre y **"Puedes elaborar: N"**.
- **3 toques:** tocar receta → hoja con **cantidad** + **área destino** → **"Elaborar y enviar"**.
- El cocinero **no ve costos ni márgenes** (alcance del rol). El mando sí.

### 6.4 Motor `kitchenRepo.produce()` — **una sola transacción atómica**
```js
produce({ recipeId, units, toArea, byUserId })
```
En una única `db.transaction('rw', ...)`:
1. **Valida** contra el libro mayor que `__cocina` tiene cada insumo (`qty × units`), sumando
   `stockMovements` por `[productId+location]` (candado de última instancia, como `salesRepo`).
   Si falta, aborta toda la transacción con mensaje claro (qué insumo y cuánto hay).
2. Por cada insumo: `CONVERSION_OUT` (−) en `__cocina` + actualiza su `stockByLocation`.
3. Elaborado: `CONVERSION_IN` (+ `units`) en `__cocina` (**"entrada con la creación"**),
   con costo unitario por **promedio ponderado** del valor de insumos consumidos.
4. Envío: `TRANSFER_OUT` (`__cocina`) + `TRANSFER_IN` (`toArea`) del elaborado
   (**"salida al área de ventas"**) + actualiza `stockByLocation`.
5. Snapshot en `productions`.

Repo nuevo y **aislado**; no toca `conversionsRepo`/`transfersRepo`/`salesRepo` (replica su
patrón de movimientos dentro de su propia transacción para garantizar atomicidad end-to-end).

### 6.5 "Cuántas puedo elaborar" (derivación, solo lectura)
Por receta: `N = mín. sobre insumos de ⌊ stockCocina(insumo) / consumoPorUnidad(insumo) ⌋`,
leyendo `product.stockByLocation['__cocina']`. Si un insumo falta o está en 0 → `N = 0`.

---

## 7. Análisis financiero

- **Costo de insumos en MN respetando `divisas`:** si un insumo tiene `priceCurrency` (p.ej.
  USD), su costo se **convierte a MN a la tasa vigente** antes de sumar (helper equivalente al
  `baseValuer` de reportes). Se hace bien **desde el inicio** — la conversión clásica
  (`conversionsRepo`) no lo contempla; se deja dicho con honestidad. Sin tasa y con insumo en
  divisa → **bloquea** con aviso "Falta tasa" (como el POS).
- **Costo del elaborado:** promedio ponderado del valor consumido / unidades (patrón existente).
  Se refleja en el `cost` del producto elaborado (para que el margen de venta salga correcto).
- **Margen final:** lo dan los **reportes de venta del área ya existentes** (el elaborado se
  vende como cualquier producto en su área).

---

## 8. Reportes

- **Nuevo builder `buildKitchenProduction({ from, to })`** en `reportsService.js` (solo lee,
  como el resto): fecha, receta, unidades, **costo de insumos**, **costo del elaborado**, área
  destino, con **totales**. Gateado.
- **Versión del cocinero** (opcional, dentro del tablero): producciones recientes **sin costos**
  (alcance del rol), como los reportes de elaboración ocultan costo/ganancia.
- Las **entradas de insumos** y las **salidas a áreas** ya aparecen en los reportes de traspasos
  y en el submayor por producto (kardex) sin cambios.

---

## 9. Sincronización

- `src/features/sync/collections.js`: se agregan **`recipes`** y **`productions`** a la lista de
  colecciones sincronizadas (con su `syncTs`). Las **fotos** viajan por la sync de imágenes
  existente. Migración aditiva; nada más cambia en el motor de sync (LWW por marca de tiempo).

---

## 10. Degradación de licencia (quitar `cocina`)

- Recetas y producciones **quedan** (append-only); desaparecen menús, tablero, rol asignable y
  el reporte.
- Los **productos elaborados y su stock** ya movido quedan **intactos** (son productos normales).
- El **libro mayor** sigue válido (los `conversion_*`/`transfer_*` ya clasificados no dependen
  del módulo). **Cero fugas** hacia otros módulos.

---

## 11. Archivos

### Nuevos
- `src/repositories/recipesRepo.js` — CRUD de recetas + auto-alta del producto elaborado.
- `src/repositories/kitchenRepo.js` — `produce()` (motor atómico), `abastecer()` (envoltura de
  traspaso a `__cocina`) y consultas ("cuántas puedo elaborar").
- `src/features/kitchen/RecipesScreen.jsx` — pantalla del dueño (definir recetas + abastecer).
- `src/features/kitchen/RecipeForm.jsx` — editor de una receta (insumos, cantidades, normas, foto).
- `src/features/kitchen/KitchenScreen.jsx` — tablero del cocinero (tarjetas + 3 toques).

### Tocados (solo agregan ramas gateadas; comportamiento por defecto idéntico)
- `src/lib/license.js` — módulo + label.
- `src/db/constants.js` — `ROLES.COOK`, label, `COCINA`/`COCINA_LABEL`, caso en `locationLabel`.
- `src/db/db.js` — versión 13 (`recipes`, `productions`).
- `src/app/providers/AuthProvider.jsx` — flag `isCook`.
- `src/app/router.jsx` — rutas `/recetas` y `/cocina`.
- `src/features/home/Home.jsx` — tarjetas gateadas (dueño: Recetas; cocinero/mando: Cocina).
- `src/features/auth/UsersAdmin.jsx` — `COOK` en roles asignables (gateado por módulo).
- `src/repositories/usersRepo.js` — aceptar `COOK` en `setRole` (manteniendo el candado OWNER).
- `src/features/reports/reportsService.js` — `buildKitchenProduction` (+ export).
- `src/features/reports/ReportsScreen.jsx` — tarjeta del reporte, gateada.
- `src/features/sync/collections.js` — `recipes`, `productions`.
- `CLAUDE.md` — documentar el módulo (al final, append-only).

---

## 12. Casos borde y validaciones (para no dejar nada suelto)

- Insumo insuficiente en `__cocina` → bloquea (qué insumo y cuánto hay).
- Insumo inactivo/eliminado del catálogo → el editor de receta avisa; `produce()` bloquea si no
  existe/está inactivo.
- Producto elaborado inactivo → `produce()` bloquea (o se reactiva desde el catálogo).
- `units ≤ 0`, receta sin insumos, área no seleccionada o sin áreas configuradas → bloquea con guía.
- **Divisas:** insumo en USD sin tasa vigente → bloquea ("Falta tasa"); con tasa, convierte a MN.
- **Concurrencia:** dos elaboraciones a la vez → `produce()` revalida contra el ledger **dentro
  de la transacción** (no confía solo en la caché), evitando sobre-consumir.
- **Sync:** editar la misma receta en dos dispositivos → LWW por `updatedAt` (aceptable: la
  define un solo dueño). Producciones nunca chocan (ids propios, append-only).
- **Auto-producto:** se crea **una sola vez** (al crear la receta); ediciones posteriores
  actualizan, no duplican.
- **Baja de receta:** no toca su producto ni su stock ni sus ventas (append-only).

---

## 13. Plan de verificación (código + build; no runtime del dueño)

1. `npm run build` limpio antes de cada commit.
2. **Pruebas headless** de los builders (patrón ya usado en el repo): agregar aserciones para
   `buildKitchenProduction` y **re-correr** las existentes para confirmar que, **con el módulo
   apagado**, los reportes clásicos quedan **byte-idénticos**.
3. **Auditoría manual** hunk por hunk de cada archivo tocado: confirmar que la rama nueva está
   **gateada** y que el camino por defecto no cambia.

### Lo que NO se puede garantizar (Regla 5)
- Validación por **código + build**, **no** por runtime en el dispositivo del dueño. El flujo
  real producir→enviar→vender, la migración v13 al abrir la BD y la impresión/tablero **no
  quedan probados en dispositivo** hasta que el dueño los pruebe.

---

## 14. Orden de implementación (commits por bloque, en la rama de desarrollo)

1. **Infra:** módulo de licencia, rol `COOK`, constantes `__cocina`, Dexie v13, flag `isCook`,
   colecciones de sync.
2. **Recetas:** `recipesRepo` + `RecipesScreen`/`RecipeForm` (definir receta + auto-producto) +
   panel "Abastecer cocina".
3. **Motor + tablero:** `kitchenRepo.produce()` + `KitchenScreen` (3 toques) + "cuántas puedo
   elaborar".
4. **Reportes:** `buildKitchenProduction` + tarjeta gateada en `ReportsScreen`.
5. **Navegación y roles:** `Home`, `router`, `UsersAdmin`/`usersRepo` (rol asignable gateado).
6. **Cierre:** `CLAUDE.md`, build limpio y pruebas headless.

Cada bloque: aditivo, gateado, build limpio, commit descriptivo en español.

---

## 15. Nota de rama (antes del primer commit)

`CLAUDE.md` fija la rama de desarrollo en **`claude/awesome-dirac-484azm`**, pero el entorno
asignó `claude/init-e9ku6f`. **No se commitea** hasta confirmar en cuál trabajar (por defecto se
sigue la regla del dueño: `claude/awesome-dirac-484azm`).
