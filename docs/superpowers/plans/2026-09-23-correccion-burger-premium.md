# Corrección de los hallazgos Burger Premium / La Patrona — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usar superpowers:subagent-driven-development (recomendado)
> o superpowers:executing-plans para ejecutar este plan tarea a tarea. Los pasos usan casillas
> (`- [ ]`) para el seguimiento.

**Objetivo:** cerrar los puntos **1, 2 y 3** que el dueño autorizó el 22-09-2026 (H1, H3-a y H3-b)
y el **4 (H2)**, que sube con D1 = a (23-09-2026),
sin cambiar la conducta por defecto, sin esquema Dexie, sin tocar `SYNC_COLLECTIONS` y sin tocar el
camino normal de subida/bajada de la sincronización.

**Arquitectura:** tres cambios **aditivos** e independientes: (1) un candado de **solo lectura** en
`ordersRepo` que mira la **venta** (append-only) en vez de la cabecera (LWW); (2) una función nueva
en `pushEngine` que **retrocede un cursor local** de una colección **inmutable** y reusa la subida
existente; (3) un módulo **puro** que detecta roturas de atomicidad, usado por un script de node
sobre respaldos (fuera del bundle).

**Stack:** React 18 + Vite 6, Dexie 4 (IndexedDB), Firestore. Pruebas: suites `.test.mjs` con node
puro; para lo que necesita base, `fake-indexeddb` + bundle con el `esbuild` que ya trae Vite.

**Spec:** `docs/AUDITORIA-BURGER-PREMIUM-21-09-2026.md` §10 (plan aprobado) y §3, §9;
`docs/AUDITORIA-LA-PATRONA-22-09-2026.md` §4, §11, §13.

## Restricciones globales (reglas del dueño, `CLAUDE.md`)

- Todo en `claude/awesome-dirac-484azm`. **Nada a `main`** sin autorización explícita. **Sin PR.**
- **No afectar la lógica de producción:** cambios aditivos; sin el caso nuevo, conducta **idéntica**.
- **Cero** cambios en `src/db/db.js` (Dexie sigue en **v19**), en `SYNC_COLLECTIONS` (sigue en
  **34**), en `pullEngine.js`, en `doPush()` y en `firestore.rules`.
- Nada se borra (append-only). Ninguna tarea escribe en tablas sincronizadas salvo lo que ya hacían.
- Español en UI, comentarios y commits; imitar el estilo vecino (comentarios sin tildes en el código
  de repos, mensajes de UI con tildes).
- `npm run build` **exit 0** y las **16 suites** existentes en verde **antes de cada commit**.
- Preguntar ante ambigüedad (regla 4): las **decisiones D1–D4** de abajo se responden **antes** de
  programar.
- Honestidad: se valida por **código + build + node**, **nunca** por runtime en el aparato del dueño.

## Lo que esta revisión encontró al contrastar el §10 con el código (22→23-09-2026)

El §10 se leyó contra el árbol actual (`ebd957f`). Cinco cosas cambian o completan el plan
aprobado, y ninguna se puede callar:

1. **`voidOrder` no comprueba el estado en absoluto** (`ordersRepo.js:475`). Si la mesa no tiene
   líneas vivas, **no pasa por `voidItem`** y el candado del §10.2 no se ejecuta: la cabecera pasa a
   `voided` igual. Hace falta el candado **también al principio de `voidOrder`** (una línea más).
2. **El candado solo, sin salida, deja la mesa en un callejón.** En el caso exacto que protege
   (cabecera `open` + venta viva), la mesa: (a) ya no se puede anular — bien —; (b) **sigue pudiendo
   cobrarse OTRA VEZ** (`TableScreen.charge` no mira si hay venta: nacería una **segunda venta**, con
   el dinero contado dos veces); y (c) **bloquea el cierre de turno**, que exige cero mesas abiertas
   (`ShiftScreen.jsx:131` y `:293`). Hoy la salida existente es la dañina (anular); con el candado no
   queda ninguna. → **Decisión D1.**
3. **`SalonScreen` se traga los errores:** `releaseEmpty` y `voidWithConsumo` usan `try/finally`
   **sin `catch`** (`SalonScreen.jsx:135-155`). El mensaje del candado **no se vería** justo en la
   pantalla donde se anuló la mesa del 21-09 (iría mudo al `errorLog`). Hay que añadir el `catch` y
   el `<p className="error">` que ya usan `TableScreen` y `ShiftScreen`.
4. **Reenviar una colección MUTABLE puede REGRESAR la nube.** `pushEngine` sube con `batch.set`
   (`pushEngine.js:163`): **sobrescribe el documento de Firestore a ciegas**, sin comparar marcas. Si
   el aparato que reenvía tiene una copia atrasada de un documento mutable (`orders`, `orderItems`,
   `products`, `counts`…), la nube vuelve a la versión vieja; los demás aparatos la rechazan por LWW,
   pero un aparato que se vincule o arranque en frío **la recibe**. En filas **inmutables** esto es
   imposible (no hay versión vieja). Verificado con `grep`: `stockMovements`, `productions`,
   `purchases` y `transfers` **no tienen ni un `update/put/modify/delete`** en `src/` (solo el
   `bulkPut` de importación de traspaso, que reescribe filas idénticas). → el reenvío se limita a
   **esas cuatro**, que es además **todo lo que necesitan los dos incidentes** (Burger: 7 filas de
   `stockMovements`; La Patrona: 8 filas de `stockMovements`).
5. **Carrera con el cursor.** `setCursorForward` (`pushEngine.js:52`) relee el cursor y escribe el
   máximo del lote. Si el retroceso cae **mientras** corre un `doPush` de esa colección, el push lo
   **deshace en silencio**. El retroceso tiene que tomar el **mismo cerrojo** (`running`) que
   `pushChanges`.

Y una del acta de La Patrona que el plan del 22-09 no recogía: el diagnóstico (punto 3) debe
incluir **venta sin su movimiento de stock** (`refType:'sale'`), excluyendo las ventas de mesa, que
nacen con `skipStock: true` (`TableScreen.jsx:401`, único uso en `src/`) y mueven stock con
`refType:'order'`.

## Decisiones del dueño (regla 4) — RESUELTAS el 23-09-2026

**D1 = a, D2 = sí, D3 = script, D4 = sí. Ejecución por subagentes.** Con D1 = a el **punto 4 (H2)**
sube justo detrás del 1 (Task 2) como salida de la mesa trabada. La tabla queda como registro de
lo que se preguntó.

| # | Pregunta | Recomendación | Por qué |
|---|---|---|---|
| **D1** | Con el candado puesto, ¿qué hace una mesa que ya se cobró pero aparece abierta? | **(a)** Bloquear también el **cobro** si ya hay venta (mismo candado, en `charge`) **y** subir el **punto 4 (H2)** justo detrás del 1, como salida. | Sin (a) queda abierto un daño **peor** que el que se cierra (venta duplicada). Sin el 4, la mesa bloquea el cierre de turno hasta que alguien la repare a mano. Alternativa (b): solo el candado de anulación y el 4 más adelante, asumiendo el callejón (1 caso en 30 pedidos en la historia de Burger). |
| **D2** | ¿Se añade `fake-indexeddb` como `devDependency`? | **Sí.** Fuera del bundle; toca `package.json`/`package-lock.json` solo en `devDependencies`. | Es la única forma de probar `voidItem`/`voidOrder` de verdad en node. Sin ella, se prueba solo el predicado puro y la consulta Dexie se valida **por lectura**, y se dirá así. |
| **D3** | ¿El diagnóstico entra en la app (tarjeta en `/auditoria`) o se queda como script sobre respaldos? | **Script ahora**, con la lógica en un módulo puro que la tarjeta podría reusar después. | Da la cifra que pide el 5 **sin tocar el bundle**. La tarjeta es otra decisión, con su propio gateo (solo mando). |
| **D4** | ¿El reenvío se limita a las 4 colecciones inmutables? | **Sí.** | Hallazgo 4 de arriba. Ampliarlo a colecciones mutables exige leer la nube antes de escribir (cuota) o aceptar el riesgo de regresión. |

## Orden de ejecución y por qué

```
Tarea 0  (dueño, sin código)  ─ igualar la información antes de tocar nada
Task 1   H1   candado de venta ─ lo más barato y aislado; monta el arnés de pruebas
Task 2   H2   reparar cabecera  ─ la salida de la mesa trabada que deja el candado (D1 = a)
Task 3   H3-a reenvío           ─ lo ÚNICO que repara el daño ya existente (en los dos negocios)
Task 4   H3-b diagnóstico       ─ elige el aparato del reenvío, verifica antes/después y da la
                                  cifra para decidir el 5
Task 5   verificación global + actas; se para ahí (sin fusionar)
```

**Por qué el 1 va primero aunque el reenvío (Task 3) repare más:** el 1 es un fichero de repositorio y dos de
pantalla, sin sincronización; si algo sale mal, el radio es una pantalla. El reenvío toca
`src/features/sync/` y conviene llegar a él con el arnés de pruebas ya validado. **El diagnóstico
(Task 4) se puede correr sobre los respaldos en cuanto exista**, así que en la práctica sirve para
elegir desde qué aparato se hace el reenvío (Task 3): el orden de *programación* es 1→2→3→4, pero el
orden de *uso en el negocio* es 4→3.

## Foco de revisión (lo que ninguna prueba de las tareas cubre sola)

1. **Mesa reservada que otro aparato ocupó** (`order.shiftId` nulo en local, venta con `shiftId`
   real): el candado debe caer al barrido por `filter` y encontrar la venta, **nunca lanzar por
   sorpresa**. → prueba en Task 1, paso 8 (caso 4).
2. **Pulsar «−» en una mesa normal sin cobrar**: el candado no debe cambiar nada (una consulta
   indexada más). → prueba de no-regresión en Task 1 (caso 5).
3. **Reenviar con la sincronización desactivada o sin sesión**: no debe retroceder el cursor a
   medias ni fallar en silencio. → prueba en Task 3.
4. **Fecha del reenvío en hora local vs UTC** (la rectificación §9.8 del acta): el campo es local y
   el cursor es ISO UTC. → prueba de conversión en Task 3.
5. **Venta de mesa en el diagnóstico**: no debe salir como «venta sin movimiento» (es `skipStock`).
   → prueba en Task 4.

---

### Tarea 0 (dueño, sin código): Lo que no es código

Todo esto sale de §10.1 de Burger y §11–§12 de La Patrona; se repite porque condiciona las tareas.

- [ ] **No contar** el Batido de maní en el aparato que muestra −1 (Burger), ni los 6 productos de
      La Patrona (Goma de uñas, Teipe, CUCHILLA HOJA, PLASTILOKA, Union 1, CODO 1) en el teléfono del
      dueño, **hasta después del reenvío** de la Task 3.
- [ ] Corregir el costo de **`Carne de res`** (472 MN/g) en Burger. Dato, riesgo cero.
- [ ] **Fecha y hora automáticas** en todos los aparatos de los dos negocios.
- [ ] **Respaldos que faltan**, cada uno con **nombre distinto** (el §9.1 perdió uno por
      sobrescritura): teléfono de **Abar** (Burger) y de **Claudia** (La Patrona).
- [ ] Mirar **`/errors`** en cada aparato antes de que se pode (200 entradas) y anotar cualquier
      `push … RETRY_EXHAUSTED` o `PAUSED-permanente`.
- [ ] Responder **D1–D4**.

---

### Task 1 — H1: candado de venta en la anulación y en el cobro de mesas

**Ficheros:**
- Modificar: `src/repositories/ordersRepo.js` (nuevo método `saleOf`; una línea en `voidItem` tras
  `:267`; dos líneas al principio de `voidOrder`, `:475`).
- Modificar: `src/features/tables/SalonScreen.jsx` (estado `error`, `catch` en `releaseEmpty` y
  `voidWithConsumo`, un `<p className="error">`).
- Modificar (**D1 = a**): `src/features/tables/TableScreen.jsx` (candado al principio de
  `charge`, `:337`).
- Crear: `src/lib/orderSale.js` (predicado puro) y `src/lib/orderSale.test.mjs`.
- Crear (**D2 = sí**): `src/repositories/ordersRepo.test.mjs` (y `fake-indexeddb` en `devDependencies`).

**Interfaces:**
- Produce: `isLiveSaleOf(sale, orderId) → boolean` (puro); `ordersRepo.saleOf(order) → Promise<sale|null>`;
  constante `MSG_MESA_COBRADA`.

- [ ] **Paso 1: prueba pura que falla** — `src/lib/orderSale.test.mjs`

```js
// Pruebas PURAS del predicado "esta venta es la de este pedido".
// Sin framework: ejecutar con  `node src/lib/orderSale.test.mjs`.
//
// QUE CAZA: el candado de la auditoria Burger Premium (H1). La verdad de "esta
// mesa ya se cobro" vive en la VENTA (append-only), no en order.status (LWW).
import { isLiveSaleOf } from './orderSale.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}

eq(isLiveSaleOf({ orderId: 'o1', voided: false }, 'o1'), true, 'venta viva del pedido')
eq(isLiveSaleOf({ orderId: 'o1' }, 'o1'), true, 'voided ausente = viva')
eq(isLiveSaleOf({ orderId: 'o1', voided: true }, 'o1'), false, 'venta anulada no cuenta')
eq(isLiveSaleOf({ orderId: 'o2', voided: false }, 'o1'), false, 'otro pedido')
eq(isLiveSaleOf({ orderId: null, voided: false }, 'o1'), false, 'venta de mostrador')
eq(isLiveSaleOf({ voided: false }, 'o1'), false, 'sin orderId')
eq(isLiveSaleOf({ orderId: 'o1' }, ''), false, 'pedido sin id')
eq(isLiveSaleOf({ orderId: 'o1' }, null), false, 'pedido nulo')
eq(isLiveSaleOf(null, 'o1'), false, 'venta nula')
// Control negativo: un predicado que siempre diga true debe fallar aqui.
eq([{ orderId: 'x' }, { orderId: 'y', voided: true }].some((s) => isLiveSaleOf(s, 'y')), false,
  'control negativo: ninguna viva de y')

console.log(`orderSale: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Paso 2: correrla y ver que falla**

Run: `node src/lib/orderSale.test.mjs`
Esperado: error `Cannot find module .../orderSale.js`.

- [ ] **Paso 3: implementación mínima** — `src/lib/orderSale.js`

```js
// Auditoria Burger Premium (H1): una mesa esta COBRADA si existe una venta viva
// con su orderId. Se mira la venta (append-only, id propio: no se pisa ni se
// pierde) y NO order.status, que vive en la cabecera y se fusiona por LWW de
// documento entero: puede llegar tarde o no llegar.
export function isLiveSaleOf(sale, orderId) {
  if (!sale || !orderId) return false
  return sale.orderId === orderId && !sale.voided
}

export const MSG_MESA_COBRADA =
  'Esta mesa ya se cobró: no se puede anular ni quitar consumo. Revisa la venta en el turno.'
```

- [ ] **Paso 4: correrla y ver que pasa**

Run: `node src/lib/orderSale.test.mjs` → `orderSale: 10 OK, 0 fallos`.

- [ ] **Paso 5: el candado en `ordersRepo.js`**

Añadir al `import` de la cabecera:

```js
import { isLiveSaleOf, MSG_MESA_COBRADA } from '../lib/orderSale'
```

Nuevo método (junto a `get`, `:58`):

```js
  // Venta viva de este pedido, o null. SOLO LEE. `sales` no tiene indice por
  // orderId (db.js:27): se entra por shiftId, que la venta de mesa hereda de
  // order.shiftId (TableScreen). Si la cabecera local no lo trae -mesa reservada
  // que otra instancia ocupo- se barre la tabla: es raro y nunca debe lanzar.
  async saleOf(order) {
    if (!order?.id) return null
    const rows = order.shiftId
      ? await db.sales.where('shiftId').equals(order.shiftId).toArray()
      : await db.sales.filter((s) => isLiveSaleOf(s, order.id)).toArray()
    return rows.find((s) => isLiveSaleOf(s, order.id)) || null
  },
```

En `voidItem`, justo después de la línea `if (order.status !== ORDER_STATUS.OPEN) …` (`:267`):

```js
    // Candado de ultima instancia (auditoria Burger Premium, H1): la cabecera
    // puede decir "open" porque el cierre no llego por la sync; la venta no miente.
    if (await this.saleOf(order)) throw new Error(MSG_MESA_COBRADA)
```

Al principio de `voidOrder` (`:475`), antes de `const live = …`:

```js
    // Sin lineas vivas este metodo no pasa por voidItem: el candado va aqui tambien.
    const cur = await db.orders.get(orderId)
    if (cur && await this.saleOf(cur)) throw new Error(MSG_MESA_COBRADA)
```

- [ ] **Paso 6: `SalonScreen` muestra el error**

Junto a los demás `useState` (`:48`): `const [error, setError] = useState('')`.
En `releaseEmpty` y en `voidWithConsumo`: `setError('')` al empezar, y entre el `try` y el
`finally` añadir `} catch (e) { setError(e.message)`. Y pintar
`{error && <p className="error">{error}</p>}` en la misma posición relativa que en
`TableScreen.jsx:638` (debajo de la cabecera del salón). Con el caso normal no aparece nada.

- [ ] **Paso 7 (D1 = a): candado en el cobro** — `TableScreen.jsx`, en `charge` tras
      `if (!live.length) return …` (`:339`):

```js
    // H1: si ya existe una venta viva de esta mesa, cobrar crearia OTRA venta
    // (dinero contado dos veces). La cabecera puede ir atrasada; la venta no.
    if (await ordersRepo.saleOf(order)) return setError(MSG_MESA_COBRADA)
```

(y `import { MSG_MESA_COBRADA } from '../../lib/orderSale'`).

- [ ] **Paso 8 (D2 = sí): prueba con base** — instalar y escribir
      `src/repositories/ordersRepo.test.mjs`

Run: `npm install --save-dev fake-indexeddb`

```js
// Prueba CON BASE (fake-indexeddb) del candado H1. No corre con node directo
// porque los repos importan sin extension: se empaqueta con el esbuild de Vite.
//   npx esbuild src/repositories/ordersRepo.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/ordersRepo.test.bundle.mjs && node <scratch>/...
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { ordersRepo } from './ordersRepo'
import { ORDER_STATUS } from '../db/constants'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
const throws = async (fn, re, l) => {
  try { await fn(); fail++; console.error('FAIL (no lanzo)', l) }
  catch (e) { ok(re.test(e.message), `${l}: ${e.message}`) }
}
const T = '2026-09-21T19:40:00.000Z'

async function seed({ shiftId = 's1', withSale = true, saleShift = 's1' } = {}) {
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.products.put({ id: 'p1', name: 'Jugo', stock: 5, stockByLocation: { Salon: 5 }, updatedAt: T })
  await db.orders.put({ id: 'o1', area: 'Salon', table: 1, status: ORDER_STATUS.OPEN, shiftId, updatedAt: T, openedAt: T })
  await db.orderItems.put({ id: 'i1', orderId: 'o1', productId: 'p1', qty: 1, area: 'Salon', voided: false, createdAt: T, updatedAt: T })
  if (withSale) await db.sales.put({ id: 'v1', orderId: 'o1', shiftId: saleShift, voided: false, createdAt: T })
}

// 1. Cabecera "open" + venta viva -> voidItem rechaza y NO mueve nada.
await seed()
await throws(() => ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }), /ya se cobró/, 'voidItem con venta')
ok((await db.stockMovements.count()) === 0, 'sin movimiento de devolucion')
ok((await db.orderItems.get('i1')).voided === false, 'linea intacta')

// 2. voidOrder con lineas vivas y venta -> rechaza, cabecera intacta.
await seed()
await throws(() => ordersRepo.voidOrder({ orderId: 'o1', userId: 'u' }), /ya se cobró/, 'voidOrder con venta')
ok((await db.orders.get('o1')).status === ORDER_STATUS.OPEN, 'cabecera sigue open')

// 3. voidOrder SIN lineas vivas y con venta -> tambien rechaza (hallazgo 1).
await seed()
await db.orderItems.update('i1', { voided: true })
await throws(() => ordersRepo.voidOrder({ orderId: 'o1', userId: 'u' }), /ya se cobró/, 'voidOrder vacio con venta')

// 4. shiftId nulo en local (reservada que otro ocupo) -> cae al filter y rechaza.
await seed({ shiftId: null, saleShift: 's9' })
await throws(() => ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }), /ya se cobró/, 'shiftId nulo')

// 5. NO REGRESION: sin venta, voidItem hace exactamente lo de siempre.
await seed({ withSale: false })
await ordersRepo.voidItem({ itemId: 'i1', userId: 'u' })
ok((await db.orderItems.get('i1')).voided === true, 'sin venta: linea anulada')
ok((await db.stockMovements.count()) === 1, 'sin venta: un movimiento de devolucion')
ok((await db.products.get('p1')).stockByLocation.Salon === 6, 'sin venta: stock devuelto')

// 6. Venta ANULADA no bloquea.
await seed()
await db.sales.update('v1', { voided: true })
await ordersRepo.voidItem({ itemId: 'i1', userId: 'u' })
ok((await db.orderItems.get('i1')).voided === true, 'venta anulada no bloquea')

console.log(`ordersRepo: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Paso 9: control negativo de la prueba con base** — comentar temporalmente la línea del
      candado en `voidItem`, reempaquetar y correr: **deben fallar** los casos 1, 2 y 4. Restaurar la
      línea. (Sin este paso la prueba podría no medir nada.)

- [ ] **Paso 10: verificar** — `npm run build` exit 0; las 16 suites + `orderSale` + `ordersRepo`
      en verde; `git diff --stat` solo con los ficheros de esta tarea; `grep -n "db.sales"
      src/repositories/ordersRepo.js` = solo lecturas (`where`/`filter`), cero escrituras.

- [ ] **Paso 11: commit**

```bash
git add src/lib/orderSale.js src/lib/orderSale.test.mjs src/repositories/ordersRepo.js \
        src/features/tables/SalonScreen.jsx src/features/tables/TableScreen.jsx \n        src/repositories/ordersRepo.test.mjs package.json package-lock.json
git commit -m "Mesas - H1: no se anula ni se quita consumo de una mesa que ya tiene venta

Candado de solo lectura en voidItem y voidOrder: mira la venta (append-only)
y no order.status (LWW). Sin venta, conducta identica. Cero esquema, cero sync.
Auditoria Burger Premium 21-09-2026, H1.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2 — H2: reparar al leer la cabecera de una mesa que ya se cobró

**Por qué existe (D1 = a):** con el candado de la Task 1, una mesa con cabecera `open` y venta viva
ya no se puede anular ni volver a cobrar, y bloquea el cierre de turno. Esta tarea la **desatasca**:
al abrir el salón o la mesa, si la cabecera dice `open` y existe su venta viva, se repara a
`closed` + `saleId`. Mismo patrón y mismas reglas que `ordersRepo.reconcileDiscount`
(`ordersRepo.js:416`) y `remittancesRepo.reconcileFromDeliveries`.

**La regla que NO se puede romper — qué campos escribe la reparación: SOLO `status` y `saleId`.**
- **Ni `updatedAt`:** es un valor derivado que cada aparato calcula igual de la venta; sellarlo
  provocaría eco de subida y competiría por LWW con la cabecera real del aparato que cobró.
- **Ni `closedAt`:** `closedAt` está en `TS_FIELDS` (`collections.js:114`), así que escribirlo **sube el
  `syncTs`** de la fila igual que si se tocara `updatedAt`: la reparación se re-subiría con
  `batch.set` y podría pisar en la nube la cabecera real (que sí trae `closedBy`/`closedAt`).
- **Ni `closedBy`**: no hay un autor real que poner; inventarlo sería mentir en el rastro.

Consecuencia aceptada y declarada: una cabecera reparada queda `closed` **sin `closedAt`** en ese
aparato hasta que le llegue la cabecera real por la sync (que la sustituye por LWW).

**Ficheros:**
- Modificar: `src/lib/orderSale.js` (predicado puro `shouldReconcileClosed`) y
  `src/lib/orderSale.test.mjs` (sus casos).
- Modificar: `src/repositories/ordersRepo.js` (método `reconcileClosed`, junto a `reconcileDiscount`).
- Modificar: `src/features/tables/SalonScreen.jsx` (`:66-71`) y `src/features/tables/TableScreen.jsx`
  (`:131-134`): llamar a `reconcileClosed` en los **mismos** `useEffect` que ya llaman a
  `reconcileDiscount`, best-effort con `logError('mesas', e)`.
- Modificar: `src/repositories/ordersRepo.test.mjs` (casos con base).

**Interfaces:**
- Consume (Task 1): `isLiveSaleOf(sale, orderId)`, `ordersRepo.saleOf(order)`.
- Produce: `shouldReconcileClosed(order, sale) → boolean`; `ordersRepo.reconcileClosed(orderId) →
  Promise<boolean>` (true si reparó).

- [ ] **Paso 1: casos puros que fallan** — añadir a `src/lib/orderSale.test.mjs`, antes del resumen
      final (y `shouldReconcileClosed` al `import`):

```js
// H2: reparar la cabecera SOLO si dice open y hay venta viva de ESE pedido.
const V = { id: 'v1', orderId: 'o1', voided: false }
eq(shouldReconcileClosed({ id: 'o1', status: 'open' }, V), true, 'open + venta viva -> reparar')
eq(shouldReconcileClosed({ id: 'o1', status: 'open' }, null), false, 'open sin venta -> no')
eq(shouldReconcileClosed({ id: 'o1', status: 'open' }, { ...V, voided: true }), false, 'venta anulada -> no')
eq(shouldReconcileClosed({ id: 'o1', status: 'closed', saleId: 'v1' }, V), false, 'ya cerrada -> no')
eq(shouldReconcileClosed({ id: 'o1', status: 'voided' }, V), false, 'anulada: no se regresa ningun estado')
eq(shouldReconcileClosed({ id: 'o1', status: 'reserved' }, V), false, 'reservada -> no')
eq(shouldReconcileClosed({ id: 'o1', status: 'open' }, { ...V, orderId: 'o2' }), false, 'venta de otro pedido')
eq(shouldReconcileClosed(null, V), false, 'pedido nulo')
```

- [ ] **Paso 2: correrla y ver que falla** — `node src/lib/orderSale.test.mjs` → `shouldReconcileClosed`
      no exportada.

- [ ] **Paso 3: el predicado** — añadir a `src/lib/orderSale.js` (el `import` arriba del fichero;
      `constants.js` no importa nada, así que node lo carga sin bundle):

```js
import { ORDER_STATUS } from '../db/constants.js'

// H2 (auditoria Burger Premium): la cabecera dice "open" pero la venta viva ya
// existe -> el cierre no llego por la sync (o el cobro se corto entre las dos
// transacciones de TableScreen). Deliberadamente ESTRECHA, como
// shouldReconcileDelivered: solo promueve open -> closed; no regresa ningun
// estado y no toca anuladas ni reservadas.
export function shouldReconcileClosed(order, sale) {
  if (!order || order.status !== ORDER_STATUS.OPEN) return false
  return isLiveSaleOf(sale, order.id)
}
```

- [ ] **Paso 4: correrla y ver que pasa** — `orderSale: N OK, 0 fallos`.

- [ ] **Paso 5: el método en `ordersRepo.js`** (junto a `reconcileDiscount`; añadir
      `shouldReconcileClosed` al `import` de `../lib/orderSale`):

```js
  // H2 - REPARA la cabecera de una mesa que ya se cobro pero sigue "open" (el
  // cierre no llego por la sync). Mismo patron que reconcileDiscount: derivado de
  // la VENTA (append-only), idempotente y best-effort. Escribe SOLO status y
  // saleId: ni updatedAt ni closedAt (los dos cuentan en syncTs y la reparacion
  // se re-subiria, pisando en la nube la cabecera real), ni closedBy (no hay autor
  // que poner). Devuelve true si reparo.
  async reconcileClosed(orderId) {
    const order = await db.orders.get(orderId)
    if (!order || order.status !== ORDER_STATUS.OPEN) return false
    const sale = await this.saleOf(order)
    if (!shouldReconcileClosed(order, sale)) return false
    await db.orders.update(orderId, { status: ORDER_STATUS.CLOSED, saleId: sale.id }) // SIN marcas: derivado
    return true
  },
```

- [ ] **Paso 6: las llamadas** — en `SalonScreen.jsx`, dentro del `useEffect` de `openIds`, cambiar el
      `map` para que cada id haga las dos reparaciones:

```js
    Promise.all(openIds.split(',').map((oid) =>
      Promise.all([ordersRepo.reconcileDiscount(oid), ordersRepo.reconcileClosed(oid)])))
      .catch((e) => logError('mesas', e))
```

y en `TableScreen.jsx`, en el `useEffect` de `[id]`, añadir debajo de la línea de `reconcileDiscount`:

```js
    ordersRepo.reconcileClosed(id).catch((e) => logError('mesas', e))
```

Ampliar el comentario de encima de cada `useEffect` con una línea: *«H2: y repara la mesa que ya se
cobró pero sigue abierta (su venta es la verdad).»*

- [ ] **Paso 7: casos con base que fallan** — añadir a `src/repositories/ordersRepo.test.mjs`, antes
      del resumen (e importar `syncTs` de `../features/sync/collections`):

```js
// H2-1. open + venta viva -> closed + saleId, SIN tocar updatedAt ni closedAt.
await seed()
const antes = await db.orders.get('o1')
ok((await ordersRepo.reconcileClosed('o1')) === true, 'H2: repara')
const despues = await db.orders.get('o1')
ok(despues.status === ORDER_STATUS.CLOSED && despues.saleId === 'v1', 'H2: closed + saleId')
ok(despues.updatedAt === antes.updatedAt, 'H2: updatedAt intacto')
ok(despues.closedAt === antes.closedAt, 'H2: closedAt intacto (cuenta en syncTs)')
ok(despues.closedBy === antes.closedBy, 'H2: closedBy intacto')
ok(syncTs(despues) === syncTs(antes), 'H2: syncTs intacto -> sin eco de subida')
// H2-2. Idempotente.
ok((await ordersRepo.reconcileClosed('o1')) === false, 'H2: segunda llamada no hace nada')
// H2-3. Sin venta no toca nada.
await seed({ withSale: false })
ok((await ordersRepo.reconcileClosed('o1')) === false, 'H2: sin venta no repara')
ok((await db.orders.get('o1')).status === ORDER_STATUS.OPEN, 'H2: sigue open')
// H2-4. Anulada con venta: NO se regresa.
await seed()
await db.orders.update('o1', { status: ORDER_STATUS.VOIDED })
ok((await ordersRepo.reconcileClosed('o1')) === false, 'H2: anulada no se toca')
ok((await db.orders.get('o1')).status === ORDER_STATUS.VOIDED, 'H2: sigue voided')
// H2-5. Pedido inexistente no lanza.
ok((await ordersRepo.reconcileClosed('nope')) === false, 'H2: inexistente')
```

- [ ] **Paso 8: control negativo** — cambiar temporalmente la escritura por
      `{ status: ORDER_STATUS.CLOSED, saleId: sale.id, closedAt: new Date().toISOString() }`,
      reempaquetar y correr: **deben fallar** la de `closedAt` y la de `syncTs`. Restaurar.

- [ ] **Paso 9: verificar** — build exit 0; 16 suites + `orderSale` + `ordersRepo` en verde;
      `reconcileClosed` no escribe `updatedAt`/`closedAt`/`closedBy` en ninguna línea añadida.

- [ ] **Paso 10: commit**

```bash
git add src/lib/orderSale.js src/lib/orderSale.test.mjs src/repositories/ordersRepo.js \
        src/repositories/ordersRepo.test.mjs src/features/tables/SalonScreen.jsx \
        src/features/tables/TableScreen.jsx
git commit -m "Mesas - H2: la mesa que ya se cobro pero sigue abierta se repara al abrirla

Si la cabecera dice open y existe su venta viva, pasa a closed + saleId.
Patron de reconcileDiscount: derivado de la venta, idempotente, y escribe
SOLO status y saleId (ni updatedAt ni closedAt, que cuentan en syncTs: sin
eco de subida). Salida de la mesa trabada que deja el candado H1.
Auditoria Burger Premium 21-09-2026, H2.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3 — H3-a: reenviar a la nube una colección inmutable desde una fecha

**Ficheros:**
- Crear: `src/features/sync/resend.js` (puro: lista permitida, conteo, valor del cursor, fecha
  local→ISO) y `src/features/sync/resend.test.mjs`.
- Modificar: `src/features/sync/pushEngine.js` — **solo añadir** `countResend` y `forceResend` al
  final. **`doPush`, `setCursorForward` y los manejadores de error NO se tocan.**
- Modificar: `src/features/sync/CloudScreen.jsx` — panel nuevo, dentro de la vista del dueño
  (`isOwner`, `:43` ya lo acota).

**Interfaces:**
- Produce (puro): `RESENDABLE: string[]`, `isResendable(name)`, `countSince(rows, sinceIso)`,
  `rewindTo(currentCursor, sinceIso) → string|null`, `localInputToIso(value) → string|null`.
- Produce (motor): `countResend(name, sinceIso) → Promise<number>`,
  `forceResend(name, sinceIso) → Promise<{ queued, skipped? }>`.

- [ ] **Paso 1: prueba pura que falla** — `src/features/sync/resend.test.mjs`

```js
// Pruebas PURAS del reenvio forzado (auditoria Burger Premium, H3-a).
// Sin framework: ejecutar con  `node src/features/sync/resend.test.mjs`.
//
// QUE CAZA: (1) que se pueda reenviar una coleccion MUTABLE -batch.set pisa la
// nube a ciegas y la regresaria-; (2) que el conteo mostrado al dueno no sea el
// mismo predicado que usa doPush (x.ts > cursor, estricto); (3) que el cursor
// se mueva hacia DELANTE por esta via; (4) el desfase hora local / UTC (§9.8).
import { RESENDABLE, isResendable, countSince, rewindTo, localInputToIso } from './resend.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}

// (1) Solo libros inmutables.
for (const n of ['stockMovements', 'productions', 'purchases', 'transfers']) eq(isResendable(n), true, n)
for (const n of ['orders', 'orderItems', 'products', 'counts', 'config', 'sales', 'remittances', 'x'])
  eq(isResendable(n), false, `mutable/desconocida: ${n}`)
eq(RESENDABLE.length, 4, 'exactamente cuatro')

// (2) Mismo predicado que doPush: syncTs(r) > since, estricto.
const rows = [
  { createdAt: '2026-09-21T20:02:30.917Z' },
  { createdAt: '2026-09-21T20:02:30.000Z' },   // igual al corte: NO entra
  { createdAt: '2026-09-21T19:00:00.000Z' },
  { createdAt: '' },                           // sin marca: doPush la ignora
  { createdAt: '2026-09-22T10:00:00.000Z', updatedAt: '2026-09-22T11:00:00.000Z' }
]
eq(countSince(rows, '2026-09-21T20:02:30.000Z'), 2, 'cuenta estricta')
eq(countSince(rows, ''), 4, 'sin fecha cuenta todas las que tienen marca')

// (3) El cursor solo RETROCEDE por esta via.
eq(rewindTo('2026-09-22T14:30:34.409Z', '2026-09-21T20:00:00.000Z'), '2026-09-21T20:00:00.000Z', 'retrocede')
eq(rewindTo('2026-09-20T00:00:00.000Z', '2026-09-21T20:00:00.000Z'), null, 'no avanza: nada que hacer')
eq(rewindTo('', '2026-09-21T20:00:00.000Z'), null, 'cursor vacio: ya lo sube todo')
eq(rewindTo('2026-09-22T00:00:00.000Z', 'basura'), null, 'fecha invalida')

// (4) Local -> ISO UTC. Se compara contra el propio Date del entorno para no
// depender de la zona de la maquina que corre la prueba.
eq(localInputToIso('2026-09-21T16:00'), new Date('2026-09-21T16:00').toISOString(), 'local a ISO')
eq(localInputToIso(''), null, 'vacio')
eq(localInputToIso('no-es-fecha'), null, 'invalida')

console.log(`resend: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Paso 2: correrla y ver que falla** — `node src/features/sync/resend.test.mjs` → módulo no
      encontrado.

- [ ] **Paso 3: implementación mínima** — `src/features/sync/resend.js`

```js
import { syncTs } from './collections.js'

// ---------------------------------------------------------------------------
// Reenvio forzado de una coleccion (auditoria Burger Premium, H3-a).
//
// El cursor de subida (`push:<col>`) salta al maximo del lote y nunca retrocede:
// una fila que quedo POR DEBAJO sin llegar a la nube no se vuelve a subir jamas.
// Esto permite al dueno retroceder ese cursor a una fecha y reusar la subida de
// siempre. SOLO para libros INMUTABLES: pushEngine sube con batch.set, que pisa
// el documento de la nube sin comparar marcas; reenviar una fila MUTABLE desde
// una copia atrasada devolveria la nube a una version vieja. Una fila que nunca
// cambia no puede regresar a nada. Verificado: estas cuatro no tienen ni un
// update/put/modify/delete en src/ (salvo el bulkPut de filas identicas del traspaso).
// ---------------------------------------------------------------------------
export const RESENDABLE = ['stockMovements', 'productions', 'purchases', 'transfers']

export const isResendable = (name) => RESENDABLE.includes(name)

const validIso = (s) => typeof s === 'string' && s !== '' && !Number.isNaN(Date.parse(s))

// Cuantas filas subiria doPush con el cursor en `sinceIso`: MISMO predicado que
// pushEngine (syncTs(r) > cursor, estricto), para que la cifra que ve el dueno
// sea la que se va a gastar de la cuota.
export function countSince(rows, sinceIso) {
  let n = 0
  for (const r of rows) {
    const ts = syncTs(r)
    if (ts && ts > (sinceIso || '')) n++
  }
  return n
}

// Nuevo valor del cursor, o null si no hay que tocarlo. Solo RETROCEDE: avanzar
// es cosa de setCursorForward, y un cursor vacio ya lo sube todo.
export function rewindTo(current, sinceIso) {
  if (!validIso(sinceIso)) return null
  if (!current) return null
  return sinceIso < current ? sinceIso : null
}

// El campo <input type="datetime-local"> da hora LOCAL del aparato; el cursor es
// ISO UTC (now() = toISOString). Confundirlos corre el corte 4 h en Cuba (§9.8).
export function localInputToIso(value) {
  if (!value) return null
  const t = new Date(value)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}
```

- [ ] **Paso 4: correrla y ver que pasa** — `resend: 21 OK, 0 fallos` (el número exacto lo da la
      corrida; lo que importa es `0 fallos`).

- [ ] **Paso 5: control negativo** — cambiar temporalmente `ts > (sinceIso || '')` por `>=`: el caso
      «igual al corte» debe fallar. Restaurar.

- [ ] **Paso 6: el motor** — añadir **al final** de `pushEngine.js` (y al `import` de la cabecera
      `import { isResendable, countSince, rewindTo } from './resend'`):

```js
// --- REENVIO FORZADO (auditoria Burger Premium, H3-a) ------------------------
// Solo lectura: cuantas filas de `name` subiria un reenvio desde `sinceIso`.
export async function countResend(name, sinceIso) {
  if (!isResendable(name)) throw new Error('Esa colección no se puede reenviar')
  return countSince(await db[name].toArray(), sinceIso)
}

// Retrocede `push:<name>` a `sinceIso` y dispara la subida de siempre. Toma el
// MISMO cerrojo que pushChanges: si el retroceso cayera en medio de un doPush,
// su setCursorForward lo desharia en silencio. Reenviar es idempotente
// (batch.set por id de filas que no cambian); lo que cuesta es cuota.
export async function forceResend(name, sinceIso) {
  if (!isResendable(name)) throw new Error('Esa colección no se puede reenviar')
  if (!(await syncConfig.isEnabled())) throw new Error('La sincronización no está activa en este aparato')
  if (running) throw new Error('Hay una subida en curso: reintenta en unos segundos')
  running = true
  try {
    const next = rewindTo(await getCursor(name), sinceIso)
    if (next) await db.syncState.put({ key: cursorKey(name), value: next })
  } finally {
    running = false
  }
  return pushChanges()
}
```

- [ ] **Paso 7: el panel en `CloudScreen.jsx`** — dentro de la vista del dueño con la sync activa,
      una tarjeta **«Reenviar a la nube»** con: `<select>` de `RESENDABLE` (etiquetas: *Libro de
      existencias*, *Producciones*, *Entradas*, *Salidas del almacén*); `<input type="datetime-local">`;
      botón **«Contar»** → `countResend(col, localInputToIso(v))` y pinta *«Se reenviarán N filas
      desde el {fecha local}. Gasta N escrituras de la cuota de Firestore.»*; botón **«Reenviar N
      filas»**, deshabilitado hasta haber contado y con N > 0, que llama a `forceResend` y muestra el
      resultado o el `e.message` con `<p className="error">`. Texto de ayuda: *«Úsalo solo en el
      aparato que tiene las filas que faltan en los demás. Reenviar lo mismo dos veces no duplica
      nada.»* Sin la sync activa, la tarjeta no se pinta.

- [ ] **Paso 8: verificar**
  - `npm run build` exit 0; 16 suites + `resend` en verde.
  - `git diff src/features/sync/pushEngine.js` → **solo líneas añadidas** (`+n / -0`), y ninguna
    dentro de `doPush`, `setCursorForward`, `onBatchError` ni `onOneError`.
  - `git diff --stat` de `collections.js`, `pullEngine.js`, `syncEngine.js`, `retryQueue.js`,
    `src/db/db.js`, `firestore.rules` → **vacío**.

- [ ] **Paso 9: commit**

```bash
git add src/features/sync/resend.js src/features/sync/resend.test.mjs \
        src/features/sync/pushEngine.js src/features/sync/CloudScreen.jsx
git commit -m "Sync - H3-a: reenviar desde /cloud una coleccion inmutable desde una fecha

Retrocede el cursor local push:<col> y reusa la subida de siempre. Solo para
stockMovements, productions, purchases y transfers: batch.set pisa la nube a
ciegas y en una coleccion mutable podria regresarla. Toma el cerrojo de
pushChanges. doPush sin cambios; cero esquema; SYNC_COLLECTIONS intacto.
Auditoria Burger Premium 21-09-2026, H3-a.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4 — H3-b: diagnóstico de atomicidad (solo lectura)

**Ficheros:**
- Crear: `src/lib/atomicity.js` (puro) y `src/lib/atomicity.test.mjs`.
- Crear: `docs/auditoria/diagnostico-atomicidad.mjs` (CLI sobre un respaldo JSON; **no entra en el
  build**: nada de `src/` lo importa).

**Interfaces:**
- Produce: `findAtomicityBreaks(tables) → Array<{ kind, id, at, detail }>` donde `tables` es el
  objeto `tables` del respaldo (`backupService.js:37`), y `kind` ∈
  `production-sin-mov`, `mov-sin-production`, `purchase-sin-mov`, `mov-sin-purchase`,
  `transfer-sin-mov`, `mov-sin-transfer`, `sale-sin-mov`, `mov-sin-sale`,
  `anulacion-sin-mov`, `mov-anulacion-sin-linea`.

- [ ] **Paso 1: prueba pura que falla** — `src/lib/atomicity.test.mjs`

```js
// Pruebas PURAS del diagnostico de atomicidad (auditoria Burger Premium, H3-b).
// Sin framework: ejecutar con  `node src/lib/atomicity.test.mjs`.
//
// QUE CAZA: documentos que nacieron en UNA transaccion con sus movimientos y
// llegaron a esta base sin ellos (o al reves). En un solo aparato es imposible;
// si aparece, la sync partio la transaccion.
import { findAtomicityBreaks } from './atomicity.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}
const kinds = (t) => findAtomicityBreaks(t).map((b) => b.kind).sort().join(',')
const T = '2026-09-21T19:48:30.000Z'

// Base sana: cada documento con su movimiento. Debe dar 0.
const sana = {
  productions: [{ id: 'pr1', createdAt: T }],
  purchases: [{ id: 'pu1', createdAt: T }],
  transfers: [{ id: 'tr1', createdAt: T }],
  sales: [
    { id: 'v1', createdAt: T, voided: false, items: [{}] },
    { id: 'v2', createdAt: T, voided: false, orderId: 'o1', items: [{}] } // mesa: skipStock
  ],
  orderItems: [{ id: 'i1', orderId: 'o1', voided: true, voidedAt: T }],
  stockMovements: [
    { id: 'm1', refType: 'production', refId: 'pr1' },
    { id: 'm2', refType: 'purchase', refId: 'pu1' },
    { id: 'm3', refType: 'transfer', refId: 'tr1' },
    { id: 'm4', refType: 'sale', refId: 'v1' },
    { id: 'm5', refType: 'order_void', refId: 'o1', createdAt: T }
  ]
}
eq(kinds(sana), '', 'base sana: sin roturas')
eq(kinds({}), '', 'respaldo sin tablas: sin roturas y sin lanzar')

// Cada rotura por separado.
eq(kinds({ ...sana, stockMovements: sana.stockMovements.filter((m) => m.id !== 'm1') }),
  'production-sin-mov', 'produccion huerfana (19:48:30 de Burger)')
eq(kinds({ ...sana, productions: [] }), 'mov-sin-production', 'movimientos sin produccion (05038036)')
eq(kinds({ ...sana, stockMovements: sana.stockMovements.filter((m) => m.id !== 'm2') }),
  'purchase-sin-mov', 'compra sin movimientos')
eq(kinds({ ...sana, stockMovements: sana.stockMovements.filter((m) => m.id !== 'm3') }),
  'transfer-sin-mov', 'traspaso sin movimientos')
eq(kinds({ ...sana, stockMovements: sana.stockMovements.filter((m) => m.id !== 'm4') }),
  'sale-sin-mov', 'venta sin movimiento (La Patrona)')
eq(kinds({ ...sana, sales: sana.sales.filter((s) => s.id !== 'v1') }), 'mov-sin-sale', 'movimiento sin venta')
eq(kinds({ ...sana, stockMovements: sana.stockMovements.filter((m) => m.id !== 'm5') }),
  'anulacion-sin-mov', 'linea anulada sin su devolucion')
eq(kinds({ ...sana, orderItems: [{ ...sana.orderItems[0], voided: false, voidedAt: null }] }),
  'mov-anulacion-sin-linea', 'devolucion sin su marca de anulada (las 4 de Burger)')

// Lo que NO es rotura.
eq(kinds({ ...sana, sales: [{ ...sana.sales[0], voided: true }], stockMovements: sana.stockMovements.filter((m) => m.id !== 'm4') }),
  '', 'venta anulada sin movimiento no cuenta')
// La venta de mesa (v2) no tiene movimiento 'sale' y NO debe salir: ya cubierto en la base sana.

console.log(`atomicity: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Paso 2: correrla y ver que falla** — módulo no encontrado.

- [ ] **Paso 3: implementación mínima** — `src/lib/atomicity.js`

```js
// ---------------------------------------------------------------------------
// Diagnostico de atomicidad (auditoria Burger Premium, H3-b). PURO, solo lee.
//
// Varios repos escriben el documento y sus movimientos del libro mayor en UNA
// transaccion Dexie (kitchenRepo.produce, purchasesRepo.create,
// transfersRepo.create, salesRepo.create, ordersRepo.voidItem). En un solo
// aparato no puede existir uno sin el otro: nadie borra de esas tablas. Si aqui
// aparece, la sincronizacion partio la transaccion (cursores por coleccion).
// ---------------------------------------------------------------------------
const arr = (x) => (Array.isArray(x) ? x : [])

function pairs(docs, movs, refType, docKind) {
  const out = []
  const docIds = new Set(docs.map((d) => d.id))
  const withMov = new Set(movs.filter((m) => m.refType === refType).map((m) => m.refId))
  for (const d of docs) {
    if (!withMov.has(d.id)) out.push({ kind: `${docKind}-sin-mov`, id: d.id, at: d.createdAt || '', detail: '' })
  }
  const seen = new Set()
  for (const m of movs) {
    if (m.refType !== refType || docIds.has(m.refId) || seen.has(m.refId)) continue
    seen.add(m.refId)
    out.push({ kind: `mov-sin-${docKind}`, id: m.refId, at: m.createdAt || '', detail: '' })
  }
  return out
}

export function findAtomicityBreaks(tables = {}) {
  const movs = arr(tables.stockMovements)
  // Ventas que DEBEN mover stock: vivas y sin orderId (las de mesa nacen con
  // skipStock y su stock lo mueven las lineas con refType 'order'). Un
  // movimiento 'sale' de una venta excluida tampoco es "movimiento sin venta".
  const allSales = arr(tables.sales)
  const excluded = new Set(allSales.filter((s) => s.voided || s.orderId).map((s) => s.id))
  const sales = allSales.filter((s) => !excluded.has(s.id) && arr(s.items).length)
  const saleMovs = movs.filter((m) => !(m.refType === 'sale' && excluded.has(m.refId)))
  const out = [
    ...pairs(arr(tables.productions), movs, 'production', 'production'),
    ...pairs(arr(tables.purchases), movs, 'purchase', 'purchase'),
    ...pairs(arr(tables.transfers), movs, 'transfer', 'transfer'),
    ...pairs(sales, saleMovs, 'sale', 'sale')
  ]
  // Anulacion de linea de mesa: voidItem sella la linea (voidedAt) y su
  // devolucion (createdAt) con el MISMO ts. Esa igualdad es la firma.
  const voids = movs.filter((m) => m.refType === 'order_void')
  const voidKey = (orderId, ts) => `${orderId}|${ts}`
  const movKeys = new Set(voids.map((m) => voidKey(m.refId, m.createdAt)))
  const lineKeys = new Set()
  for (const it of arr(tables.orderItems)) {
    if (!it.voided || !it.voidedAt) continue
    const k = voidKey(it.orderId, it.voidedAt)
    lineKeys.add(k)
    if (!movKeys.has(k)) out.push({ kind: 'anulacion-sin-mov', id: it.id, at: it.voidedAt, detail: it.orderId })
  }
  for (const m of voids) {
    if (!lineKeys.has(voidKey(m.refId, m.createdAt)))
      out.push({ kind: 'mov-anulacion-sin-linea', id: m.id, at: m.createdAt, detail: m.refId })
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}
```

- [ ] **Paso 4: correrla y ver que pasa** — `atomicity: N OK, 0 fallos`.

- [ ] **Paso 5: control negativo** — cambiar `refType === refType` por `true` en `pairs`: los casos
      de rotura deben dejar de detectarse y la suite fallar. Restaurar.

- [ ] **Paso 6: el script** — `docs/auditoria/diagnostico-atomicidad.mjs`

```js
// Diagnostico de atomicidad sobre un RESPALDO (solo lectura, no toca la app).
//   node docs/auditoria/diagnostico-atomicidad.mjs <respaldo.json> [<respaldo2.json> ...]
// Por cada fichero: SHA256, exportedAt, recuento por tipo de rotura y el detalle.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { findAtomicityBreaks } from '../../src/lib/atomicity.js'

const files = process.argv.slice(2)
if (!files.length) { console.error('Uso: node docs/auditoria/diagnostico-atomicidad.mjs <respaldo.json> ...'); process.exit(2) }
for (const f of files) {
  const raw = readFileSync(f)
  const bk = JSON.parse(raw.toString('utf8'))
  const breaks = findAtomicityBreaks(bk.tables || {})
  const by = {}
  for (const b of breaks) by[b.kind] = (by[b.kind] || 0) + 1
  console.log(`\n== ${f}`)
  console.log(`   sha256 ${createHash('sha256').update(raw).digest('hex')}`)
  console.log(`   exportado ${bk.meta?.exportedAt} · esquema ${bk.meta?.schema} · roturas ${breaks.length}`)
  for (const [k, n] of Object.entries(by)) console.log(`   ${k.padEnd(24)} ${n}`)
  for (const b of breaks) console.log(`     ${b.at}  ${b.kind.padEnd(24)} ${b.id} ${b.detail}`)
}
```

- [ ] **Paso 7: control positivo con los respaldos REALES** — correr sobre A1, B y A2 de Burger y el
      de La Patrona (rutas que dé el dueño; verificar antes su SHA256 contra §9.1 y §1 de las actas).
      **Debe reproducir** lo que las actas midieron: en A1, 3 `production-sin-mov`, 1
      `mov-sin-production`, 1 `purchase-sin-mov`, 3 `transfer-sin-mov`; en La Patrona, 8
      `sale-sin-mov`. **Si no cuadra, se para** y se explica la diferencia: o el script o el acta
      están mal, y no se sigue hasta saber cuál.

- [ ] **Paso 8: verificar** — build exit 0; suites en verde; `grep -rn "atomicity" src --include=*.jsx`
      = **0** (nada de la app lo importa: peso del bundle idéntico, comprobarlo en la salida del build).

- [ ] **Paso 9: commit**

```bash
git add src/lib/atomicity.js src/lib/atomicity.test.mjs docs/auditoria/diagnostico-atomicidad.mjs
git commit -m "Auditoria - H3-b: diagnostico de atomicidad de solo lectura sobre respaldos

Modulo puro que lista documentos sin sus movimientos y al reves (producciones,
entradas, traspasos, ventas y anulaciones de mesa) y un script de node que lo
aplica a un respaldo. No entra en el bundle. Auditoria Burger Premium, H3-b.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5 — Verificación global, actas y parada

- [ ] `npm run build` exit 0 y anotar el peso (CSS y chunk principal, gzip) contra 87,66 kB /
      1.002,35 kB (gzip 291,95).
- [ ] Correr **todas** las suites (las 16 + `orderSale`, `resend`, `atomicity` y `ordersRepo`)
      y anotar el total real de aserciones.
- [ ] `git diff --stat ebd957f -- src/db/db.js src/features/sync/collections.js
      src/features/sync/pullEngine.js src/features/sync/syncEngine.js src/features/sync/retryQueue.js
      firestore.rules firestore.indexes.json` → **vacío**.
- [ ] Contar escrituras nuevas a la base en el diff (`.add(`/`.put(`/`.update(`/`.delete(`/`transaction`):
      las **únicas** esperadas son `db.syncState.put` en `forceResend` (tabla **local**, fuera de
      `SYNC_COLLECTIONS`) y `db.orders.update` en `reconcileClosed` (solo `status` y `saleId`, sin
      marcas: no cambia `syncTs`).
- [ ] Revisión de toda la rama con superpowers:requesting-code-review.
- [ ] Actualizar `CLAUDE.md` (lista de suites del bucle de pruebas y su recuento; estado del trabajo)
      y el §10 del acta con lo hecho, **lo que no se pudo garantizar** y las decisiones D1–D4.
- [ ] Commit de documentación. **No fusionar a `main`**: pedir la autorización y la auditoría previa.

---

## Fuera de este plan (necesitan autorización aparte)

- **Punto 5 (H3-c)** — que nada dependa solo del cursor en `pushEngine`. Se decide con la cifra de la
  Task 4. La variante de «mover `setCursorForward` al `.then()`» sigue teniendo la trampa del §10.5.
- **La Patrona §6/§7** — `countsRepo.reject` sin candado de estado y doble aprobación entre
  aparatos. Como dice su §13.6, la línea que falta en `reject` **no** arregla lo observado.
- **La Patrona §8/§9** — nombres duplicados en el catálogo; entrada al área + venta del almacén.
- **`applyBackup` sin LWW** (Burger §4) — cambia la semántica de restaurar: la decide el dueño.

## Lo que este plan NO puede garantizar

- **Nadie habrá ejecutado la app.** Ni un candado disparado en un teléfono, ni un reenvío real contra
  Firestore: la Task 3 solo se prueba hasta el retroceso del cursor; la llamada a Firestore es la de
  siempre y no se ejecuta en node.
- **Que el reenvío repare** si las filas **tampoco** están en el aparato desde el que se reenvía. Por
  eso el script de la Task 4 va antes, en el uso, para elegir el aparato.
- **Cuánto cuesta exactamente el reenvío en lecturas:** N escrituras seguras; si Firestore notifica o
  no a los demás aparatos una escritura con datos idénticos no está medido aquí. Tope: N lecturas por
  aparato conectado.
- **Que el candado H1 hubiera evitado el caso del 21-09:** depende de si la venta ya había llegado al
  aparato que anuló, y eso no se puede determinar (§9.10).
- **El mecanismo exacto** por el que se pierden filas bajo el cursor sigue siendo hipótesis (§9.6).
