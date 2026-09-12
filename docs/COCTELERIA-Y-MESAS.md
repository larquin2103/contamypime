# Plan — Módulo `cocteleria`, elaboración con faltante y descuento por mesa

Plan de implementación **antes de tocar código** (reglas 4 y 5 del proyecto). Documento único de
referencia de estos tres bloques: qué es, qué se toca, qué **NO** se toca, evidencia leída en el
código, casos borde, degradación de licencia y verificación por fase. Todo **aditivo, gateado y
append-only**; sin la licencia nueva el comportamiento queda **idéntico al clásico**.

> Estado: **PLANEADO Y APROBADO POR EL DUEÑO** (11-09-2026). Sin código todavía.
> Rama de desarrollo: `claude/awesome-dirac-484azm`. **Nada a `main`** sin autorización explícita.
> Origen: petición de un cliente con **cocina central** que envía platos a *Terraza* y
> *Restaurante*, y que además necesita **elaborar coctelería en cada una de esas áreas**.

---

## 1. Qué se va a construir (tres bloques independientes)

**Bloque A — Módulo de licencia `cocteleria`.** Un tablero **propio** de recetas de coctelería,
por área. El vendedor (o el mando) elabora un trago consumiendo los insumos **del área de su
turno** y el trago queda **en esa misma área**, listo para venderse por mesas o por el POS. Es
tablero **separado** del de cocina: cada uno lista solo lo suyo, para que nadie confunda un plato
con un trago.

**Bloque B — Permiso de elaborar con faltante + aviso de saldos negativos.** Un permiso en
Ajustes que convierte el candado de existencia en un **aviso** (para cuando la mercancía está
físicamente pero falta registrar su entrada), con la advertencia del descubierto en el tablero y
un **aviso al dueño** en el centro de notificaciones.

**Bloque C — Descuento por mesa + gastos del día en el panel del dueño.** El dueño o el
administrativo aplican un **% de descuento** a la cuenta de una mesa, el salón lo **avisa**
mientras está activo y se puede **retirar**. El panel del dueño refleja el **valor real** (con el
descuento descontado) y suma una tarjeta de **gastos del día** (costo de lo vendido).

Los tres bloques son independientes entre sí: se pueden implementar, verificar y desplegar en
cualquier orden. Se ejecutan en el orden A → B → C porque B extiende el motor que A parametriza.

---

## 2. Decisiones cerradas con el dueño (11-09-2026)

1. **Módulo de licencia NUEVO `cocteleria`, independiente de `cocina`.** No exige `cocina`: un bar
   sin cocina central puede comprar solo coctelería. Este cliente compra **los dos**.
2. **El coctel se elabora en la MISMA área.** Los insumos llegan al área por el **traspaso normal**
   (Almacén → Terraza, sin cambios en `transfersRepo`); el tablero del área consume de ella y deja
   el coctel en ella. **Sin traspaso** en la elaboración.
3. **Defaults de los dos interruptores de Ajustes:** `sellerKitchenBoard` **ACTIVADO** (un negocio
   que hoy usa `cocina` no nota ningún cambio — regla 2 al pie) y `sellerCocktailBoard`
   **APAGADO** (función nueva, la enciende el dueño).
4. **Un solo interruptor global de coctelería**, no por área. El filtro real lo pone el stock: un
   área sin insumos muestra todas las recetas en *"Puedes elaborar: 0"*. El **cocinero NO** ve el
   tablero de coctelería.
5. **Un solo permiso de faltante (`allowShortProduction`), para los dos tableros**, apagado por
   defecto. Es el mismo motor; separarlos sería duplicar un ajuste sin necesidad.
6. **La alerta de negativos va en dos sitios:** en el **tablero, al elaborar** (donde se crea el
   problema) y como **aviso al dueño** en el centro de notificaciones. **No** se añade aviso en la
   entrada de mercancía ni marca en el catálogo (descartados por el dueño).
7. **El descuento se calcula sobre el consumo, antes del servicio:**
   `descuento = subtotal × %`; `servicio = (subtotal − descuento) × %servicio`;
   `total = subtotal − descuento + servicio`.
8. **Autorización del descuento:** el mando (dueño o administrativo) lo aplica y lo retira
   directo; el **vendedor** puede hacerlo con el **PIN de un mando** vía `OwnerAuthModal` — el
   patrón exacto de *"Eximir servicio"*. Cada activación **y cada retiro** quedan en Auditoría.
9. **El panel del dueño debe mostrar el valor REAL con el descuento** — "que no se falseen las
   ventas ni los estimados". Se resuelve **prorrateando** el descuento entre las líneas de la
   venta (§8.2), para que total, por producto, por categoría y por área queden **coherentes entre
   sí**. No hay parte del panel que quede en bruto.
10. **El panel suma una tarjeta de gastos del día** = costo de los productos vendidos.

---

## 3. Cumplimiento de las reglas del proyecto

| Regla | Cómo se cumple |
|---|---|
| 1. Rama única | Todo en `claude/awesome-dirac-484azm`. Nada a `main`. |
| 2. No afectar producción | Cada cambio es una rama nueva gateada o un parámetro con **default = conducta de hoy** (`kind` ausente = cocina, `location = COCINA`, `discountPct = 0`, `allowShort = false`). |
| 3. Gateado por licencia, sin fugas | Todo lo de coctelería cuelga de `hasModule('cocteleria')`, **gateado en la consulta** (no solo en el render), incluida la **ayuda** (`helpContent.js` con su campo `module`). |
| 4. Preguntar antes de programar | Ocho decisiones consultadas y cerradas (§2) antes de escribir una línea. |
| 5. Auditoría y honestidad | §12 lista lo que **no** se puede garantizar. Cada fase cierra con verificación declarada. |
| 6. Append-only | El descuento se retira con **evento propio** (no se borra el anterior); `productions.shortages` es snapshot; nada se elimina. |
| 7. Español y estilo vecino | Nombres, comentarios, UI y commits en español; se imita `kitchenRepo`/`ordersRepo`. |
| 8. Build limpio | `npm run build` exit 0 antes de **cada** commit. Sin importaciones pesadas nuevas. |
| 9. Commits por bloque | Un commit descriptivo por fase. **Sin Pull Requests.** |

---

## 4. Modelo de datos — **CERO versiones nuevas de Dexie**

Es el hallazgo más importante de la exploración y conviene no perderlo de vista: **este plan
completo no necesita subir el esquema**. Evidencia (`src/db/db.js:150-151`):

```
recipes:     'id, active, outputProductId, createdAt'
productions: 'id, recipeId, toArea, byUserId, createdAt'
```

Todo lo que hace falta son **campos opcionales sin índice**, el patrón ya usado por `sales.area` y
`products.priceCurrency`:

| Tabla | Campos nuevos (sin índice) | Sentido |
|---|---|---|
| `recipes` | `kind` | `'cocteleria'`, o **ausente/`'cocina'`** = receta de cocina (compatibilidad hacia atrás sin migrar nada). |
| `productions` | `kind`, `fromLocation`, `shortages[]` | Tipo de elaboración, ubicación de origen y el descubierto con que se elaboró. |
| `orders` | `discountPct`, `discountBy`, `discountAt`, `discountNote`, `discountRemovedBy`, `discountRemovedAt` | Descuento vivo de la mesa (lo lee el salón y viaja por la sync). |
| `sales` | `discountPct`, `discountAmount`, `discountBy` | Snapshot congelado del descuento cobrado. |

**Consecuencia práctica:** no se repite el problema de v15–v19. El despliegue de este plan **no es
de ida**: `backupService.js:86` rechaza restaurar un respaldo cuyo `meta.schema` supere al de la
app, y aquí `db.verno` **no cambia**, así que un build anterior sigue abriendo la base. (Tomar
respaldo antes de desplegar sigue siendo buena práctica, pero deja de ser el único plan de
retroceso.)

Ajustes nuevos en `config` (que **ya** sincroniza, y ninguno entra en `LOCAL_CONFIG_KEYS`):

| Clave | Default | Quién la ve |
|---|---|---|
| `sellerKitchenBoard` | `true` | Solo con `cocina` |
| `sellerCocktailBoard` | `false` | Solo con `cocteleria` |
| `allowShortProduction` | `false` | Con `cocina` o `cocteleria` |

---

## 5. Bloque A — Módulo `cocteleria`

### 5.1 Licencia — `src/lib/license.js`

```js
COCKTAILS: 'cocteleria'   // en LICENSE_MODULES
cocteleria: 'Coctelería'  // en LICENSE_MODULE_LABELS
```

Sin el campo `modulos` en la licencia → ningún módulo, como hoy. No se puede autoactivar (la
licencia va firmada).

### 5.2 Tipo de receta — `recipesRepo`

- `recipes.kind`: `'cocteleria'` o ausente (= cocina).
- `list({ kind } = {})` y `listActive({ kind } = {})`: **sin argumento devuelven lo mismo que hoy**
  (todas). El filtro lo aplica cada pantalla, de forma explícita, para que no haya un default
  silencioso que cambie una lista existente.
- `create(...)` acepta `kind` (default cocina). `update(...)` **no** permite cambiar el tipo de una
  receta ya creada: cambiar el tipo movería la ubicación de la que consume y dejaría su histórico
  sin sentido. Si hace falta, se da de baja y se crea otra (append-only).

### 5.3 Motor — `src/repositories/kitchenRepo.js`

Dos firmas se parametrizan **con default igual a hoy**:

```js
canMake(recipe, productById, location = COCINA)
produce({ recipeId, units, toArea, byUserId, fromLocation = COCINA, allowShort = false })
```

- La validación sigue siendo contra el **LIBRO MAYOR** (`[productId+location]`), candado de última
  instancia como en `salesRepo`; lo único que cambia es **qué ubicación** se consulta.
- Los `CONVERSION_OUT` (insumos) y el `CONVERSION_IN` (coctel) se escriben en `fromLocation`.
- **Si `fromLocation === toArea`, NO se emiten `TRANSFER_OUT`/`TRANSFER_IN`.** Emitirlos sería neto
  cero, pero ensuciaría el submayor con traspasos que nunca ocurrieron. Neto resultante: el área
  baja sus insumos y sube `+u` del coctel; el total del producto sube `+u`. Idéntico invariante al
  de cocina, con un movimiento menos.
- El **costo por promedio ponderado** y el tratamiento de insumos en divisa (a la tasa vigente; sin
  tasa **bloquea**) quedan **exactamente como están**: no se toca esa aritmética.
- `productions` guarda `kind` y `fromLocation` además de lo de hoy.

### 5.4 Tablero `/cocteleria`

- **Se reutiliza `KitchenScreen`** con una prop de tipo; **no se duplica la pantalla** (200 líneas
  que habría que mantener dos veces). Ruta nueva en `router.jsx`, junto a `/cocina`.
- Gate: `hasModule('cocteleria')` **y** rol (mando, o vendedor con el interruptor encendido).
- **Ubicación de trabajo:** el vendedor elabora en el **área de su turno abierto**
  (`shiftsRepo.getActiveFor`); **sin turno no puede elaborar** — coherente con la regla de oro de
  que solo el vendedor con su turno abierto opera su área. El mando **elige** el área.
- `/cocina` pasa a listar **solo** recetas que no son de coctelería. Es *data-driven*: sin el
  módulo no existe ninguna receta de coctelería, así que ese tablero sale **idéntico**.
- El texto de cada tablero nombra su ubicación real ("Se descuentan los insumos de **Terraza**")
  para que el vendedor sepa de dónde sale lo que gasta.

### 5.5 Recetas y abastecimiento

- `RecipesScreen` se gatea con `cocina || cocteleria` y separa las dos listas.
- El panel **"Abastecer cocina" sigue gateado solo por `cocina`** (un bar sin cocina central no
  tiene `__cocina` que abastecer). **No hace falta tocar su exclusión de elaborados:**
  `RecipesScreen.jsx:67` ya excluye *todos* los `outputProductId`, así que un coctel nunca se
  ofrecerá como insumo a abastecer.
- La coctelería **no tiene pantalla de abastecimiento propia**: se abastece con la **Salida a
  áreas** que ya existe (`TransferScreen`, cero cambios).
- `RecipeForm` gana el selector *"Tipo de receta"*, gateado por el módulo — igual que hoy gatea la
  foto (`imagenes`) y la moneda (`divisas`).

### 5.6 Home, Layout y ayuda

- Tarjeta *"Tablero de coctelería"* en el Home del mando y en el del vendedor (gateada por módulo
  **y** por el interruptor). El cocinero y el mensajero no la ven.
- Artículo nuevo en `helpContent.js` con `module: 'cocteleria'` (se filtra en la pantalla **y** en
  el PDF, que si no la colaría).

### 5.7 Reportes y auditoría

- El reporte **Producción de cocina** pasa a aceptar las dos, con **columna "Tipo"** y gate
  `cocina || cocteleria`. Sin fuga: un negocio que solo tiene `cocteleria` no puede tener
  producciones de cocina (no existen recetas de cocina sin ese módulo), así que **no ve filas
  ajenas** — el mismo argumento *data-driven* que ya se usa para `remesas` en cuentas.
- La pestaña **Cocina** de `/auditoria` recibe el mismo tratamiento (gate por cualquiera de los
  dos, con el tipo visible en cada fila).
- El reporte sigue **sin precio ni ganancia** (alcance del rol), solo costo de insumos.

---

## 6. Bloque B — Elaborar con faltante y aviso de negativos

### 6.1 El permiso

`allowShortProduction` vive en **su propia tarjeta de Ajustes, *Tableros de elaboración***, junto a
los dos interruptores del Bloque A y gateada por `cocina || cocteleria` (no va en *Permisos del
vendedor*, porque también afecta al **cocinero** y al **mando**, que no son el vendedor).
**Apagado por defecto.** Con él, `produce` deja de lanzar por existencia insuficiente y
**acumula el descubierto**. Sin él, **el comportamiento es exactamente el de hoy**.

Lo que el permiso **no** cambia: la validación de que el insumo exista y esté activo, la de la
tasa de divisa, el candado del elaborado, y el hecho de que todo siga siendo una sola transacción.

### 6.2 Qué queda registrado

`productions.shortages = [{ productId, name, unit, need, have, short }]`. Es un snapshot
append-only (como `mermas`): deja constancia de con cuánto descubierto se elaboró y quién lo hizo.

### 6.3 El aviso en el tablero (donde se crea el problema)

- La tarjeta de la receta marca en rojo el insumo en descubierto.
- El modal de elaboración **exige confirmación explícita** con el detalle: *"Vas a elaborar con
  faltante: quedará −3 de Ron en Terraza"*. Sin el permiso, el mensaje de bloqueo de hoy no cambia.

### 6.4 El aviso al dueño (centro de notificaciones, Fase 9)

- Tipo nuevo `negative_stock` con su categoría (interruptor propio en `NotificationSettings`).
- **Se deriva del EVENTO, no del estado:** candidato = registro de `productions` posterior al piso
  del barrido **con `shortages` no vacío**, leído por índice `createdAt` como el resto
  (`notificationService.js:391` en adelante). Id determinista `negstock:<produccion>` +
  `addIfAbsent` → re-examinar la ventana no duplica ni revive un aviso leído. Derivar del estado
  (barrer todos los productos) no encaja en ese motor, que está construido para eventos con cursor.
- Es **local del dispositivo del dueño** (la tabla `notifications` no está en `SYNC_COLLECTIONS`):
  no aterriza en el teléfono del vendedor y no cuesta lecturas de Firestore.
- Costo declarado: **una lectura por índice más** en cada barrido del dueño. Sin los módulos,
  `productions` está vacía → consulta vacía.

### 6.5 Cómo se cura un descubierto (verificado en código, va a la ayuda)

- **Traspaso Almacén → Área:** lo netea. `transfersRepo.js:85-87` hace
  `byLoc[to] = round2(prev + qty)` **sin recortar a cero**.
- **Conteo físico del área:** lo netea. `countsRepo` calcula `diff = phys − sysNow`; con `sysNow`
  negativo el ajuste sale **positivo** y iguala el stock al real contado.
- **Entrada de mercancía:** netea **la ubicación a la que entra**. `purchasesRepo.create` hace
  `byLoc[loc] = cleanQty(prev + qty)`, sin `Math.max(0, …)` en ningún punto del camino, y el
  `recomputeStock` del `pullEngine` (`pullEngine.js:49-73`) re-deriva del libro mayor **admitiendo
  negativos**. **Aviso honesto: la entrada por defecto va al ALMACÉN** (`location = WAREHOUSE`),
  así que **no cura por sí sola un negativo del ÁREA**: hace falta el traspaso posterior (o que el
  vendedor con permiso `sellerEntries` entre directo a su área). Esto se explica en la ayuda tal
  cual, porque es la confusión probable.

---

## 7. Bloque C — Descuento por mesa

### 7.1 Diferencia real frente a *"Eximir servicio"* (leída en código)

El "eximir" de hoy **no se guarda** en el pedido: es `useState` en `TableScreen` y solo viaja a la
venta al cobrar (`serviceWaivedBy`). El descuento **sí tiene que persistir**, porque el salón debe
avisarlo y porque lo puede poner un equipo y cobrarlo otro. Por eso vive en la **cabecera del
pedido** y se sella con el `stampOrder` (`tsAfter`) que ya existe en `ordersRepo` — el mismo que
evita que una mesa cobrada reaparezca abierta cuando los relojes de dos teléfonos no coinciden.

### 7.2 `ordersRepo`

```js
totals(orderId, { servicePct = 0, waived = false, discountPct = 0 })
setDiscount({ orderId, pct, userId, note })
clearDiscount({ orderId, userId, note })
```

- `subtotal` = suma de líneas vivas (igual que hoy) → `discount = subtotal × pct/100` →
  `service = (subtotal − discount) × servicePct/100` → `total = subtotal − discount + service`.
  **Con `discountPct = 0` la salida es idéntica a la de hoy**, campo por campo.
- Solo se puede aplicar/retirar con el pedido **abierto** (mismo candado que `addItem`).
- `pct` acotado a `0…100`.
- Cada operación escribe en `auditEvents` con `entity: 'order'` (`order_discount` /
  `order_discount_removed`, con el % , la mesa y el autorizante). **No choca con nada:** el único
  lector de esa tabla en el catálogo filtra `entity === 'product'` (`productsRepo.js:121`).

### 7.3 `TableScreen`

- Fila de **Descuento** junto a la de servicio, con el % y botón de aplicar/retirar.
- Mando: directo. Vendedor: `OwnerAuthModal` (PIN de un mando presente), copiando el flujo de
  *Eximir* (`TableScreen.jsx:801-806`).
- El **ticket térmico 58 mm** gana su línea de descuento, entre subtotal y servicio.

### 7.4 `SalonScreen`

- Distintivo **"−15 %"** en la tarjeta de la mesa mientras el descuento esté activo.
- Aviso arriba con el conteo de mesas con descuento activo, para que el mando lo vea de un golpe
  sin entrar a cada mesa.

### 7.5 `salesRepo.create`

Tres parámetros nuevos **opcionales con default 0/null**: `discountPct`, `discountAmount`,
`discountBy`. `totalBase` **ya llega calculado desde la pantalla** (`salesRepo` no lo re-deriva de
las líneas), así que el cobro, el vuelto, el pago mixto y el cuadre de caja (`shiftsRepo` suma por
`cashAmount`/`payments`) **cuadran con lo realmente cobrado** sin tocar nada de eso.

### 7.6 Reporte *Ventas por mesa*

Columna **Descuento** entre *Consumo* y *Serv.%*, *data-driven*: solo aparece si en el rango hay
alguna venta con descuento. Sin descuentos, el reporte sale **idéntico**.

---

## 8. Panel del dueño — valor real y gastos del día

### 8.1 El problema medido (no supuesto)

`analyticsRepo.report` calcula `revenue`, `cost`, `profit`, `byProduct`, `byCategory` y `byArea`
**sumando `lineTotal` línea por línea** (`analyticsRepo.js:40-46` y `:90-98`), mientras que la
**serie diaria** y el **donut de métodos de pago** usan `s.totalBase` (`:121-136`). Es decir: un
descuento de cabecera bajaría el gráfico de tendencia (correcto, `totalBase` ya viene descontado)
pero **no** bajaría "Ventas netas" ni la ganancia. Se falsearían las ventas y los estimados, que
es justo lo que el dueño no quiere.

*(Nota de contexto: esa divergencia ya existe hoy por el cargo por servicio, que suma a
`totalBase` y no a las líneas. Este plan **no** cambia el tratamiento del servicio: lo deja como
está y lo deja anotado como deuda preexistente, para no ampliar el alcance sin pedirlo.)*

### 8.2 La corrección: prorrateo del descuento entre las líneas

Por cada venta, antes de agregar: `subtotalVenta` = suma de `lineTotal` de sus líneas;
`disc = Number(s.discountAmount || 0)`. Cada línea aporta

```
lineRevNeto = lineRev − disc × (lineRev / subtotalVenta)
```

y el costo **no se toca** (el costo de la mercancía no baja porque se regale parte del precio).
Con esto `revenue`, `profit`, `marginPct`, `byProduct`, `byCategory` y `byArea` quedan **todos
netos y coherentes entre sí**, y coherentes con la tendencia y el donut, que ya usaban
`totalBase`. Guardas: si `disc <= 0` o `subtotalVenta <= 0`, el factor es 1 → **la aritmética es
byte a byte la de hoy**, así que un negocio sin descuentos (o sin el módulo `mesas`) no ve ningún
cambio. Es el criterio contable estándar y el único que mantiene la suma de las partes igual al
total.

### 8.3 Gastos del día (tarjeta nueva)

`report.cost` **ya se calcula y ya se devuelve** (`analyticsRepo.js:53` y `:151`) — **y la pantalla
no lo muestra**. Así que esto es puramente presentación:

- Tercera tarjeta en el `stat-grid`: **"Gastos (costo de lo vendido)"** con `m(report.cost)`.
- Respeta el selector de rango que ya existe (Hoy / 7 / 30 / personalizado): con *Hoy* son los
  gastos del día, que es lo pedido.
- **Detalle a no pasar por alto:** `DeltaBadge` (`DashboardScreen.jsx:75-83`) pinta el alza en
  verde. En un **gasto**, subir **no** es bueno. Se le añade una prop opcional `invert` (default
  `false`, con lo que las dos tarjetas actuales quedan idénticas) para que la flecha de gastos
  coloree al revés.
- Es **solo del mando**: la pantalla ya está gateada por `isManager`, y ni el vendedor ni el
  cocinero ven costos.

---

## 9. Sincronización — por qué esto no la rompe

- **Ninguna colección nueva.** `SYNC_COLLECTIONS` se queda en **34**: cero `onSnapshot` nuevos,
  cero lecturas extra por enganche en frío. Va en la dirección de `docs/SYNC-LECTURAS.md`, no
  contra ella.
- **Ningún cambio de forma con consumidores ajenos.** Los campos nuevos son opcionales y aditivos;
  ningún lector existente los necesita (a diferencia de lo que pasó con `accountsRepo.byConcept`).
- **`recipes`** sigue fusionando por LWW de documento entero. Es correcto aquí: la receta la edita
  **el mando**, desde una pantalla, y sus `items` ya viven como array dentro del documento (a
  diferencia de la ficha de costo, que la llenan dos mandos a la vez — de ahí H3). El `kind` no
  cambia esa realidad. **Si algún día dos mandos editan recetas simultáneamente**, aplica el mismo
  remedio de H3 (filas sueltas), pero hoy no hay evidencia de ese uso.
- **`productions`** es append-only con id propio: se fusiona sin conflicto, como hoy.
- **`orders`**: el descuento entra en la **cabecera**, que ya se fusiona por LWW **con `tsAfter`**.
  Riesgo conocido y aceptado, idéntico al que ya tiene `status`: si dos equipos tocan la misma mesa
  en el mismo segundo, gana el último; el `tsAfter` garantiza que la mutación no nazca *por debajo*
  de la versión que reemplaza (que es el fallo que rompió las entregas y las mesas).
- **El stock sigue derivándose del libro mayor.** Los `CONVERSION_*` de coctelería son movimientos
  normales: el `recomputeStock` del `pullEngine` los recalcula igual en cada dispositivo, y
  `ledgerKey` ya clasifica esos tipos, así que **el submayor de un negocio sin el módulo sale
  idéntico**.
- **`firestore.rules`** usa comodín `{document=**}`: **no hay que redesplegar reglas.**
- **`config`**: los tres ajustes nuevos viajan como cualquier otra clave (no entran en
  `LOCAL_CONFIG_KEYS`), así que el dueño los enciende una vez y llegan a todos los dispositivos.

---

## 10. Degradación de licencia (quitar `cocteleria`)

Nada se borra (append-only):

- Las recetas de coctelería **quedan** en la tabla, y sus cocteles **quedan** en el catálogo con su
  stock y su historial de ventas. Simplemente **deja de ofrecerse** el tablero, la tarjeta del
  Home, el selector de tipo, el interruptor de Ajustes, el artículo de ayuda y el filtro del
  reporte.
- **Las producciones de coctelería ya hechas dejan de listarse** en el reporte y en la auditoría
  (a diferencia de las filas de `remesas` en cuentas, que sí se conservan a la vista por decisión
  expresa del dueño: allí había dinero que entró y salió de las cuentas y ocultarlo descuadraba la
  suma). Aquí no hay dinero de cuentas involucrado y el inventario ya está reflejado en el libro
  mayor, así que ocultar el reporte no descuadra nada.
- Un vendedor que estuviera usando el tablero simplemente deja de verlo; **no queda ningún rol
  huérfano** (coctelería **no** crea un rol nuevo, a diferencia de `cocina`/`remesas`).
- Los bloques **B** y **C** no dependen de `cocteleria`: el permiso de faltante sigue aplicando al
  tablero de cocina, y el descuento de mesa cuelga de `mesas`.

---

## 11. Fases, commits y verificación

Cada fase: código → `npm run build` **exit 0** → pruebas node de lo puro → **un commit
descriptivo en español** en `claude/awesome-dirac-484azm`. **Sin Pull Requests.** Al final de cada
bloque, una auditoría escrita en este documento (fugas de licencia gateadas **en la consulta**,
y qué queda idéntico al clásico).

### Bloque A — Módulo `cocteleria`

| Fase | Alcance | Verificación |
|---|---|---|
| **A1** | `LICENSE_MODULES.COCKTAILS` + etiqueta; `recipes.kind`; `recipesRepo.list/listActive/create` con `kind` opcional; `RecipesScreen` gateada por `cocina \|\| cocteleria` con las dos listas; selector de tipo en `RecipeForm`. | Build. Sin el módulo: la pantalla de recetas sale idéntica (ningún registro trae `kind`). |
| **A2** | Motor: `canMake(..., location)` y `produce({ fromLocation, toArea })` con la rama `from === to` sin traspasos; `productions.kind/fromLocation`. | Build + **prueba node nueva** de `canMake` por ubicación (es pura, como `custodyMath`) + prueba del motor con `fake-indexeddb` (precedente: la migración v17→v19) comprobando los movimientos exactos que escribe y que el neto del área cuadra. |
| **A3** | Ruta `/cocteleria` reutilizando `KitchenScreen`; ubicación desde el turno del vendedor; `/cocina` filtrado por tipo; tarjetas del Home; `Layout`. | Build. Revisión de que el tablero de cocina, sin recetas de coctelería, renderiza lo mismo que hoy. |
| **A4** | Ajustes: tarjeta nueva ***Tableros de elaboración*** con `sellerKitchenBoard` (ON) y `sellerCocktailBoard` (OFF), cada interruptor tras su módulo. | Build. Comprobar que la lectura es `configRepo.get('sellerKitchenBoard', true)`: con la clave **sin definir** (toda base existente) el vendedor **sigue viendo** el tablero de cocina (regla 2). |
| **A5** | Reporte de producción con columna Tipo y gate doble; pestaña de auditoría; artículo de ayuda con `module`. | Build. Verificar el filtrado del PDF de ayuda (que es por donde se cuela una fuga). |

### Bloque B — Faltante y negativos

| Fase | Alcance | Verificación |
|---|---|---|
| **B1** | `allowShortProduction` en Ajustes; `produce({ allowShort })` acumulando `shortages`. | Build + prueba node: sin el permiso **lanza igual que hoy**; con el permiso escribe el negativo y el `shortages` exacto. |
| **B2** | Marca del descubierto en la tarjeta y confirmación explícita en el modal. | Build. |
| **B3** | Tipo `negative_stock` derivado de `productions` con `shortages`; categoría en `NotificationSettings`. | Build + prueba node de idempotencia (derivar dos veces el mismo evento no duplica). |
| **B4** | Ayuda: cómo se cura un descubierto (traspaso / conteo / entrada, con el aviso de que la entrada al almacén no cura el área). | Build. |

### Bloque C — Descuento de mesa y panel del dueño

| Fase | Alcance | Verificación |
|---|---|---|
| **C1** | `ordersRepo.totals` con descuento + `setDiscount`/`clearDiscount` + eventos de auditoría. | Build + **prueba node** del cálculo de totales (pura): con `discountPct = 0` la salida es idéntica campo por campo. |
| **C2** | `TableScreen`: fila, botones, `OwnerAuthModal`, línea del ticket. | Build. |
| **C3** | `salesRepo` con los tres campos opcionales; distintivo y aviso en `SalonScreen`. | Build. Revisión de que una venta sin descuento se guarda igual que hoy. |
| **C4** | Reporte *Ventas por mesa* con columna Descuento; prorrateo en `analyticsRepo`; tarjeta de gastos con `DeltaBadge invert`; ayuda. | Build + prueba node del prorrateo: sin `discountAmount`, los agregados salen **idénticos**; con descuento, la suma de `byProduct` cuadra con `revenue`. |

---

## 12. Lo que este plan NO podrá garantizar

Dicho antes de empezar, para no repetir lo de `fichas`:

- **Nadie habrá ejecutado la app.** La validación será **código + build + pruebas node**. Ni un
  turno abierto, ni un mojito elaborado, ni una mesa cobrada con descuento, ni una fusión entre dos
  teléfonos. Eso solo lo puede validar el dueño en sus dispositivos.
- **El prorrateo cambia números que el dueño ya está mirando.** Es *data-driven* (sin descuentos,
  idéntico), pero en cuanto haya un descuento, "Ventas netas" bajará respecto de lo que habría
  mostrado antes. Es la corrección pedida, no un efecto colateral, y conviene que el dueño lo sepa
  la primera vez que lo vea.
- **Permitir existencias negativas rompe un invariante de facto.** Hoy todos los escritores impiden
  el negativo. Con el permiso encendido, el negativo aparecerá en catálogo, inventario por
  ubicación y conteo físico, que **no** tienen tratamiento especial para él (se muestra el número
  tal cual, y el conteo lo cura). No se ha auditado pantalla por pantalla cómo se ve un negativo en
  cada una: es el riesgo conocido de este bloque, y es la razón de que el permiso nazca apagado.
- **No hay linter.** `npm run build` sigue siendo la única puerta estática del proyecto.
- **Los relojes de los teléfonos siguen desfasados ~21 s.** El software garantiza el **orden**
  (`tsAfter`), no la hora. Eso solo se arregla poniendo fecha y hora automáticas en los aparatos.

---

## 13. Archivos

### Nuevos

- **Ninguna pantalla nueva** (se reutiliza `KitchenScreen` con una prop de tipo).
- **Tres módulos puros en `src/lib/`, con su prueba node al lado.** Hace falta extraerlos porque
  `kitchenRepo`, `ordersRepo` y `analyticsRepo` **importan `db` en su cabecera**, así que no se
  pueden cargar en node sin `fake-indexeddb`. Es el patrón que el proyecto ya usa (`custodyMath`,
  `productCustodyMath`, `fichaLines`): la aritmética vive en `lib/` y el repo la consume.
  - `src/lib/kitchenMath.js` — `canMake(recipe, productById, location)`. Se **mueve** el cuerpo
    actual de `kitchenRepo.canMake`, que queda delegando: **ningún llamador cambia** y el
    comportamiento con `location = COCINA` es el de hoy.
  - `src/lib/orderTotals.js` — el cálculo de subtotal / descuento / servicio / total a partir de
    las líneas ya leídas. `ordersRepo.totals` sigue siendo quien va a Dexie.
  - `src/lib/saleRevenue.js` — el prorrateo del descuento sobre las líneas de una venta (§8.2), que
    consumen `analyticsRepo` y el reporte.
- **`CLAUDE.md` hay que actualizarlo:** el bucle de pruebas de la sección *Comandos* está escrito a
  mano fichero por fichero (y ya avisa de que un glob `src/lib/*.test.mjs` se salta dos). Cada
  suite nueva debe añadirse ahí, o nadie la correrá.

### Tocados (todos con ramas gateadas o parámetros con default = conducta de hoy)

`src/lib/license.js` · `src/repositories/recipesRepo.js` · `src/repositories/kitchenRepo.js` ·
`src/repositories/ordersRepo.js` · `src/repositories/salesRepo.js` ·
`src/repositories/analyticsRepo.js` · `src/repositories/configRepo.js` (opcional, si se añaden
lectores con default) · `src/app/router.jsx` · `src/components/Layout.jsx` ·
`src/features/home/Home.jsx` · `src/features/kitchen/KitchenScreen.jsx` ·
`src/features/kitchen/RecipesScreen.jsx` · `src/features/kitchen/RecipeForm.jsx` ·
`src/features/settings/Settings.jsx` · `src/features/tables/TableScreen.jsx` ·
`src/features/tables/SalonScreen.jsx` · `src/features/dashboard/DashboardScreen.jsx` ·
`src/features/notifications/notificationService.js` ·
`src/features/notifications/NotificationSettings.jsx` ·
`src/repositories/notificationsRepo.js` (tipo nuevo) ·
`src/features/reports/reportsService.js` · `src/features/help/helpContent.js` ·
`src/styles/global.css` (clases nuevas al final, sin redefinir ninguna existente).

**Lo que NO se toca:** `src/db/db.js` (cero versiones nuevas), `src/features/sync/collections.js`
(cero colecciones nuevas), `transfersRepo`, `purchasesRepo`, `countsRepo`, `salesRepo` en su
aritmética de stock, `firestore.rules`, y toda la lógica de cobro, cuadre y libro mayor.

---

## 14. Casos borde ya previstos

1. **Vendedor sin turno abierto** en `/cocteleria`: no puede elaborar (no hay área de la que
   consumir). Mensaje claro, no pantalla en blanco.
2. **Área sin insumos:** todas las recetas en *"Puedes elaborar: 0"*; con el permiso de faltante,
   el aviso del descubierto antes de confirmar.
3. **Receta de coctelería cuyo insumo es otro coctel:** se rechaza igual que hoy se rechaza que una
   receta incluya su propio elaborado.
4. **Insumo en divisa sin tasa definida:** bloquea, como en cocina. No se relaja con el permiso de
   faltante (es una falta de dato, no de mercancía).
5. **Mesa con descuento que se anula sin cobrar:** el pedido se anula con su motivo; el descuento
   queda en el histórico de la cabecera y en Auditoría.
6. **Descuento aplicado y luego se agregan más consumos:** el % se aplica sobre el subtotal
   **vigente al cobrar** (se recalcula), no sobre el de cuando se autorizó. Es lo esperable en una
   cuenta abierta, y queda dicho en la ayuda.
7. **Descuento del 100 %:** permitido (cortesía total). El total queda en 0 y la venta se registra
   igual, con su autorizante — no se inventa un camino aparte.
8. **Dos equipos aplican descuentos distintos a la misma mesa:** gana el último por LWW, sellado
   con `tsAfter`. Los dos eventos quedan en Auditoría, así que se puede reconstruir qué pasó.
9. **Producción con faltante y luego conteo físico del área:** el conteo iguala al real y el
   negativo desaparece con su ajuste. No hay doble corrección.
10. **Quitar `cocteleria` con cocteles en stock en un área:** el stock se queda y se vende
    normalmente (es un producto del catálogo); solo no se pueden elaborar más.

---

## 15. Bitácora de fases (auditoría al cerrar cada una)

### A1 — Módulo de licencia y tipo de receta (commit `3a09190`, 11-09-2026)

**Qué se hizo:** `LICENSE_MODULES.COCKTAILS` + etiqueta; `RECIPE_KINDS` /
`RECIPE_KIND_LABELS` y los helpers `recipeKind` / `isCocktailRecipe`; `recipesRepo.list` y
`listActive` con filtro `kind` **opcional** y `create` con `kind` (que **solo escribe el campo
cuando vale `cocteleria`**); `RecipesScreen` con compuerta `cocina || cocteleria`, una sección de
recetas **por tipo** y el panel *Abastecer cocina* gateado solo por `cocina`; `RecipeForm` con el
tipo elegible en el alta e **inmutable en la edición**.

**Verificado ejecutando, no citando:**

- `npm run build` **exit 0**.
- **498/498 aserciones** en las 8 suites node (21+16+9+68+243+54+18+69). *Ojo: `CLAUDE.md` dice
  462 porque `remesas.test.mjs` pasó de 32 a 68 aserciones en los commits de Entregas; la cifra
  del `CLAUDE.md` está vieja, no es que falten pruebas.*
- **Peso medido con y sin los cambios** (`git stash` + build a cada lado, misma máquina): el chunk
  principal pasa de **946.63 kB** (gzip **274.11**) a **948.65 kB** (gzip **274.82**) =
  **+2.02 kB, +0.21 %**. *(El 941.56 kB que cita §9 de este documento era `fd24823`; la rama ya
  llevaba los commits de Entregas encima.)*
- **Cero cambios de esquema y de sync:** `git diff` no toca `src/db/db.js` ni
  `src/features/sync/collections.js`.
- **Sin fugas:** los únicos consumidores de `LICENSE_MODULES.COCKTAILS` son `RecipesScreen` y
  `RecipeForm`, y la compuerta de pantalla se evalúa **antes** de pintar cualquier sección.

**Dos desviaciones del plan, declaradas (y por eso este documento se actualiza en el mismo
bloque de trabajo):**

1. **Se tocó `src/db/constants.js`, que no estaba en la lista de archivos del §13.** El enum del
   tipo de receta va ahí porque es donde el proyecto guarda sus enums (lo dice su propia
   arquitectura en `CLAUDE.md`); meterlo en `recipesRepo` para no salir de la lista habría sido
   peor. **La lista del §13 queda corregida: `src/db/constants.js` entra.**
2. **El filtro por tipo del tablero `/cocina` se adelantó de A3 a A1** (una línea en
   `KitchenScreen`). Sin él, cualquier commit entre A1 y A3 dejaría un estado **incoherente**: una
   receta de coctelería aparecería en el tablero de cocina y se intentaría elaborar desde
   `__cocina`, que no es su ubicación. A3 ya no tiene que hacerlo.

**Consecuencias reales que el dueño debe conocer (ninguna es un fallo, pero no son cero):**

1. **Cambia texto visible para un negocio que hoy usa `cocina`.** El DOM **no** es idéntico: el
   título de la pantalla pasa de *"Cocina — recetas"* a *"Recetas"*, la tarjeta de *"Recetas (N)"*
   a *"Recetas de cocina (N)"*, el botón de *"+ Nueva receta"* a *"+ Nueva"*, y cada sección gana
   una línea de ayuda. Es consecuencia directa de la decisión 2 del §2 (listas separadas); ninguna
   lógica cambia.
2. **Convivencia de versiones — lo más importante de esta fase.** `recipes` sincroniza por LWW de
   documento entero, así que una receta de coctelería **llega a un teléfono con el build viejo**, y
   ese build **no conoce `kind`**: la ofrecería en su tablero de cocina. En el caso normal fallaría
   con *"No hay suficiente X en la cocina"* (los insumos están en el área, no en `__cocina`), pero
   si ese insumo **también** existe en la cocina, lo consumiría de la ubicación equivocada.
   **Regla operativa: no crear recetas de coctelería hasta que TODOS los dispositivos hayan abierto
   el build nuevo.** No es corregible desde el build nuevo; depende del viejo.
3. **El importador de recetas de la ficha de costo (`InputsBlock.jsx:54`) listará también las
   recetas de coctelería** en un negocio que tenga `cocina` **y** `cocteleria`. Está gateado en la
   consulta por `cocina`, así que **no hay fuga de licencia**, y la aritmética de costear un trago
   es igual de válida; lo que pasa es que salen **sin etiqueta de tipo**, mezcladas. No se tocó:
   `fichas` está fusionado a `main` y su documento exige leerlo antes de modificarlo, y el plan no
   lo incluye. **Decisión pendiente del dueño:** etiquetarlas o filtrarlas en A5.
4. **Limitación heredada, no introducida:** el selector de insumos excluye **todos** los productos
   elaborados, así que una receta de coctelería **no puede usar un elaborado de cocina como
   insumo** (p. ej. un sirope casero en un mojito). Es el comportamiento de siempre
   (`RecipeForm.jsx:96`) y `kitchenRepo.produce` solo prohíbe que una receta se incluya a sí misma.
   Si el dueño quiere permitirlo, es una decisión aparte.

**Lo que A1 NO hace (y por tanto no se puede probar todavía):** no hay tablero de coctelería
(A3), no hay interruptores en Ajustes (A4) y **un negocio que solo tenga `cocteleria` todavía no
tiene cómo llegar a `/recetas`** desde el Home (su tarjeta sigue colgando de `cocina`; se arregla
en A3). Y, como siempre: **nadie ha ejecutado la app** — esto es código, build y pruebas node.

### A2 — El motor elabora dentro del área (commit `822af61`, 11-09-2026)

**Qué se hizo:** `src/lib/kitchenMath.js` (nuevo, puro, sin Dexie) con `canMake` por ubicación y
`productionMovements`, que decide **qué** movimientos del libro mayor genera una elaboración;
`kitchenRepo.canMake(recipe, productById, location = COCINA)` delegando en él; y
`produce({ …, fromLocation = COCINA })` validando contra el **libro mayor de esa ubicación**,
escribiendo los movimientos por descriptores y nombrando la ubicación real en el mensaje de
faltante. `productions` guarda `kind` y `fromLocation` **solo cuando no son los clásicos**.

**Verificado ejecutando:**

- `npm run build` **exit 0**. Chunk **948.65 → 949.23 kB** (gzip **274.82 → 275.13**): **+0.58 kB**.
- **530/530 aserciones** en **9 suites** node (las 32 de `kitchenMath.test.mjs` son nuevas).
- **El motor contra Dexie REAL** (`fake-indexeddb`), **39/39**. Esto es lo que prueba, punto por
  punto: el flujo clásico escribe **exactamente los 4 movimientos de antes** (mismos tipos, signos
  y ubicaciones), la coctelería escribe **3 y ninguno es traspaso**, la caché `stockByLocation`
  **cuadra con el libro mayor** en los dos casos, el costo por promedio ponderado sale correcto
  (5 en el clásico, 20 en el trago), `productions` **omite** `kind`/`fromLocation` en el clásico y
  los trae en la coctelería, y **los cuatro rechazos abortan la transacción entera** sin dejar ni
  un movimiento ni una producción ni mover una caché.

**Sobre esa prueba del motor — hay que saber dos cosas:**

1. **No se commitea, y por tanto NO entra en el bucle permanente de pruebas.** `fake-indexeddb` no
   es dependencia del proyecto (no está en `package.json`); se instaló **fuera del repo**, en el
   scratchpad de la sesión. Su estatus es el mismo que el de la prueba de migración v17→v19 de
   `docs/FICHA-COSTO.md`: verificación de una vez, no red de seguridad permanente. **Para volver a
   correrla hay que rehacer el andamio** (ver el punto 2). Si el dueño quiere que quede permanente,
   la decisión es añadir `fake-indexeddb` como `devDependency` — eso sí toca `package.json`.
2. **Hizo falta un andamio que revela algo del repo:** `src/db/db.js:2` importa `'./constants'`
   **sin extensión**, y node ESM exige la extensión, así que **ningún fichero que importe `db.js`
   se puede cargar en node** sin un *resolve hook* que añada el `.js`. Por eso el proyecto no tiene
   ninguna suite que toque Dexie. Los módulos de `src/lib/` que sí se prueban usan la extensión
   explícita (`'../db/constants.js'`, como `lib/remesas.js`), y `kitchenMath.js` la usa también.

**Dos fallos reales encontrados en el camino, ambos ya corregidos:**

1. **La primera versión de la prueba del motor fallaba, y el fallo era de la prueba.**
   `db.stockMovements.toArray()` devuelve las filas **por clave primaria** (UUID aleatorio), **no
   por orden de inserción**, así que comparar la secuencia tal cual daba diferencias falsas. Se
   corrigió filtrando por `refId` (el id de la producción) y comparando **ordenado**. Queda escrito
   porque es una trampa que volverá a aparecer en cualquier prueba futura sobre el libro mayor.
2. **`MOVEMENT_TYPES` quedó como import huérfano** en `kitchenRepo` al pasar los movimientos a
   descriptores. **No hay linter que lo cace** (`npm run build` no avisa): lo detectó un `grep`
   explícito. Es exactamente el hallazgo 8 de la auditoría de `remesas`, vivo.

**Cambio de estructura interna que conviene tener presente:** antes, cada insumo escribía su
movimiento **y** actualizaba su caché en la misma iteración; ahora se escriben **todos los
movimientos** y después **todas las cachés**. El estado final es idéntico (misma transacción, y en
ambas versiones la caché se calcula sobre el mismo `p` leído dentro de la transacción), y la prueba
contra Dexie lo confirma. Se dice porque es el tipo de reordenación que parece inocua y no siempre
lo es.

**Lo que A2 NO hace:** nadie puede llegar todavía al flujo nuevo desde la app — no hay tablero de
coctelería (A3) ni interruptores (A4), así que `fromLocation` no lo pasa **ningún** llamador y el
único camino vivo sigue siendo el clásico. Y **la app no se ha ejecutado**: lo de arriba es build,
pruebas puras y el motor contra un IndexedDB **simulado**, que no es un navegador real.

### A3 — Tablero `/cocteleria` y accesos del Home (commit `183688f`, 11-09-2026)

**Qué se hizo:** `KitchenScreen` sirve ahora **los dos tableros** con una prop `kind` (default =
cocina = lo de siempre); ruta `/cocteleria`; tarjetas del Home para mando y vendedor; acceso a
*Recetas* con **cualquiera** de los dos módulos; y `kitchenRepo.recent(limit, { kind })` para que
cada tablero liste solo sus elaboraciones recientes.

**Decisiones de interfaz que hubo que tomar aquí (no estaban en el plano, y cambian cómo se usa):**

1. **En coctelería el área se elige ANTES, no al elaborar.** *"Puedes elaborar: N"* se calcula sobre
   la ubicación de origen, así que sin saber el área no hay número que mostrar. Por eso el **mando**
   tiene un selector de *"Área donde elaboras"* arriba del tablero, y el **vendedor** trae la de su
   turno abierto (mostrada, no editable). La hoja de elaboración de coctelería **ya no pregunta
   área**: el trago se queda donde se elabora. El tablero de cocina **conserva** su flujo (área en
   la hoja, preseleccionada si hay una sola).
2. **El vendedor sin turno abierto no puede elaborar coctelería**, y se le dice por qué (no hay área
   de la que consumir). Es coherente con la regla de oro del proyecto.
3. **Se anticipó la lectura del permiso `sellerCocktailBoard`** (default `false`), tanto en el Home
   como en la pantalla. Su **interruptor** en Ajustes es A4; leerlo ya aquí evita el estado
   incoherente de ofrecerle al vendedor una tarjeta que la pantalla iba a rechazar.
4. **La etiqueta de la sección del Home dice lo que se pinta** — *Cocina*, *Coctelería* o *Cocina y
   coctelería* —, y en la del vendedor cuenta el permiso: con el permiso apagado no promete
   coctelería. Es un detalle, pero era mentira en la primera versión de este commit.

**Verificado ejecutando:**

- `npm run build` **exit 0**. Chunk **949.23 → 952.65 kB** (gzip **275.13 → 276.02**): **+3.42 kB**.
- **530/530** en las 9 suites node.
- **43/43 contra Dexie real** (las 4 nuevas cubren lo que A3 tocó del repo: `recent` con filtro
  devuelve solo las de su tipo, sin filtro devuelve las dos —como antes— y sigue ordenando de más
  reciente a más vieja).

**Del plan, una cosa no hizo falta: `Layout`.** Estaba en la lista de archivos, pero la nav inferior
**no tiene entrada de tableros** (se llega por las tarjetas del Home) y la coctelería **no añade
ningún rol** que haya que ocultar, al contrario que `cocina` (cocinero) o `remesas` (mensajero). Se
deja sin tocar en vez de meter un cambio decorativo.

**Lo que sigue abierto tras A3:**

- **A4 debe poner los dos interruptores en Ajustes.** Hasta entonces `sellerCocktailBoard` no se
  puede encender desde la app, así que **el vendedor no ve el tablero de coctelería** por más que
  tenga el módulo: solo lo ve el mando. Es un estado coherente, pero incompleto a propósito.
- **El tablero de cocina del vendedor sigue sin interruptor** (lo ve siempre con el módulo, como
  hoy). Eso es exactamente la conducta actual y A4 la hará configurable con default ACTIVADO.
- **Nadie ha ejecutado la app.** Todo lo de arriba es build, pruebas puras y el motor contra un
  IndexedDB **simulado**. En particular, **ni un solo trago se ha elaborado desde una pantalla
  real**: el camino pantalla → repo se ha verificado leyendo el código, no usándolo.
