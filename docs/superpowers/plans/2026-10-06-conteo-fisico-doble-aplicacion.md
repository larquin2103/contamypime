# Conteo físico: aplicación única, cola completa y avisos — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: superpowers:subagent-driven-development (un implementador
> nuevo por tarea + un revisor nuevo por tarea + revisión de toda la rama al final). Pasos con
> casillas (`- [ ]`).

**Objetivo:** que un conteo físico aprobado se aplique **una sola vez** aunque se apruebe desde dos
teléfonos o con un doble toque, que el mando vea **todos** los conteos pendientes, y que la pantalla
avise de los borradores viejos, los envíos viejos y los conteos simultáneos de la misma ubicación.
Además, que cualquier usuario vea en la Ayuda **qué versión** tiene su teléfono y si es la última.

**Arquitectura:** el ajuste de cada producto pasa a tener id determinista
`count-adj:<conteo>:<producto>` (precedente: `order-void:<línea>` en `ordersRepo.voidItem`) con guarda
de existencia y revalidación del estado del conteo dentro de su transacción. La fusión LWW por id de
la sync deja un solo asiento. Lo demás son lecturas nuevas aditivas (`listPending`, `openAt`), un
módulo puro de avisos y texto en `CountScreen`. La semántica de la diferencia (tarea 5) solo cambia
detrás de una bandera apagada.

**Stack:** React 18, Dexie 4 (IndexedDB), `fake-indexeddb` + esbuild para pruebas con base real.

**Origen (hace de spec):** auditoría del respaldo `respaldo_mypicuadre_2026-10-05.json` (Minimercado
Rikisimo, 06-10-2026) y su validación con simulación de dos aparatos. Hechos medidos que este plan
ataca:
- H-A. El mismo conteo aplicado **dos veces** desde dos teléfonos: lotes de 41 ajustes idénticos
  (Aylin 24-09 03:22 y Ariadna 12:26); `700effcd` aprobado por Yuniel el 20-09 y por Ariadna el 22-09.
- H-B. Doble toque en «Aprobar» en un solo teléfono: dos ajustes (simulado: libro 50, físico 40 →
  queda en 30). `approve` comprueba el estado fuera de toda transacción (`countsRepo.js:188-189`) y
  el botón solo se bloquea con `setBusy` (`CountScreen.jsx:441-445`).
- H-C. `getPending()` devuelve solo el pendiente más reciente (`countsRepo.js:65-69`): el mando no
  ve los demás.
- H-D. Borradores abiertos de 26 a 98 h mientras se vende, y aprobaciones 26 h y 2 días después del
  envío (la aprobación re-deriva y anuló −219 u de ventas en `1e78ee92`).
- H-E. 24 pares de conteos de la misma ubicación abiertos a la vez por usuarios distintos.

---

## Decisiones del dueño que BLOQUEAN tareas (regla 4: no se asume)

| # | Pregunta | Recomendación | Bloquea |
|---|---|---|---|
| D1 | ¿`approve` en **una sola transacción** para todos los productos? | **No.** Contradice F3 («Atomicidad: no tocarlo», `docs/CORRECCION-EXISTENCIAS.md`). El id determinista + la revalidación por producto ya cierran H-A y H-B. Si dices sí, este plan no lo cubre y hay que rehacer la tarea 1. | Tarea 1 |
| D2 | ¿Desde cuántas horas un borrador o un envío es «viejo»? | **8 h** (un turno). El plan usa `COUNT_STALE_HOURS = 8`; si eliges otro número, solo cambia esa constante y su prueba. | Tareas 3 y 4 |
| D3 | ¿Aviso **informativo** de que alguien aprueba su propio conteo? | **Sí, como texto.** Sin bloqueo: un bloqueo encerraría a un dueño único. | Tarea 3, paso del aviso |
| D4 | ¿Qué significa aprobar? (a) «existencia = lo contado, al aprobar» (hoy) o (b) «lo contado al enviar, más lo vendido después». | Bandera **apagada** por defecto, con (b) disponible para Rikisimo. | Tarea 5 entera |
| D5 | ¿Cada teléfono anota su versión en `/devices` y el dueño ve en `/cloud` cuáles faltan por actualizar? | Útil, pero toca la sync: **fuera de este plan**, con su propio plan si se autoriza. La tarea 6 (versión visible en la Ayuda) no depende de esto. | Nada de este plan |

**RESUELTAS por el dueño el 06-10-2026:**
- **D1 = no:** transacción por producto, como está escrito.
- **D2 = 8 h.**
- **D3 = sí:** solo texto, sin bloquear.
- **D4 = sí:** la tarea 5 entra, con la bandera **apagada** por defecto.
- **D5:** queda fuera de este plan.

**Ninguna tarea se ejecuta sin la respuesta a la decisión que la bloquea.** Las tareas 0, 1 (con
D1 = no), 2 y 6 no dependen de nada más.

## Restricciones globales (de `CLAUDE.md`, literales)

- Rama única: `claude/awesome-dirac-484azm`. **NADA a `main`** sin autorización explícita del dueño.
- No afectar la lógica de producción: cambios **aditivos**; el comportamiento por defecto queda
  idéntico al clásico.
- Append-only: nada se borra; **toda mutación actualiza su timestamp**.
- Idioma español en la UI, los comentarios y los commits. Imitar el estilo del código vecino.
- Build limpio (`npm run build`) antes de cada commit. Commits descriptivos. **No crear Pull
  Requests.**
- **Cero cambios** en: `src/db/db.js` (Dexie sigue en v19), `src/features/sync/**`,
  `firestore.rules`, `firestore.indexes.json`, `package.json`, `package-lock.json`, `vite.config.js`,
  `index.html`. Si una tarea parece necesitarlo, **se detiene y se pregunta**.
- Los ajustes conservan `type: 'adjustment'`, la nota `Ajuste por conteo físico (<ubicación>)` y
  `refType`/`refId` en `null`, para que `ledgerKey` (reportes), `atomicity.js` y el submayor salgan
  idénticos.

## Lo que este plan NO puede garantizar (decirlo en el acta, no esconderlo)

1. **Un teléfono sin actualizar** sigue escribiendo ajustes con id aleatorio (`stockRepo.js:25`): si
   uno de los dos aprobadores es viejo, la doble aplicación sigue siendo posible. Esto solo se cierra
   cuando **todos** los teléfonos del negocio se han actualizado.
2. **Si los libros de los dos aparatos difieren** al aprobar, queda una sola fila: la de `createdAt`
   mayor (el reloj más adelantado), no necesariamente la «correcta». Con la subida sin eco
   **encendida**, la nube puede quedarse con la otra versión (`batch.set` incondicional,
   `pushEngine.js`), lo que solo notaría un aparato nuevo o una restauración desde la nube. Esto lo
   leyó el validador en el código; **no se ha observado**. La tarea 5 con la bandera encendida lo
   cierra, porque los dos aparatos escriben la misma cantidad.
3. **La parada cuando el APPROVED o REJECTED llega por la sync a mitad del bucle** se verifica
   leyendo el código y con una mutación de control; **no tiene una prueba determinista**, porque no
   hay forma de intercalar la sync dentro del bucle en `fake-indexeddb` sin trucos frágiles.
4. **No hay pruebas de pantalla** en el proyecto: los cambios de `CountScreen` se validan con build,
   identificadores libres y lectura del diff, no renderizando.
5. **Nadie habrá ejecutado la app en un teléfono.** Código, build y pruebas en node.
   - En concreto, que la tarjeta de versión **salte el precache** del service worker está deducido
     del `sw.js` construido y de la semántica de Workbox, no observado.
   - Si el dueño quiere comprobarlo en un teléfono: con la app abierta, desplegar una versión
     nueva, abrir la Ayuda y ver que avisa «Hay una versión nueva».
6. **Los datos ya dañados de Rikisimo no se tocan** (append-only). El remedio es un conteo nuevo,
   **después** de que todos los teléfonos se actualicen y sincronicen.

## Foco de revisión (entradas que ninguna prueba normal ejercita)

1. Doble toque en «Aprobar» → un solo ajuste por producto. *Prueba C3 (tarea 1).*
2. El ajuste del otro aparato llega **antes** de aprobar aquí → no se escribe otro. *Prueba C6.*
3. Dos aparatos con libros distintos → una sola fila tras la fusión, y la caché igual al libro.
   *Pruebas C4 y C5.*
4. Un aparato calcula delta 0 y el otro ≠ 0 → un solo asiento, nunca dos. *Prueba C11.*
5. Producto borrado o ítem sin contar dentro del conteo → se salta como hoy. *Pruebas C8 y C9.*

## Mapa de ficheros

| Fichero | Tarea | Qué cambia |
|---|---|---|
| `src/repositories/stockRepo.js` | 1 | `record`/`adjust` aceptan un `id` **opcional**; sin él, idéntico (`newId()`). |
| `src/repositories/countsRepo.js` | 1, 2, 4, 5 | `approve` con id determinista + guarda + revalidación; `listPending` y `openAt` nuevos; la bandera en la tarea 5. |
| `src/repositories/countsRepo.test.mjs` | 1, 2, 4, 5 | **Nuevo.** Suite con base real (`fake-indexeddb`, empaquetada con esbuild). |
| `src/lib/countWarnings.js` + `.test.mjs` | 3 | **Nuevo.** Reglas puras de antigüedad y autoaprobación (node directo). |
| `src/features/inventory/CountScreen.jsx` | 2, 3, 4, 5 | Cola de pendientes, avisos, conteos simultáneos y el texto que depende de la bandera. |
| `src/repositories/configRepo.js` | 5 | Getter de la bandera `conteoDiferenciaCongelada`. |
| `src/features/settings/Settings.jsx` | 5 | Interruptor, solo el dueño (la pantalla ya exige `isOwner`). |
| `src/lib/appBuild.js` + `.test.mjs` | 6 | **Nuevo.** Hash del chunk de entrada = versión (node directo). |
| `src/features/help/AppVersionCard.jsx` | 6 | **Nuevo.** Tarjeta «Versión de la app» con comprobación de la última publicada. |
| `src/features/help/HelpScreen.jsx` | 6 | Un `import` y `<AppVersionCard />` al final de la lista. |
| `CLAUDE.md` | 1–7 | Lista de suites en cada tarea; acta y cifras medidas en la 7. |

## Protocolo de validación de CADA tarea (lo ejecuta un subagente revisor NUEVO; no se cita, se ejecuta)

El revisor recibe el texto de su tarea, este protocolo y el diff (`git diff <commit-anterior> HEAD`).
**Rechaza** la tarea si cualquiera de estos puntos falla, y lo dice con la salida del comando:

1. `npm run build` → exit 0.
2. **Todas** las suites (script de la tarea 0) → 0 fallos. Las preexistentes, **byte a byte
   idénticas** a la línea base de la tarea 0 (`diff -r` vacío). Control negativo: añadir un byte a
   una copia de una salida y comprobar que `diff` lo detecta.
3. `git diff --stat <base> HEAD -- src/db/db.js src/features/sync firestore.rules firestore.indexes.json package.json package-lock.json vite.config.js index.html`
   → **vacío**.
4. Líneas borradas en `src/` (`git diff <commit-anterior> HEAD -- src | grep '^-[^-]'`): se leen
   **una a una**; cada una tiene que ser una sustitución en el sitio que la tarea declara.
5. Escrituras nuevas a la base en el diff (`grep -nE '\.(add|put|bulkPut|update|delete|modify|bulkAdd)\(|\.transaction\('`
   sobre las líneas `^+`): solo las que la tarea declara.
6. Identificadores libres = 0 en los ficheros JS/JSX tocados (script de la tarea 0), con su control
   negativo.
7. **Mutaciones de la tarea:** cada mutación listada se aplica, la suite **tiene que fallar**, y se
   revierte con `git checkout -- <fichero>`. `git status --short` limpio al terminar.
8. El revisor contesta qué **no** pudo comprobar.

---

### Tarea 0: Rama, línea base y herramientas (sin tocar código)

**Ficheros:** ninguno del repo. Todo va al scratchpad (`$S`, el directorio temporal de la sesión).

- [ ] **Paso 1: Rama al día y limpia**

```bash
git fetch origin
git checkout claude/awesome-dirac-484azm
git merge --ff-only origin/claude/awesome-dirac-484azm
git status --short        # esperado: vacío
git rev-parse --short HEAD   # anotar como BASE (hoy 0fef676)
```

- [ ] **Paso 2: Script que corre TODAS las suites y guarda cada salida en un fichero**

Crear `$S/corre_suites.sh`. La lista sale de la sección «Pruebas» de `CLAUDE.md`, y el script falla
si encuentra un `*.test.mjs` que no esté en ella:

```bash
#!/usr/bin/env bash
# Uso: corre_suites.sh <repo> <dir_salida>
set -u
R="$1"; O="$2"; mkdir -p "$O"; cd "$R"
NODE=(src/lib/custodyMath src/lib/dates src/lib/productCustodyMath src/lib/remesas src/lib/fichaCosto
  src/lib/fichaLines src/lib/kitchenMath src/lib/orderTotals src/lib/saleRevenue src/lib/unitsConfig
  src/lib/stockLocation src/lib/modalClose src/lib/navSections src/features/sync/retryQueue
  src/features/reports/fichaReports src/features/help/helpContent src/lib/orderSale src/features/sync/resend
  src/lib/atomicity src/lib/convergence src/lib/syncLogPolicy src/features/sync/commitWatch
  src/features/sync/compareResend src/features/sync/compareResendEngine src/lib/dailySalesControl
  src/lib/dailySalesControl.fuzz src/lib/reportCells src/features/sync/deferred src/features/sync/cursorType
  src/features/sync/echoLedger)
BASE=(src/repositories/ordersRepo src/lib/syncLog src/features/reports/dailyControlLocations
  src/features/sync/pullDeferred src/features/backup/backupCursors src/features/backup/backupFlags
  src/features/sync/echoMerge)
FB=(src/features/sync/pushTrace src/features/sync/pushEcho)
# Suites nuevas de este plan: se añaden aquí cuando existan.
[ -f src/lib/countWarnings.test.mjs ] && NODE+=(src/lib/countWarnings)
[ -f src/lib/appBuild.test.mjs ] && NODE+=(src/lib/appBuild)
[ -f src/repositories/countsRepo.test.mjs ] && BASE+=(src/repositories/countsRepo)
fallos=0
for t in "${NODE[@]}"; do n=$(echo "$t" | tr / _); node "$t.test.mjs" > "$O/$n.out" 2>&1 || { echo "FALLA $t"; fallos=1; }; done
for t in "${BASE[@]}"; do n=$(echo "$t" | tr / _)
  npx esbuild "$t.test.mjs" --bundle --platform=node --format=esm --log-level=error --outfile="$O/$n.bundle.mjs" \
   && node "$O/$n.bundle.mjs" > "$O/$n.out" 2>&1 || { echo "FALLA $t"; fallos=1; }; done
for t in "${FB[@]}"; do n=$(echo "$t" | tr / _)
  npx esbuild "$t.test.mjs" --bundle --platform=node --format=esm --log-level=error \
   --alias:firebase/app=./src/features/sync/testing/fakeFirebaseApp.mjs \
   --alias:firebase/auth=./src/features/sync/testing/fakeFirebaseAuth.mjs \
   --alias:firebase/firestore=./src/features/sync/testing/fakeFirestore.mjs \
   --outfile="$O/$n.bundle.mjs" && node "$O/$n.bundle.mjs" > "$O/$n.out" 2>&1 || { echo "FALLA $t"; fallos=1; }; done
rm -f "$O"/*.bundle.mjs
todos=$(git ls-files '*.test.mjs' | sed 's/\.test\.mjs$//' | sort)
listados=$(printf '%s\n' "${NODE[@]}" "${BASE[@]}" "${FB[@]}" | sort)
extra=$(comm -23 <(echo "$todos") <(echo "$listados")); [ -n "$extra" ] && { echo "SUITES SIN LISTAR: $extra"; fallos=1; }
echo "fallos=$fallos"; exit $fallos
```

- [ ] **Paso 3: Línea base**

Run: `bash $S/corre_suites.sh "$PWD" $S/base`
Esperado: `fallos=0` y 39 ficheros `.out`. **Si el comprobador de suites sin listar se queja, se
para y se corrige la lista.** No se continúa con una línea base incompleta.

- [ ] **Paso 4: Script de identificadores libres** (`$S/libres.mjs`, con `@babel/parser` y
`@babel/traverse`, que ya están en `node_modules`)

```js
// Uso: node libres.mjs <fichero>...  → lista los identificadores sin ligar en su ámbito
import fs from 'fs'
import { parse } from '@babel/parser'
import traverseMod from '@babel/traverse'
const traverse = traverseMod.default || traverseMod
const GLOBALES = new Set(['window','document','console','Promise','Date','Math','Number','String','Object','Array','JSON','Set','Map','Error','isNaN','parseFloat','parseInt','undefined','NaN','Infinity','setTimeout','clearTimeout','navigator','localStorage','sessionStorage','Intl','Boolean','Symbol','globalThis','process','structuredClone','alert','confirm','crypto','URL','Blob','fetch','requestAnimationFrame'])
let total = 0
for (const f of process.argv.slice(2)) {
  const ast = parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })
  traverse(ast, { ReferencedIdentifier(p) {
    const n = p.node.name
    if (p.isJSXIdentifier() && /^[a-z]/.test(n)) return
    if (!p.scope.hasBinding(n) && !GLOBALES.has(n)) { total++; console.log(`${f}:${p.node.loc.start.line} ${n}`) }
  } })
}
console.log('TOTAL libres:', total)
```

Run: `node $S/libres.mjs src/repositories/countsRepo.js src/repositories/stockRepo.js src/features/inventory/CountScreen.jsx`
Esperado: `TOTAL libres: 0`. **Control negativo:** copiar `countsRepo.js` a `$S`, añadir
`noExisteNunca()` y comprobar `TOTAL libres: 1`.

- [ ] **Paso 5: Peso de base.** `npm run build`, y anotar el tamaño crudo y en `gzip -9` del chunk
`dist/assets/index-*.js` y el nombre del CSS.

**Validación:** el revisor confirma `fallos=0`, los 39 `.out`, que los dos controles negativos se
dispararon y que el árbol está limpio. Esta tarea no hace commit.

---

### Tarea 1: Aplicación única del ajuste (H-A, H-B) — requiere D1 = no

**Ficheros:**
- Modificar: `src/repositories/stockRepo.js:13-25` y `:59-69`
- Modificar: `src/repositories/countsRepo.js:184-220` (`approve`)
- Crear: `src/repositories/countsRepo.test.mjs`

**Interfaces:**
- Produce: `stockRepo.record({ ..., id })` y `stockRepo.adjust({ ..., id })`, con `id` opcional y
  `null` por defecto (genera `newId()` como hoy). Id del ajuste: `` `count-adj:${countId}:${productId}` ``.

- [ ] **Paso 1: Escribir la suite (falla con el código de hoy)**

`src/repositories/countsRepo.test.mjs`:

```js
// Prueba CON BASE (fake-indexeddb) de la aplicacion UNICA del conteo fisico (auditoria de
// Rikisimo, 06-10-2026). No corre con node directo porque los repos importan sin extension:
//   npx esbuild src/repositories/countsRepo.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/countsRepo.test.bundle.mjs && node <scratch>/countsRepo.test.bundle.mjs
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { countsRepo } from './countsRepo'
import { COUNT_STATUS, MOVEMENT_TYPES } from '../db/constants'
import { mergeIncoming, recomputeStock } from '../features/sync/pullEngine'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
const T = '2026-10-01T10:00:00.000Z'
const LOC = 'Rikisimo'

async function seed({ libro = 50, fisico = 40, extra = [] } = {}) {
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.products.put({ id: 'p1', name: 'Keke', unit: 'u', active: true, stock: libro, stockByLocation: { [LOC]: libro }, updatedAt: T })
  await db.stockMovements.put({ id: 'm0', productId: 'p1', qty: libro, type: MOVEMENT_TYPES.TRANSFER_IN, location: LOC, createdAt: T })
  await db.counts.put({
    id: 'c1', status: COUNT_STATUS.PENDING, location: LOC, createdBy: 'u1', createdAt: T, submittedAt: T, updatedAt: T,
    items: [{ productId: 'p1', name: 'Keke', unit: 'u', systemStock: libro, physicalQty: fisico, counted: true, diff: fisico - libro, semaphore: 'red' }, ...extra]
  })
}
const libro = async (pid = 'p1') =>
  (await db.stockMovements.where('productId').equals(pid).toArray())
    .filter((m) => (m.location || '__almacen') === LOC).reduce((a, m) => a + m.qty, 0)
const ajustes = async () => (await db.stockMovements.toArray()).filter((m) => m.type === MOVEMENT_TYPES.ADJUSTMENT)
const ajenoDe = (qty, createdAt) => ({ id: 'count-adj:c1:p1', productId: 'p1', qty, type: MOVEMENT_TYPES.ADJUSTMENT, refType: null, refId: null, unitCost: null, shiftId: null, userId: 'otro', note: `Ajuste por conteo físico (${LOC})`, location: LOC, createdAt })

// C1. NO REGRESION del camino sano: un ajuste con los mismos campos de siempre y el id nuevo.
await seed()
await countsRepo.approve('c1', 'jefe')
{
  const a = await ajustes()
  ok(a.length === 1, `C1: un ajuste (${a.length})`)
  ok(a[0]?.id === 'count-adj:c1:p1', `C1: id determinista (${a[0]?.id})`)
  ok(a[0]?.qty === -10 && a[0]?.location === LOC && a[0]?.userId === 'jefe', 'C1: qty, ubicacion y autor')
  ok(a[0]?.note === `Ajuste por conteo físico (${LOC})` && a[0]?.refType === null && a[0]?.refId === null, 'C1: nota y ref como hoy')
  ok((await libro()) === 40, 'C1: libro = fisico')
  const p = await db.products.get('p1')
  ok(p.stock === 40 && p.stockByLocation[LOC] === 40, `C1: cache = libro (${p.stock}/${p.stockByLocation[LOC]})`)
  const c = await db.counts.get('c1')
  ok(c.status === COUNT_STATUS.APPROVED && c.approvedBy === 'jefe' && !!c.approvedAt && c.updatedAt > T, 'C1: aprobado y sellado')
}

// C2. Delta 0: no escribe ajuste y aprueba igual que hoy.
await seed({ fisico: 50 })
await countsRepo.approve('c1', 'jefe')
ok((await ajustes()).length === 0, 'C2: sin ajuste')
ok((await db.counts.get('c1')).status === COUNT_STATUS.APPROVED, 'C2: aprobado')

// C3 (H-B). Doble toque: dos approve a la vez -> UN ajuste.
await seed()
await Promise.all([countsRepo.approve('c1', 'jefe'), countsRepo.approve('c1', 'jefe')])
ok((await ajustes()).length === 1, `C3: un solo ajuste con doble toque (${(await ajustes()).length})`)
ok((await libro()) === 40, `C3: libro 40 (${await libro()})`)

// C4 (H-A, caso i). Otro aparato aprobo sin verse, mismo libro: su ajuste llega con el MISMO id.
await seed()
await countsRepo.approve('c1', 'jefe')
{
  const af = await mergeIncoming({ name: 'stockMovements', pk: 'id' }, [ajenoDe(-10, '2026-10-01T12:00:00.000Z')])
  await recomputeStock(af)
  ok((await ajustes()).length === 1, 'C4: una sola fila tras la fusion')
  ok((await libro()) === 40 && (await db.products.get('p1')).stockByLocation[LOC] === 40, 'C4: libro y cache 40')
}

// C5 (caso iii). Libros distintos: el otro calculo -7 y su reloj va por delante -> gana su fila.
await seed()
await countsRepo.approve('c1', 'jefe')
{
  const af = await mergeIncoming({ name: 'stockMovements', pk: 'id' }, [ajenoDe(-7, '2099-01-01T00:00:00.000Z')])
  await recomputeStock(af)
  const a = await ajustes()
  ok(a.length === 1 && a[0].qty === -7, `C5: una fila, la de createdAt mayor (${a.map((m) => m.qty)})`)
  ok((await libro()) === 43 && (await db.products.get('p1')).stockByLocation[LOC] === 43, 'C5: cache = libro')
}

// C6 (caso ii). El ajuste del otro llego ANTES de aprobar aqui: no se escribe otro.
await seed()
{
  const af = await mergeIncoming({ name: 'stockMovements', pk: 'id' }, [ajenoDe(-10, T)])
  await recomputeStock(af)
}
await countsRepo.approve('c1', 'jefe')
ok((await ajustes()).length === 1, `C6: sigue habiendo uno (${(await ajustes()).length})`)
ok((await libro()) === 40, 'C6: libro 40')
ok((await db.counts.get('c1')).status === COUNT_STATUS.APPROVED, 'C6: aprobado')

// C7. Conteo ya aprobado en este aparato: no hace nada (como hoy).
await seed()
await db.counts.update('c1', { status: COUNT_STATUS.APPROVED, approvedBy: 'otro' })
await countsRepo.approve('c1', 'jefe')
ok((await ajustes()).length === 0 && (await db.counts.get('c1')).approvedBy === 'otro', 'C7: no toca un aprobado')

// C8. Producto que ya no existe: se salta, como hoy.
await seed({ extra: [{ productId: 'pX', name: 'Borrado', unit: 'u', systemStock: 3, physicalQty: 0, counted: true, diff: -3 }] })
await countsRepo.approve('c1', 'jefe')
ok((await ajustes()).length === 1 && (await ajustes())[0].productId === 'p1', 'C8: solo el producto existente')

// C9. Item no contado: se salta.
await seed({ extra: [{ productId: 'p2', name: 'Otro', unit: 'u', systemStock: 3, physicalQty: null, counted: false, diff: 0 }] })
await db.products.put({ id: 'p2', name: 'Otro', unit: 'u', active: true, stock: 3, stockByLocation: { [LOC]: 3 }, updatedAt: T })
await countsRepo.approve('c1', 'jefe')
ok((await ajustes()).every((m) => m.productId === 'p1'), 'C9: el no contado no se ajusta')

// C10. stockRepo sin id: sigue generando uno aleatorio (cualquier otro llamador queda igual).
await seed()
{
  const { stockRepo } = await import('./stockRepo')
  const id = await stockRepo.adjust({ productId: 'p1', delta: 1, note: 'x', userId: 'u', location: LOC })
  ok(typeof id === 'string' && !id.startsWith('count-adj:') && id.length > 0, `C10: id aleatorio sin id explicito (${id})`)
}

// C11. Un aparato calcula delta 0 (no escribe) y el otro -3: un solo asiento, nunca dos.
await seed({ fisico: 50 })
await countsRepo.approve('c1', 'jefe')
{
  const af = await mergeIncoming({ name: 'stockMovements', pk: 'id' }, [ajenoDe(-3, '2026-10-01T12:00:00.000Z')])
  await recomputeStock(af)
  ok((await ajustes()).length === 1 && (await libro()) === 47, 'C11: un asiento, el del otro aparato')
}

console.log(`countsRepo: ${pass} OK / ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Paso 2: Comprobar que falla con el código de hoy**

Run: `npx esbuild src/repositories/countsRepo.test.mjs --bundle --platform=node --format=esm --outfile=$S/cr.bundle.mjs && node $S/cr.bundle.mjs`
Esperado: **FALLAN C1** (el id es aleatorio), **C3** (dos ajustes: lo midió el validador, el libro
queda en 30), **C4** y **C5** (dos filas con ids distintos). **PASAN ya** C2, C6, C7, C8, C9, C10 y
C11: en C6 y C11 la re-derivación de hoy da 0 y no escribe. Esos dos casos son **no regresión**, no
prueba del arreglo. Si algo pasa o falla distinto a esto, **se para y se investiga**: o la suite
está mal, o el código no es el que se leyó.

- [ ] **Paso 3: `stockRepo` acepta un id opcional**

En `record`, añadir `id: idIn = null` al final de los parámetros y sustituir `const id = newId()`
por:

```js
    // Id DETERMINISTA opcional (conteo fisico, auditoria de Rikisimo 06-10-2026): quien lo
    // pasa lo usa para que el MISMO asiento escrito desde dos aparatos se funda en uno por la
    // sync (LWW por id). Sin pasarlo, aleatorio como siempre: ningun otro llamador cambia.
    const id = idIn || newId()
```

En `adjust`, añadir `id = null` a la desestructuración y pasar `id` a `this.record({ ... })`.

- [ ] **Paso 4: `approve` con id determinista, guarda y revalidación**

Sustituir el bucle de `approve` (`countsRepo.js:192-211`) por el de abajo. La lectura de fuera, la
nota y el `db.counts.update` final **no cambian**.

```js
    for (const it of c.items) {
      if (!it.counted) continue
      // Id DETERMINISTA por conteo y producto (auditoria de Rikisimo, 06-10-2026): el mismo
      // conteo se aplico DOS veces, aprobado desde dos telefonos que no se habian visto, y un
      // doble toque en "Aprobar" hace lo mismo en uno solo. Con este id, el segundo asiento es
      // el MISMO documento: la guarda de abajo lo evita en el aparato, y la sync (LWW por id)
      // funde en uno los de dos aparatos. Mismo patron que `order-void:` en ordersRepo.
      const movId = `count-adj:${id}:${it.productId}`
      let parar = false
      await db.transaction('rw', db.counts, db.products, db.stockMovements, async () => {
        // Se REVALIDA dentro: si la aprobacion o el rechazo de otro aparato llego por la sync
        // mientras este bucle corria, no se escribe ni un ajuste mas.
        const fresh = await db.counts.get(id)
        if (!fresh || fresh.status !== COUNT_STATUS.PENDING) { parar = true; return }
        if (await db.stockMovements.get(movId)) return
        const p = await db.products.get(it.productId)
        if (!p) return
        // El delta sale del LIBRO MAYOR, no de la cache (F3). Aqui se escribe un
        // asiento append-only que NO se puede deshacer: el conteo de Galletas de soda
        // registro 48 cuando el libro daba -3, se calculo 7-48 y quedo un -41 clavado
        // para siempre. 41 de sus 44 unidades negativas las puso este calculo.
        const sysNow = await stockFromLedger(it.productId, loc)
        const delta = round2(Number(it.physicalQty) - sysNow)
        if (delta !== 0) {
          await stockRepo.adjust({
            id: movId,
            productId: it.productId,
            delta,
            note: `Ajuste por conteo físico (${locNote})`,
            userId: ownerId,
            location: loc
          })
        }
      })
      if (parar) return
    }
```

`stockRepo.record` abre su propia `db.transaction('rw', db.products, db.stockMovements)`. Dentro de
una transacción que ya incluye esas tablas, Dexie la ejecuta como subtransacción de la de fuera. **No
se da por bueno: C1 y C3 lo comprueban** (el asiento existe, la caché se actualizó y el doble toque no
duplica).

- [ ] **Paso 5: La suite pasa**

Run: el comando del paso 2. Esperado: `countsRepo: N OK / 0 fallos`.

- [ ] **Paso 6: Mutaciones (control negativo); cada una se revierte con `git checkout --`**
  - M1. `const movId = newId()` (importando `newId`) en vez del id determinista → **tienen que caer**
    C1, C4 y C5.
  - M2. Quitar `if (await db.stockMovements.get(movId)) return` → **en esta tarea no cae ninguna
    prueba (medido: 28 OK / 0 fallos), y es correcto que no caiga.** Como el delta se re-deriva
    **dentro** de la misma transacción, la segunda llamada ya ve el asiento de la primera y calcula 0:
    mientras `approve` re-derive, la guarda es redundante. En la tarea 5 deja de serlo (medido: con la
    bandera, la suite revienta en F3 con `ConstraintError`). Se anota en el commit para que nadie la
    quite por «muerta».
  - M3. En `stockRepo.record`, ignorar `idIn` (`const id = newId()`) → **tienen que caer** C1, C4 y C5.
  - M4. Quitar la revalidación `if (!fresh || fresh.status !== ...)` → **ninguna prueba cae**. Se
    declara en el acta (punto 3 de «NO puede garantizar»), no se esconde.
  - M5. Mover `stockFromLedger` **fuera** de la transacción (calcular el delta antes del
    `db.transaction`) y quitar la guarda → **la suite revienta en C3 con `ConstraintError`**
    (medido). Las dos llamadas calculan −10 y el segundo `add` choca con el id: el id determinista
    impide el duplicado incluso sin guarda, pero el segundo `approve` **lanzaría un error al
    usuario**. Lo que lo convierte en un no-op silencioso es la guarda junto con la re-derivación
    dentro de la transacción. Así queda demostrado qué pieza hace cada cosa.

- [ ] **Paso 7: Protocolo completo y commit**

Ejecutar el protocolo de validación entero. Después, añadir `src/repositories/countsRepo.test.mjs` a
la lista «base real» de la sección «Pruebas» de `CLAUDE.md` y hacer el commit.

```bash
git add src/repositories/stockRepo.js src/repositories/countsRepo.js src/repositories/countsRepo.test.mjs CLAUDE.md
git commit -m "Conteo fisico (1/5): el ajuste de cada producto se aplica una sola vez (id determinista)

Auditoria de Rikisimo (06-10-2026): el mismo conteo se aplico dos veces desde dos
telefonos, y un doble toque en Aprobar duplica. El ajuste pasa a tener id
count-adj:<conteo>:<producto> con guarda dentro de su transaccion y revalidacion
del estado del conteo. stockRepo acepta un id opcional; sin el, identico.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Validación (revisor):** las escrituras nuevas solo pueden ser la `db.transaction` de `approve`. Las
líneas borradas son la del `const id = newId()` y el bucle sustituido. Las 39 suites previas salen
byte a byte idénticas. M1, M3 y M5 caen; M2 y M4 quedan explicadas y declaradas.

---

### Tarea 2: Cola completa de pendientes para el mando (H-C)

**Ficheros:**
- Modificar: `src/repositories/countsRepo.js` (añadir `listPending` después de `getPending`, `:69`)
- Modificar: `src/features/inventory/CountScreen.jsx:86-133` y `CountReview` (`:429-490`)
- Modificar: `src/repositories/countsRepo.test.mjs` (casos P1–P2)

**Interfaces:** produce `countsRepo.listPending(): Promise<count[]>`, todos los PENDING ordenados por
`createdAt` descendente. `getPending` **no cambia**.

- [ ] **Paso 1: Pruebas (fallan: `listPending` no existe)**

Añadir antes del `console.log` final:

```js
// P1. listPending devuelve TODOS los pendientes, del mas reciente al mas viejo.
await Promise.all(db.tables.map((t) => t.clear()))
for (const [id, t] of [['k1', '2026-10-01T01:00:00.000Z'], ['k2', '2026-10-01T03:00:00.000Z'], ['k3', '2026-10-01T02:00:00.000Z']]) {
  await db.counts.put({ id, status: COUNT_STATUS.PENDING, location: LOC, createdBy: id, createdAt: t, items: [] })
}
await db.counts.put({ id: 'k4', status: COUNT_STATUS.DRAFT, location: LOC, createdBy: 'x', createdAt: T, items: [] })
{
  const l = await countsRepo.listPending()
  ok(l.map((c) => c.id).join() === 'k2,k3,k1', `P1: todos y en orden (${l.map((c) => c.id)})`)
  // P2. getPending sigue devolviendo exactamente el primero de esa lista (no cambia).
  ok((await countsRepo.getPending())?.id === 'k2', 'P2: getPending intacto')
  ok((await countsRepo.getPending('k1'))?.id === 'k1', 'P2: getPending(userId) intacto')
}
```

- [ ] **Paso 2: Comprobar que falla.** Mismo comando. Esperado: falla con `listPending is not a function`.

- [ ] **Paso 3: Implementar `listPending`**

```js
  // TODOS los conteos enviados, del mas reciente al mas viejo (auditoria de Rikisimo,
  // 06-10-2026): `getPending` devuelve solo el primero, y con varios pendientes el mando
  // no veia los demas -cada uno acababa aprobando el suyo-. Solo lectura.
  async listPending() {
    const rows = await db.counts.where('status').equals(COUNT_STATUS.PENDING).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },
```

- [ ] **Paso 4: La pantalla.** En `CountScreen`, justo después de `const pending = useLiveQuery(...)`
(antes de cualquier `return`, por las reglas de los hooks):

```jsx
  // Cola completa del mando: con mas de un pendiente, la revision los lista para que se
  // vean todos. Con uno solo (lo normal) la pantalla queda identica.
  const pendings = useLiveQuery(() => (isManager ? countsRepo.listPending() : []), [isManager], [])
  const [pickId, setPickId] = useState(null)
```

Sustituir la línea `<CountReview count={pending} ownerId={user.id} />` por:

```jsx
      <CountReview
        count={(pickId && pendings.find((p) => p.id === pickId)) || pending}
        ownerId={user.id}
        others={pendings.filter((p) => p.id !== ((pickId && pendings.find((q) => q.id === pickId)) || pending).id)}
        onPick={setPickId}
      />
```

En `CountReview`, cambiar la firma a `function CountReview({ count, ownerId, others = [], onPick })` e
insertar, justo después del `</section>` de la primera tarjeta (la de «Enviado por…»):

```jsx
      {others.length > 0 && (
        <section className="card">
          <p className="warn-text">
            <strong>Hay {others.length} conteo{others.length === 1 ? '' : 's'} pendiente{others.length === 1 ? '' : 's'} más.</strong>{' '}
            Revísalos antes de volver a contar la misma ubicación.
          </p>
          {others.map((o) => (
            <div key={o.id} className="kv">
              <span className="muted">{locationLabel(o.location)} · {formatDateTime(o.submittedAt)}</span>
              <button className="btn btn--sm btn--ghost" onClick={() => onPick(o.id)}>Revisar</button>
            </div>
          ))}
        </section>
      )}
```

Si se aprueba el conteo elegido, `pendings.find` deja de encontrarlo y la pantalla vuelve sola a
`pending`: no hace falta limpiar `pickId`.

- [ ] **Paso 5: Suite en verde y protocolo.** Puntos que el revisor tiene que comprobar:
  - **Escrituras nuevas: 0.**
  - **Con un solo pendiente el render es idéntico:** `others` llega vacío y el bloque nuevo no se
    pinta. Se verifica leyendo el diff, porque el proyecto no tiene pruebas de pantalla (declarado).
  - Identificadores libres = 0 en `CountScreen.jsx`.
  - **Mutación:** `listPending` devuelve `rows` sin ordenar → P1 cae.

- [ ] **Paso 6: Commit** `Conteo fisico (2/5): el mando ve todos los conteos pendientes`, con
cuerpo y `Co-Authored-By`, como en la tarea 1.

---

### Tarea 3: Avisos de antigüedad y de autoaprobación (H-D) — requiere D2 y D3

**Ficheros:**
- Crear: `src/lib/countWarnings.js`, `src/lib/countWarnings.test.mjs`
- Modificar: `CountScreen.jsx` (`CountReview` y la vista de categorías de `CountEditor`, `:372-379`)

**Interfaces:** produce `COUNT_STALE_HOURS`, `hoursSince(iso, nowMs): number`,
`isStale(iso, nowMs, limit?): boolean` e `isSelfApproval(count, approverId): boolean`.

- [ ] **Paso 1: Prueba pura**

```js
// Avisos del conteo fisico: reglas puras. Se corre con node directo.
import { COUNT_STALE_HOURS, hoursSince, isStale, isSelfApproval } from './countWarnings.js'
let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
const N = Date.parse('2026-10-02T12:00:00.000Z')
ok(COUNT_STALE_HOURS === 8, 'umbral D2 = 8 h')
ok(hoursSince('2026-10-02T04:00:00.000Z', N) === 8, '8 h exactas')
ok(hoursSince(null, N) === 0 && hoursSince('basura', N) === 0, 'sin fecha o invalida -> 0')
ok(hoursSince('2026-10-03T00:00:00.000Z', N) === 0, 'fecha futura (reloj adelantado) -> 0, nunca negativo')
ok(isStale('2026-10-02T04:00:00.000Z', N) === true, 'en el umbral ya es viejo')
ok(isStale('2026-10-02T04:00:00.001Z', N) === false, 'un ms antes del umbral no')
ok(isStale('2026-10-01T00:00:00.000Z', N, 48) === false, 'umbral explicito')
ok(isSelfApproval({ createdBy: 'a' }, 'a') === true, 'autoaprobacion')
ok(isSelfApproval({ createdBy: 'a' }, 'b') === false, 'otro aprueba')
ok(isSelfApproval(null, 'a') === false && isSelfApproval({ createdBy: null }, null) === false, 'nulos -> false')
console.log(`countWarnings: ${pass} OK / ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Paso 2:** `node src/lib/countWarnings.test.mjs` → falla porque el módulo no existe.

- [ ] **Paso 3: Implementación**

```js
// Avisos del conteo fisico (auditoria de Rikisimo, 06-10-2026): borradores abiertos 26-98 h
// mientras se vendia y aprobaciones dias despues del envio. Puras: no escriben nada; la
// pantalla solo AVISA, nunca bloquea.
export const COUNT_STALE_HOURS = 8

// Horas transcurridas desde `iso`. Sin fecha, invalida o en el futuro (reloj del otro
// telefono adelantado) da 0: un aviso nunca puede nacer de una fecha rota.
export function hoursSince(iso, nowMs) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return 0
  return Math.max(0, (nowMs - t) / 36e5)
}

export function isStale(iso, nowMs, limit = COUNT_STALE_HOURS) {
  return hoursSince(iso, nowMs) >= limit
}

export function isSelfApproval(count, approverId) {
  return !!count && !!approverId && count.createdBy === approverId
}
```

- [ ] **Paso 4: Pantalla.** Importar en `CountScreen.jsx`:
`import { hoursSince, isStale, isSelfApproval } from '../../lib/countWarnings'`.

En `CountReview`, justo después de la tarjeta de la tarea 2:

```jsx
      {isStale(count.submittedAt, Date.now()) && (
        <p className="warn-text">
          Enviado hace {Math.floor(hoursSince(count.submittedAt, Date.now()))} h. Al aprobar, la existencia
          queda igual a lo contado entonces: lo vendido desde el envío se da por no vendido.
        </p>
      )}
      {isSelfApproval(count, ownerId) && (
        <p className="muted">Vas a aprobar un conteo que hiciste tú.</p>
      )}
```

(El segundo bloque solo entra si D3 = sí.) En `CountEditor`, en la vista de categorías, justo
después de `<p className="muted">Ubicación: …</p>`:

```jsx
      {isStale(draft.createdAt, Date.now()) && (
        <p className="warn-text">
          Este conteo lleva {Math.floor(hoursSince(draft.createdAt, Date.now()))} h abierto. Si cuentas un
          producto y después se vende, su diferencia saldrá mal: cuenta y envía en la misma sesión.
        </p>
      )}
```

- [ ] **Paso 5: Protocolo.**
  - `countWarnings` se añade a la lista NODE del script (la condición `[ -f ]` ya lo hace) y a la
    sección «Pruebas» de `CLAUDE.md`.
  - **Escrituras nuevas: 0.**
  - Mutación: `>=` → `>` en `isStale` → cae «en el umbral ya es viejo».
  - Mutación: quitar `Math.max(0, …)` → cae «fecha futura».

- [ ] **Paso 6: Commit** `Conteo fisico (3/5): avisos de borrador viejo, envio viejo y autoaprobacion`.

---

### Tarea 4: Aviso de otro conteo abierto en la misma ubicación (H-E) — requiere D2

**Ficheros:** `countsRepo.js` (añadir `openAt`), `countsRepo.test.mjs` (casos O1–O2) y
`CountScreen.jsx` (vista de inicio, `:166-215`).

**Interfaces:** produce `countsRepo.openAt(location, exceptUserId): Promise<count[]>`: los DRAFT y
PENDING de esa ubicación cuyo creador no es `exceptUserId`, del más reciente al más viejo.

- [ ] **Paso 1: Pruebas**

```js
// O1. openAt: borradores y pendientes de ESA ubicacion de OTROS usuarios.
await Promise.all(db.tables.map((t) => t.clear()))
await db.counts.bulkPut([
  { id: 'a', status: COUNT_STATUS.DRAFT, location: LOC, createdBy: 'yo', createdAt: '2026-10-01T01:00:00.000Z', items: [] },
  { id: 'b', status: COUNT_STATUS.DRAFT, location: LOC, createdBy: 'ana', createdAt: '2026-10-01T02:00:00.000Z', items: [] },
  { id: 'c', status: COUNT_STATUS.PENDING, location: LOC, createdBy: 'eva', createdAt: '2026-10-01T03:00:00.000Z', items: [] },
  { id: 'd', status: COUNT_STATUS.APPROVED, location: LOC, createdBy: 'eva', createdAt: T, items: [] },
  { id: 'e', status: COUNT_STATUS.DRAFT, location: 'Otra', createdBy: 'ana', createdAt: T, items: [] },
  { id: 'f', status: COUNT_STATUS.DRAFT, createdBy: 'ana', createdAt: T, items: [] }
])
ok((await countsRepo.openAt(LOC, 'yo')).map((c) => c.id).join() === 'c,b', 'O1: solo otros, abiertos, de esa ubicacion')
// O2. Sin location en la fila = almacen (como en todo el repo).
ok((await countsRepo.openAt('__almacen', 'yo')).map((c) => c.id).join() === 'f', 'O2: sin location = almacen')
```

- [ ] **Paso 2:** comprobar que falla (`openAt is not a function`).

- [ ] **Paso 3: Implementar**

```js
  // Conteos ABIERTOS (borrador o enviado) de una ubicacion, de OTROS usuarios (auditoria de
  // Rikisimo: hasta cuatro personas contaban la misma area a la vez). Solo lectura: la
  // pantalla avisa, no bloquea -un borrador abandonado de otro telefono no se puede borrar
  // (append-only) y un candado dejaria la ubicacion sin poder contarse-.
  async openAt(location, exceptUserId = null) {
    const rows = await db.counts.where('status').anyOf(COUNT_STATUS.DRAFT, COUNT_STATUS.PENDING).toArray()
    return rows
      .filter((r) => (r.location || WAREHOUSE) === location && r.createdBy !== exceptUserId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },
```

- [ ] **Paso 4: Pantalla.** En `CountScreen`, todos los hooks de esta tarea van **después** de
`const sellerCountLoc = …` (`:112`, porque el efecto la usa) y **antes** del primer `return`
(`if (pending === undefined …`, `:114`). Si no, se rompe la regla de los hooks:

```jsx
  // Usuarios para nombrar a quien tiene otro conteo abierto; los INACTIVOS no se nombran
  // (su borrador viejo no lo puede cerrar nadie y el aviso quedaria fijo para siempre).
  const users = useLiveQuery(() => usersRepo.list(), [], [])
```

`targetLoc` se calcula **después** de varios `return`, así que la consulta no puede ir junto a
`hasItems`. Se resuelve en la misma zona de hooks: `const [openOthers, setOpenOthers] = useState([])`,
seguido de un efecto que se recalcula cuando cambian `countLoc`, `sellerCountLoc` o `isManager`:

```jsx
  useEffect(() => {
    let vivo = true
    const loc = isManager ? countLoc : sellerCountLoc
    countsRepo.openAt(loc, user.id).then((r) => { if (vivo) setOpenOthers(r) })
    return () => { vivo = false }
  }, [isManager, countLoc, sellerCountLoc, user.id])
```

Dentro de la `section.card` de inicio, antes del `{!hasItems ? …}`:

```jsx
        {openOthers
          .filter((o) => users.find((u) => u.id === o.createdBy)?.active !== false)
          .map((o) => (
            <p key={o.id} className="warn-text">
              {users.find((u) => u.id === o.createdBy)?.name || 'Otro usuario'} tiene un conteo{' '}
              {o.status === 'pending' ? 'enviado' : 'abierto'} de esta ubicación desde {formatDateTime(o.createdAt)}.
              Contar a la vez la misma ubicación descuadra las existencias.
            </p>
          ))}
```

`sellerCountLoc` ya existe (`:112`); `useEffect` ya está importado (`:1`). Con la cola vacía (lo
normal) no se pinta nada.

- [ ] **Paso 5: Protocolo.**
  - **Escrituras nuevas: 0.**
  - Mutación: quitar `&& r.createdBy !== exceptUserId` → O1 cae.
  - Mutación: quitar `|| WAREHOUSE` → O2 cae.
  - **Limitación declarada:** el efecto no es una consulta viva. Un conteo que otro teléfono abra
    *mientras* esta pantalla está abierta no aparece hasta que se cambia de ubicación o se vuelve a
    entrar.

- [ ] **Paso 6: Commit** `Conteo fisico (4/5): aviso de otro conteo abierto en la misma ubicacion`.

---

### Tarea 5: Diferencia congelada al enviar, detrás de una bandera — requiere D4 y la tarea 1 hecha

**Por qué va detrás de la tarea 1, siempre:** sin la guarda del id, un segundo aprobador que ya tiene
los ajustes del primero **duplicaría**. Hoy, en cambio, la re-derivación le da 0 (medido por el
validador).

**Ficheros:** `configRepo.js`, `countsRepo.js` (`approve`), `countsRepo.test.mjs` (casos F1–F3),
`Settings.jsx` (sección nueva dentro del grupo «turno») y `CountScreen.jsx` (texto del aviso de la
tarea 3).

**Interfaces:** produce `configRepo.getConteoDiferenciaCongelada(): Promise<boolean>`, clave de
config `conteoDiferenciaCongelada`, que **no se escribe** hasta que el dueño la toque. Sincroniza como
cualquier clave de `config` (LWW de la clave entera) y viaja en el respaldo, igual que
`bajadaFiltrada`.

- [ ] **Paso 1: Pruebas**

```js
// F1. Bandera AUSENTE: approve re-deriva como hoy (una venta tras el envio se "deshace").
await seed()
await db.stockMovements.put({ id: 'v1', productId: 'p1', qty: -2, type: MOVEMENT_TYPES.SALE_OUT, location: LOC, createdAt: '2026-10-01T11:00:00.000Z' })
await countsRepo.approve('c1', 'jefe')
ok((await libro()) === 40, `F1: sin bandera, libro = fisico (${await libro()})`)
// F2. Bandera ENCENDIDA: se aplica la diferencia del envio; la venta posterior se respeta.
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: true, updatedAt: T })
await db.stockMovements.put({ id: 'v1', productId: 'p1', qty: -2, type: MOVEMENT_TYPES.SALE_OUT, location: LOC, createdAt: '2026-10-01T11:00:00.000Z' })
await countsRepo.approve('c1', 'jefe')
ok((await libro()) === 38 && (await ajustes())[0].qty === -10, `F2: con bandera, fisico - venta posterior (${await libro()})`)
// F3. Bandera encendida + doble aprobacion: sigue habiendo UN ajuste (la guarda de la tarea 1).
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: true, updatedAt: T })
await Promise.all([countsRepo.approve('c1', 'jefe'), countsRepo.approve('c1', 'jefe')])
ok((await ajustes()).length === 1, 'F3: un ajuste con bandera y doble toque')
// F4. Valor no booleano que llegue por la sync (p.ej. 'si'): se lee como APAGADA.
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: 'si', updatedAt: T })
await countsRepo.approve('c1', 'jefe')
ok((await libro()) === 40, 'F4: solo `true` enciende')
```

- [ ] **Paso 2:** comprobar que fallan **F2** (sale 40) y **F3** si lo hace; F1 y F4 pasan ya.

- [ ] **Paso 3: Getter** (`configRepo.js`, junto a `getSemaphoreConfig`)

```js
  // Conteo fisico (D4, auditoria de Rikisimo 06-10-2026): con la bandera, aprobar aplica la
  // diferencia CALCULADA AL ENVIAR (lo vendido despues se respeta); sin ella, la de siempre
  // (la existencia queda igual a lo contado). Solo `true` la enciende: un valor raro que llegue
  // por la sync cae al comportamiento clasico.
  async getConteoDiferenciaCongelada() {
    return (await this.get('conteoDiferenciaCongelada', false)) === true
  },
```

- [ ] **Paso 4: `approve`.** Antes del bucle:
`const congelada = await configRepo.getConteoDiferenciaCongelada()`. Dentro de la transacción,
sustituir las dos líneas del delta por:

```js
        const delta = congelada
          ? round2(Number(it.diff) || 0)
          : round2(Number(it.physicalQty) - (await stockFromLedger(it.productId, loc)))
```

y borrar la línea `const sysNow = ...`, que ya no se usa. El comentario de F3 se queda y gana una
línea: «Con `conteoDiferenciaCongelada` se aplica `it.diff`, que `submit` ya calculó contra el
libro».

- [ ] **Paso 5: Interruptor.** En `Settings.jsx`, añadir `<CountRulesSection />` dentro de
`<Section id="turno" …>`, después de `<SemaphoreSection />`, y la función:

```jsx
// Conteo fisico: que significa APROBAR (D4, auditoria de Rikisimo 06-10-2026). Apagado por
// defecto = comportamiento de siempre. Solo el dueño (la pantalla entera exige isOwner).
function CountRulesSection() {
  const on = useLiveQuery(() => configRepo.getConteoDiferenciaCongelada(), [], undefined)
  if (on === undefined) return null
  return (
    <section className="card">
      <h3>Conteo físico</h3>
      <p className="muted">
        Apagado: al aprobar, la existencia queda igual a lo contado. Encendido: se aplica la diferencia
        que había al enviar el conteo, y lo vendido entre el envío y la aprobación se respeta.
      </p>
      <div className="kv">
        <span className="muted">Respetar las ventas posteriores al envío</span>
        <button
          className={`btn btn--sm ${on ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => configRepo.set('conteoDiferenciaCongelada', !on)}
        >
          {on ? 'Activado ✓' : 'Desactivado'}
        </button>
      </div>
    </section>
  )
}
```

`configRepo.set` ya sella `updatedAt` (`configRepo.js:12-14`: `put({ key, value, updatedAt: now() })`,
verificado al escribir el plan).

- [ ] **Paso 6: El aviso de la tarea 3 no puede mentir con la bandera encendida.** En `CountReview`:
`const congelada = useLiveQuery(() => configRepo.getConteoDiferenciaCongelada(), [], false)`. El
texto del envío viejo pasa a ser:

```jsx
          Enviado hace {Math.floor(hoursSince(count.submittedAt, Date.now()))} h.{' '}
          {congelada
            ? 'Se aplicará la diferencia que había al enviarlo; lo vendido desde entonces se respeta.'
            : 'Al aprobar, la existencia queda igual a lo contado entonces: lo vendido desde el envío se da por no vendido.'}
```

- [ ] **Paso 7: Protocolo.**
  - Escrituras nuevas: solo `configRepo.set` en el interruptor.
  - Mutación: `=== true` → `!!` en el getter → F4 cae.
  - Mutación: forzar `congelada = true` → F1 cae.
  - Mutación: quitar la guarda de la tarea 1 con la bandera encendida → la suite revienta en F3 con
    `ConstraintError` (medido al validar el plan).
  - **Declarar en el acta:** un teléfono sin actualizar ignora la bandera y sigue re-derivando; en un
    negocio a medio actualizar conviven los dos criterios.

- [ ] **Paso 8: Commit** `Conteo fisico (5/5): diferencia congelada al enviar, detras de una bandera apagada`.

---

### Tarea 6: Versión de la app visible para todos, con comprobación de «¿es la última?» (BASE)

**Por qué entra aquí:** el arreglo de la tarea 1 solo protege del todo cuando **todos** los teléfonos
del negocio están actualizados (punto 1 de «NO puede garantizar»). Hoy nadie puede saber qué versión
tiene su teléfono.

**Lo que hay hoy (verificado):**
- `package.json` dice `"version": "0.1.0"` desde el 21-06-2026 y **nunca ha cambiado**
  (`git log -S'"version":' -- package.json` da un solo commit). Es lo que ya imprimen `/errors` y el
  registro de la sync (`errorLog.js:2`, `syncLog.js:2`). **No sirve para distinguir builds.**
- Lo que sí cambia en cada build es el nombre del chunk principal: `index.html` construido lleva
  `<script type="module" crossorigin src="/assets/index-B2nIvllc.js">` (`dist/index.html:10`, build
  de hoy). Ese hash **es** la versión.
- `firebase.json` sirve `/index.html` con `Cache-Control: no-cache`. Pero el service worker la
  **precachea** (`dist/sw.js`: `precacheAndRoute([... {url:"index.html", ...}], {})`) y además
  registra una `NavigationRoute` hacia ella.

**Diseño (sin tocar `vite.config.js`, `package.json` ni la sync):**
- **Versión en ejecución:** el hash del `<script type="module" src="/assets/index-….js">` del propio
  documento.
- **Versión publicada:** `fetch('/index.html?version=<ahora>', { cache: 'no-store' })`.
  - El parámetro `version` no está en `ignoreURLParametersMatching`. Workbox, por defecto, solo
    ignora `utm_*` y `fbclid` (`precacheAndRoute(..., {})` no pasa opciones), así que la ruta de
    precache no casa.
  - Un `fetch()` no es una navegación, así que la `NavigationRoute` tampoco casa: la petición va a
    la red.
  - **Esto está deducido de la semántica de Workbox y del `sw.js` construido, NO observado en un
    teléfono** (se añade al acta).
- **Dónde:** al final de la **Ayuda** (`/help`). Es la única pantalla que tienen en el Inicio los
  **cuatro** roles (`Home.jsx:465, 472, 529, 580`) y su ruta no tiene compuerta de rol
  (`router.jsx:93`).
- **Es BASE, sin licencia:** es infraestructura, no una función que se venda, como el tema o los
  avatares.
- **Cambio visible:** una tarjeta nueva en la Ayuda. **Ningún dato, ninguna escritura, ninguna
  colección.** El coste de red es un `index.html` (~1 KB) al abrir la Ayuda con conexión. Nada de
  Firestore.

**Ficheros:**
- Crear: `src/lib/appBuild.js`, `src/lib/appBuild.test.mjs` (node directo)
- Crear: `src/features/help/AppVersionCard.jsx`
- Modificar: `src/features/help/HelpScreen.jsx` (un `import` y una línea antes del `</div>` final de
  la vista de lista, `:144`)

**Interfaces:** produce `buildIdFromHtml(html): string|null`, `buildIdFromSrc(src): string|null` y
`buildStatus(running, latest): 'al-dia'|'nueva'|'desconocida'`.

- [ ] **Paso 1: Prueba pura** (`src/lib/appBuild.test.mjs`). El fixture es el `index.html` real del
build de hoy, copiado literal:

```js
// Version de la app: reglas puras. Se corre con node directo.
import { buildIdFromHtml, buildIdFromSrc, buildStatus } from './appBuild.js'
let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
// Fragmento LITERAL de dist/index.html (build del 06-10-2026): script, css y el registro del sw.
const HTML = `    <script type="module" crossorigin src="/assets/index-B2nIvllc.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-B34NE6G1.css">
  <link rel="manifest" href="/manifest.webmanifest"><script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script></head>`
ok(buildIdFromHtml(HTML) === 'B2nIvllc', `hash del index.html real (${buildIdFromHtml(HTML)})`)
ok(buildIdFromHtml('<link href="/assets/index-B34NE6G1.css">') === null, 'el CSS no cuenta como version')
ok(buildIdFromHtml('<script src="/assets/index.esm-D9CbOI2C.js"></script>') === null, 'otros chunks (index.esm-) no cuentan')
ok(buildIdFromHtml('<script type="module" src="/src/main.jsx"></script>') === null, 'servidor de desarrollo -> null')
ok(buildIdFromHtml('') === null && buildIdFromHtml(null) === null, 'vacio o nulo -> null')
ok(buildIdFromSrc('https://mypicuadre.web.app/assets/index-B2nIvllc.js') === 'B2nIvllc', 'src absoluto del documento')
ok(buildIdFromSrc('/assets/index-Ab_c-12.js') === 'Ab_c-12', 'hash con _ y -')
ok(buildIdFromSrc(undefined) === null, 'sin src -> null')
ok(buildIdFromSrc('/assets/index-B34NE6G1.css') === null, 'un src .css no es la version (ENTRY exige .js)')
ok(buildStatus('B2nIvllc', 'B2nIvllc') === 'al-dia', 'iguales -> al dia')
ok(buildStatus('B2nIvllc', 'Zz99yyXX') === 'nueva', 'distintos -> hay una nueva')
ok(buildStatus(null, 'B2nIvllc') === 'desconocida' && buildStatus('B2nIvllc', null) === 'desconocida', 'si falta uno -> desconocida, nunca "al dia"')
console.log(`appBuild: ${pass} OK / ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Paso 2:** `node src/lib/appBuild.test.mjs` → falla porque el módulo no existe.

- [ ] **Paso 3: Implementación** (`src/lib/appBuild.js`)

```js
// Version de la app (auditoria de Rikisimo, 06-10-2026). `package.json` dice 0.1.0 desde
// junio y no distingue builds; lo que SI cambia en cada build es el nombre del chunk de
// entrada que Vite escribe en index.html (/assets/index-<hash>.js). Ese hash ES la version.
// Puras: no tocan el DOM ni la red; la tarjeta de la Ayuda les pasa el texto.
const ENTRY = /\/assets\/index-([A-Za-z0-9_-]+)\.js/

export function buildIdFromSrc(src) {
  const m = ENTRY.exec(String(src || ''))
  return m ? m[1] : null
}

// Hash del chunk de entrada dentro de un index.html. Solo cuenta el <script>: el CSS
// (index-*.css) y los demas chunks (index.esm-*.js) no son la version.
export function buildIdFromHtml(html) {
  const tags = String(html || '').match(/<script\b[^>]*\bsrc="[^"]*"[^>]*>/g) || []
  for (const t of tags) {
    const id = buildIdFromSrc(/\bsrc="([^"]*)"/.exec(t)[1])
    if (id) return id
  }
  return null
}

// Sin uno de los dos no se puede afirmar que esta al dia: 'desconocida', nunca 'al-dia'.
export function buildStatus(running, latest) {
  if (!running || !latest) return 'desconocida'
  return running === latest ? 'al-dia' : 'nueva'
}
```

- [ ] **Paso 4: La tarjeta** (`src/features/help/AppVersionCard.jsx`)

```jsx
import { useEffect, useState } from 'react'
import { buildIdFromSrc, buildIdFromHtml, buildStatus } from '../../lib/appBuild'

// Version de la app en este telefono y si es la ultima publicada (auditoria de Rikisimo,
// 06-10-2026: un arreglo de la sync solo protege cuando TODOS los telefonos estan al dia).
// Solo LEE: el index.html publicado, con un parametro que ninguna ruta del service worker
// reconoce, para que lo responda la red y no el precache. No escribe nada.
export function AppVersionCard() {
  const script = document.querySelector('script[type="module"][src*="/assets/index-"]')
  const running = buildIdFromSrc(script?.src)
  const [latest, setLatest] = useState(undefined) // undefined = comprobando; null = no se pudo

  useEffect(() => {
    let vivo = true
    if (!running || !navigator.onLine) { setLatest(null); return }
    fetch(`/index.html?version=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => { if (vivo) setLatest(buildIdFromHtml(html)) })
      .catch(() => { if (vivo) setLatest(null) })
    return () => { vivo = false }
  }, [running])

  const estado = latest === undefined ? 'comprobando' : buildStatus(running, latest)
  return (
    <section className="card">
      <div className="kv">
        <span className="muted">Versión de la app</span>
        <strong>{running || 'desarrollo'}</strong>
      </div>
      {estado === 'comprobando' && <p className="muted">Comprobando si es la última…</p>}
      {estado === 'al-dia' && <p className="ok-text">Tienes la última versión ✓</p>}
      {estado === 'nueva' && (
        <p className="warn-text">
          Hay una versión nueva ({latest}). Cierra la app del todo y vuelve a abrirla con internet.
        </p>
      )}
      {estado === 'desconocida' && running && (
        <p className="muted">Sin conexión: no se pudo comprobar si es la última.</p>
      )}
    </section>
  )
}
```

- [ ] **Paso 5: Montarla.** En `HelpScreen.jsx`, añadir
`import { AppVersionCard } from './AppVersionCard'` y, en la vista de lista, `<AppVersionCard />`
justo antes del `</div>` que cierra `<div className="screen">` (después del `sections.map(...)`).
Solo en la vista de lista, no en la de un artículo.

- [ ] **Paso 6: Validación con el build REAL** (además del protocolo):
  - `npm run build`, y luego
    `node -e "import('./src/lib/appBuild.js').then(m=>console.log(m.buildIdFromHtml(require('fs').readFileSync('dist/index.html','utf8'))))"`.
    Tiene que imprimir el hash del `index-*.js` que acaba de salir en `dist/assets` (comparar con
    `ls dist/assets/index-*.js`). Así la regla se comprueba contra el build de ese día, no contra
    el fixture.
  - `grep -c 'index.html' dist/sw.js` y leer la llamada `precacheAndRoute(...)`: tiene que seguir
    terminando en `,{})` (sin `ignoreURLParametersMatching` propio). Si cambiara, el bypass del
    precache deja de estar justificado y **se para**.
  - **Escrituras nuevas: 0.** Ficheros sensibles: vacío (no se toca `vite.config.js`).
  - Mutación: quitar `\.js` de `ENTRY` → cae «un src .css no es la versión».
    - Ojo: «el CSS no cuenta» **no** la caza, porque `buildIdFromHtml` solo mira `<script>`.
    - Medido al validar el plan: sin la prueba de `.css`, esta mutación pasaba en verde.
  - Mutación: `buildStatus` que devuelva `'al-dia'` si falta uno → cae «si falta uno».
- [ ] **Paso 7: Commit**
  `Version de la app visible en la Ayuda, con aviso de version nueva (base)`.

**Fuera de este plan (decisión D5 del dueño):** que cada teléfono anote su versión en `/devices` y
que el dueño vea en `/cloud` qué aparatos siguen sin actualizar. Sería lo más útil antes de volver a
contar, pero toca `src/features/sync/deviceRegistry.js`, que este plan prohíbe tocar (restricciones
globales). Si se autoriza, va en su propio plan, después de leer ese fichero entero.

### Tarea 7: Auditoría de toda la rama y acta (revisor NUEVO, el modelo más capaz)

- [ ] **Paso 1:** script de suites sobre la rama → `fallos=0`. Las 39 preexistentes, **byte a byte
idénticas** a `$S/base` (`diff -r`, con control negativo).
- [ ] **Paso 2: Equivalencia con `main`.** Montar un worktree de `origin/main`
(`git worktree add $S/wt-main origin/main`) y correr el script en los dos árboles. Las suites que
existen en los dos tienen que salir idénticas.
- [ ] **Paso 3:** la comprobación de ficheros sensibles (punto 3 del protocolo) contra `BASE` →
vacía.
- [ ] **Paso 4: Líneas borradas y escrituras nuevas** de toda la rama, leídas una a una contra lo que
declara cada tarea.
- [ ] **Paso 5: Identificadores libres = 0** en `stockRepo.js`, `countsRepo.js`, `countWarnings.js`,
`CountScreen.jsx`, `configRepo.js`, `Settings.jsx`, `appBuild.js`, `AppVersionCard.jsx` y
`HelpScreen.jsx`, con su control negativo.
- [ ] **Paso 6: Peso.** Construir los dos árboles y medir el chunk con `gzip -9`. Comprobar que el
nombre de hash del CSS es el mismo, o explicar por qué cambia.
- [ ] **Paso 7: Convivencia de versiones.** Leído en el código de `origin/main`, no razonado de
memoria:
  - **(a)** un teléfono viejo recibe un ajuste `count-adj:…` → `mergeIncoming` lo trata como
    cualquier fila y `recomputeStock` lo suma: no interpreta el id.
  - **(b)** un teléfono viejo ignora `conteoDiferenciaCongelada`.
  - **(c)** el reporte de submayor y `atomicity.js` clasifican igual un ajuste con id determinista.
- [ ] **Paso 8: Acta en `CLAUDE.md`**, con:
  - qué se cambió;
  - cifras medidas (suites, aserciones, peso);
  - las mutaciones cazadas;
  - el apartado «NO puede garantizar» de este plan, entero;
  - el orden operativo: **actualizar TODOS los teléfonos de Rikisimo antes de volver a contar**.
  
  Commit: `Acta - conteo fisico: aplicacion unica, cola y avisos`.
- [ ] **Paso 9: Parar.** Ni fusionar a `main`, ni desplegar, ni crear PR. El dueño lo decide con
el acta delante.

---

## Prevalidación del plan (06-10-2026, EJECUTADA sobre una copia de `src`, el repo no se tocó)

- **La suite de la tarea 1 contra el código de hoy:** 16 OK / 7 fallos. Fallan exactamente C1, C3
  (libro 30), C4 y C5; las demás pasan, como predice el paso 2.
- **El código del plan** (tareas 1, 2, 4 y 5 en el repo, más la 3) se aplicó a una copia de `src`
  con finales de línea normalizados: `countsRepo` **32 OK / 0 fallos** (C, P, O y F) y
  `countWarnings` **10 OK / 0 fallos**.
- **Mutaciones medidas sobre esa copia:**
  - M1 y M3 → 6 fallos (C1, C4 ×2, C5 ×2 y F3);
  - M2 → 0 fallos en el ámbito de la tarea 1 y `ConstraintError` con el bloque F;
  - M4 → 0 fallos (declarado);
  - M5 → `ConstraintError` en C3.
- **Tarea 6, validada fuera del repo:**
  - `appBuild` da **12 OK / 0 fallos**;
  - `buildIdFromHtml` sobre el `dist/index.html` real devuelve `B2nIvllc`, que es el
    `dist/assets/index-B2nIvllc.js` existente;
  - la mutación de `buildStatus` cae;
  - la de `\.js` **no caía**, y se añadió la prueba que la caza (ahora 11/1);
  - `AppVersionCard.jsx` compila con esbuild (JSX automático) y tiene 0 identificadores libres, con
    control negativo (1 libre al inyectar uno).
- **NO se prevalidó:** el build, las pantallas (tareas 2–5 en `CountScreen`/`Settings`), las suites
  preexistentes con el cambio ni el peso. Eso lo hace cada revisor al ejecutar.
- **Ojo al implementar:** el repo usa **CRLF** (`core.autocrlf=true`). Un parche por sustitución de
  texto tiene que contar con ello.

## Autorrevisión del plan (hecha al escribirlo)

- **Cobertura:**
  - H-A y H-B → tarea 1;
  - H-C → tarea 2;
  - H-D → tareas 3 y 5;
  - H-E → tarea 4;
  - saber si un teléfono está actualizado (condición del punto 1 de «NO puede garantizar») →
    tarea 6.
  
  El punto (b) de la validación (candado por ubicación) se descartó a favor del aviso, por el
  riesgo de dejar la ubicación sin poder contarse.
- **Nombres:** `listPending`, `openAt`, `getConteoDiferenciaCongelada`, `COUNT_STALE_HOURS`,
  `hoursSince`, `isStale`, `isSelfApproval` y `count-adj:<conteo>:<producto>` se usan igual en todas
  las tareas.
- **Lo que este plan NO hace, a propósito:**
  - no toca `notificationService` (lee `items.diff`, que no cambia);
  - no repara los datos ya dañados;
  - no añade el cerrojo síncrono de pantalla (`createGate`): la guarda por id ya cierra el doble
    toque, y C3 lo prueba.
