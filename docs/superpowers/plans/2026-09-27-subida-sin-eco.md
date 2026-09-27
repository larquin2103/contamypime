# Subida sin eco — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que un aparato deje de volver a subir a Firestore las filas que acaba de bajar de otro
aparato sin haberlas tocado, tras una bandera del negocio apagada por defecto, sin que ningún cambio
local deje de subir.

**Architecture:** un módulo puro en memoria (`echoLedger.js`) anota la versión (id + `syncTs`) de
cada fila que `mergeIncoming` mete en Dexie. `doPush` se salta un candidato solo si su versión es
idéntica a la anotada y la bandera `config.subidaSinEco` está encendida. El cursor de subida avanza
exactamente como hoy. Un panel en `/cloud` enciende y apaga la bandera y muestra un contador.

**Tech Stack:** React 18 + Vite 6, Dexie 4, SDK de Firebase 12 (solo por import dinámico), node 24
para las suites, `fake-indexeddb` y el esbuild de Vite para las suites con base real.

**Spec:** `docs/superpowers/specs/2026-09-27-subida-sin-eco-design.md` (aprobada por el dueño el
27-09-2026). Leerla entera antes de empezar. Contexto: `CLAUDE.md`, sección «Estado del trabajo
(27-09-2026) — reducción de la cuota de Firestore (F1 + F2)» y su «Auditoría previa a `main`».

## Validación del plan (27-09-2026, EJECUTADA en un worktree desechable, ya borrado)

Antes de pedir la aprobación se ejecutó el plan **tal como está escrito**: los 9 ficheros nuevos se
extrajeron con un script directamente de los bloques de este documento (no se reescribieron a mano),
y los cambios a ficheros existentes se aplicaron con su texto literal. Resultado, tarea a tarea:

| Tarea | Rojo | Verde | Mutaciones cazadas |
|---|---|---|---|
| 1 `echoLedger` | `ERR_MODULE_NOT_FOUND` | 18 aserciones | 5 de 5 |
| 2 `pushTrace` | — | 300 escenarios, 3.859 escrituras, 0 invariantes rotas; **determinista**; **idéntica a `main`** | la comparación detecta una subida rota: 299 de 300 escenarios distintos, 1.011 invariantes rotas |
| 3 `backupFlags` | `configRepo.getSubidaSinEco is not a function` | 9 | 1 de 1 |
| 4 `echoMerge` | 6 OK, 6 fallos | 12 (y `pullDeferred` 15, `ordersRepo` 65, sin cambios) | 2 de 2 |
| 5 `pushEcho` | 13 OK, 8 fallos | 21; y `pushTrace` con la bandera ausente, **idéntica a antes del cambio y a `main`** | 5 de 5 |
| 6 `/cloud` | — | `npm run build` exit 0 | — |
| 7 (parcial) | — | 0 identificadores libres en los 6 ficheros (el control negativo sí caza uno); los falsos de Firebase **no** entran en el paquete; exactamente 3 líneas borradas en producción | — |

Lo que la validación **corrigió** en este plan: dos cifras esperadas (18 y 12, no 20 y 14), el detalle
del rojo de `echoMerge` y de `pushEcho`, las líneas borradas esperadas (3, no 4), el falso positivo de
`m.delete` en la búsqueda de escrituras, y dos avisos medidos: los finales de línea CRLF
(`core.autocrlf=true`) y que `pushTrace` tarda unos 4 minutos. **Validar el plan no es la
implementación**: la rama no tiene ni una línea de este código hasta que el dueño lo apruebe.

## Global Constraints

- **Rama única `claude/awesome-dirac-484azm`. NADA a `main`. No crear Pull Requests.** (CLAUDE.md, reglas 1 y 9)
- **Bandera `config.subidaSinEco` APAGADA por defecto:** sin ella, `doPush` sube exactamente las mismas filas que hoy. (spec E2; regla 2)
- **La anotación vive en MEMORIA de la sesión:** cero escrituras nuevas a Dexie. (spec E3)
- **Cero cambios** en `src/db/db.js` (Dexie sigue en v19), `SYNC_COLLECTIONS`/`collections.js`, `firestore.rules`, `firestore.indexes.json`, `package.json`, `package-lock.json`, `vite.config.js`, `index.html`, `ordersRepo.js`, `salesRepo.js`, `src/features/tables/`, `retryQueue.js`, `resend.js`, `commitWatch.js`, `deferred.js`, `syncEngine.js`, `SyncProvider.jsx`. (spec §3.2 «Lo que NO se toca»)
- **Idioma español** en UI, comentarios y commits; imitar el estilo del código vecino (sin punto y coma, comillas simples, comentarios densos y en prosa). (regla 7)
- **`npm run build` limpio antes de CADA commit.** (regla 8)
- **Ficheros UTF-8 válidos, sin bytes NUL ni sueltos** (un `0xA7` suelto ya rompió `pushEngine.js` una vez). Comprobarlo antes de cada commit con el comando de «Herramientas».
- **Commits en español, por tarea, terminando en** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No afirmar «probado» lo que no se probó:** nadie ejecutará esto contra Firestore real ni en un teléfono. (regla 5)

## Herramientas (se usan en varias tareas)

Todas las órdenes se ejecutan desde la raíz del repo, en Git Bash.

```bash
# Directorio temporal FUERA del repo (el scratchpad de la sesión). Ajustarlo si cambia.
SCRATCH="C:/Users/Ramon/AppData/Local/Temp/claude/D--code-conta-contamypime/0fb33e80-2363-4717-ae3c-613fe60cfb29/scratchpad/eco"
mkdir -p "$SCRATCH"

# Alias que sustituyen SOLO el SDK de Firebase por los falsos de prueba (Tarea 2).
ALIAS="--alias:firebase/app=./src/features/sync/testing/fakeFirebaseApp.mjs --alias:firebase/auth=./src/features/sync/testing/fakeFirebaseAuth.mjs --alias:firebase/firestore=./src/features/sync/testing/fakeFirestore.mjs"

# Empaquetar y correr una suite con base real (sin alias):
corre_base() { npx esbuild "$1" --bundle --platform=node --format=esm --log-level=error --outfile="$SCRATCH/$(basename "$1").bundle.mjs" && node "$SCRATCH/$(basename "$1").bundle.mjs"; }
# Lo mismo, con los falsos de Firebase:
corre_fb() { npx esbuild "$1" --bundle --platform=node --format=esm --log-level=error $ALIAS --outfile="$SCRATCH/$(basename "$1").bundle.mjs" && node "$SCRATCH/$(basename "$1").bundle.mjs"; }

# UTF-8 válido y sin NUL (pasarle los ficheros tocados):
utf8_ok() { node -e 'const fs=require("fs");let bad=0;for(const f of process.argv.slice(1)){const b=fs.readFileSync(f);const nul=b.includes(0);const ok=Buffer.from(b.toString("utf8"),"utf8").equals(b);if(nul||!ok){bad++;console.log("MAL",f,{nul,ok})}}console.log(bad?"HAY FICHEROS MAL":"utf8 ok")' "$@"; }
```

**Ayudante de mutaciones** (control negativo). Crear una vez `"$SCRATCH/mutar.mjs"`:

```js
// Uso: node mutar.mjs <fichero> <texto-viejo> <texto-nuevo>
// Sustituye UNA aparicion exacta; falla si no la encuentra o si hay mas de una.
import fs from 'node:fs'
const [f, viejo, nuevo] = process.argv.slice(2)
const s = fs.readFileSync(f, 'utf8')
const n = s.split(viejo).length - 1
if (n !== 1) { console.error(`mutar: ${n} apariciones de la cadena en ${f}`); process.exit(2) }
fs.writeFileSync(f, s.replace(viejo, nuevo))
console.log('mutado', f)
```

Las mutaciones se aplican **siempre sobre un fichero ya commiteado** y se deshacen con
`git checkout -- <fichero>`. Tras cada tanda, `git status --short` debe mostrar solo
`.claude/settings.json` (preexistente, no se toca).

**Finales de línea (medido el 27-09):** el repo tiene `core.autocrlf=true`, así que en disco los
ficheros están en **CRLF**. `mutar.mjs` solo se usa con cadenas de **una línea** (todas las de este
plan lo son), y funciona. Para los cambios de varias líneas usar la herramienta de edición, no un
`replace` con `\n`: con `\n` no encuentra el texto. Los ficheros nuevos pueden quedar en LF; Git avisa
y los normaliza al commitear, y no afecta al build.

**Duración (medida):** `pushTrace` tarda **unos 4 minutos** (300 escenarios con base real). Lanzarla
con un tiempo límite amplio o en segundo plano; `pushEcho` y las demás tardan segundos.

## Review Focus

Las cinco condiciones que la spec implica y que más pueden morder a alguien. Cada una tiene su prueba
en la tarea que posee el código:

1. **Fila bajada y tocada después en el mismo aparato** → tiene que subir (su marca cambió). Tarea 4, caso 4; Tarea 5, escenario A (`tocada`).
2. **Escritura propia que vuelve por el oyente con la misma marca** → no se anota; sube por su cursor. Tarea 4, caso 2.
3. **Reintento pendiente de una fila que se salta** → no se pierde: se reintenta en el ciclo siguiente. Tarea 5, escenario D.
4. **Bandera ausente o en `false`** → subida clásica, idéntica a hoy y a `main`. Tarea 5, escenarios B y C; Tarea 2 (equivalencia con `main`).
5. **Todos los candidatos de una colección se saltan** → el cursor avanza igual que si se hubieran subido. Tarea 5, escenario A (`sales`).

---

### Task 1: el módulo puro `echoLedger.js`

**Files:**
- Create: `src/features/sync/echoLedger.js`
- Test: `src/features/sync/echoLedger.test.mjs`

**Interfaces:**
- Consumes: `syncTs(rec)` de `src/features/sync/collections.js` (devuelve la mayor cadena ISO de `updatedAt, settledAt, closedAt, openedAt, effectiveFrom, createdAt`, o `''`).
- Produces (las usan las Tareas 4, 5 y 6):
  - `record(colName: string, pk: string, filas: object[]): void`
  - `split(colName: string, candidatos: {r, id: string, ts: string}[], enabled: boolean): { subir, saltar }`
  - `prune(colName: string, cursor: string): void`
  - `skippedCount(): number`
  - `pendingCount(colName: string): number`
  - `clear(): void`

- [ ] **Step 1: Escribir la suite (en rojo)**

Crear `src/features/sync/echoLedger.test.mjs`:

```js
// Suite del modulo PURO de la subida sin eco (spec 2026-09-27-subida-sin-eco).
// Se corre con:  node src/features/sync/echoLedger.test.mjs
import assert from 'node:assert/strict'
import { record, split, prune, skippedCount, pendingCount, clear } from './echoLedger.js'

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }

const T1 = '2026-09-27T10:00:00.000Z'
const T2 = '2026-09-27T10:00:05.000Z'
const T3 = '2026-09-27T10:00:09.000Z'
// Un candidato con la forma EXACTA que le da doPush: { r, id (texto), ts }.
const cand = (id, ts) => ({ r: { id, updatedAt: ts }, id: String(id), ts })
const ids = (l) => l.map((c) => c.id)

// --- 1) Sin la bandera, la subida clasica ------------------------------------
clear()
record('products', 'id', [{ id: 'a', updatedAt: T1 }])
const off = split('products', [cand('b', T2), cand('a', T1), cand('c', T3)], false)
eq(ids(off.subir), ['b', 'a', 'c'], 'bandera apagada: sube TODO, en el mismo orden')
eq(off.saltar, [], 'bandera apagada: no se salta nada')
eq(skippedCount(), 0, 'bandera apagada: el contador no se mueve')

// --- 2) Con la bandera: se salta SOLO la version exacta que llego de la nube --
clear()
record('products', 'id', [{ id: 'a', updatedAt: T1 }, { id: 'b', createdAt: T1, updatedAt: T2 }])
const on = split('products', [cand('a', T1), cand('b', T3), cand('c', T2)], true)
eq(ids(on.saltar), ['a'], 'se salta la fila con la MISMA marca que se bajo')
eq(ids(on.subir), ['b', 'c'], 'sube la tocada despues (otra marca) y la que nunca se bajo')
eq(skippedCount(), 1, 'el contador cuenta la saltada')

// --- 3) Una marca MAS VIEJA que la anotada tambien sube -----------------------
clear()
record('orders', 'id', [{ id: 'o1', updatedAt: T2 }])
eq(ids(split('orders', [cand('o1', T1)], true).subir), ['o1'], 'marca distinta (mas vieja) -> sube')

// --- 4) La marca es la de syncTs: el mayor de los campos de marca -------------
clear()
record('orders', 'id', [{ id: 'o2', openedAt: T1, closedAt: T3, updatedAt: T2 }])
eq(ids(split('orders', [cand('o2', T3)], true).saltar), ['o2'], 'usa syncTs (aqui manda closedAt)')

// --- 5) La clave se compara como TEXTO (doPush pasa String(pk)) ---------------
clear()
record('config', 'key', [{ key: 7, updatedAt: T1 }])
eq(ids(split('config', [cand('7', T1)], true).saltar), ['7'], 'una clave no textual se anota como texto')

// --- 6) Cada coleccion tiene su propio libro ----------------------------------
clear()
record('sales', 'id', [{ id: 'x', createdAt: T1 }])
eq(ids(split('stockMovements', [cand('x', T1)], true).subir), ['x'],
  'lo anotado en sales no hace saltar nada en stockMovements')

// --- 7) Sin clave o sin marca no se anota ------------------------------------
clear()
record('sales', 'id', [null, { createdAt: T1 }, { id: 'sinMarca' }])
eq(pendingCount('sales'), 0, 'sin clave o sin marca no se anota nada')

// --- 8) prune: fuera lo que ya no puede ser candidato (<= cursor) -------------
clear()
record('sales', 'id', [{ id: 's1', createdAt: T1 }, { id: 's2', createdAt: T2 }, { id: 's3', createdAt: T3 }])
prune('sales', T2)
eq(pendingCount('sales'), 1, 'prune borra lo que esta EN o por debajo del cursor')
eq(ids(split('sales', [cand('s3', T3)], true).saltar), ['s3'], 'y conserva lo que esta por encima')
prune('sales', '')
eq(pendingCount('sales'), 1, 'un cursor vacio no borra nada')

// --- 9) Una version mas nueva sustituye a la anotada --------------------------
clear()
record('products', 'id', [{ id: 'p', updatedAt: T1 }])
record('products', 'id', [{ id: 'p', updatedAt: T2 }])
eq(ids(split('products', [cand('p', T1)], true).subir), ['p'], 'la version vieja ya no salta')
eq(ids(split('products', [cand('p', T2)], true).saltar), ['p'], 'la nueva si')

// --- 10) Entradas ilegibles no lanzan ------------------------------------------
clear()
record('products', 'id', null)
eq(split('products', null, true), { subir: [], saltar: [] }, 'lista ilegible -> nada, sin lanzar')
ok(pendingCount('nunca-vista') === 0, 'una coleccion sin anotar da 0')

console.log(`echoLedger (subida sin eco): ${n} aserciones OK`)
```

- [ ] **Step 2: Verificar que falla**

Run: `node src/features/sync/echoLedger.test.mjs`
Expected: FAIL con `ERR_MODULE_NOT_FOUND` (no existe `echoLedger.js`).

- [ ] **Step 3: Implementación mínima**

Crear `src/features/sync/echoLedger.js`:

```js
// ---------------------------------------------------------------------------
// Subida sin eco (spec docs/superpowers/specs/2026-09-27-subida-sin-eco-design.md).
// MODULO PURO: sin Dexie, sin Firestore, sin React. Se prueba entero con node.
//
// El eco: la bajada no mueve el cursor de subida (`push:<col>`), asi que doPush
// volvia a subir las filas que acababa de bajar de otro aparato. Aqui se anota
// la VERSION (id + syncTs) de cada fila que la bajada metio en Dexie, y la
// subida se salta una fila SOLO si sigue teniendo exactamente esa version: la
// nube ya la tiene, porque de ahi vino. Cualquier cambio local mueve syncTs
// (regla de la casa: toda mutacion sella su marca) y sube como siempre.
//
// Vive en MEMORIA de la sesion (decision E3 del dueño): cero escrituras a
// Dexie y nada en respaldos. Cerrar la app entre bajar y subir solo hace que
// esas filas hagan eco como antes, que es el lado seguro.
// ---------------------------------------------------------------------------
import { syncTs } from './collections.js'

const anotado = new Map() // colName -> Map(id en texto -> syncTs)
let saltadas = 0

const deColeccion = (colName) => {
  let m = anotado.get(colName)
  if (!m) {
    m = new Map()
    anotado.set(colName, m)
  }
  return m
}

// Se anota SIEMPRE, con o sin la bandera: es memoria invisible, y asi las
// tandas que llegan al arrancar, antes del primer doPush, no se quedan sin
// anotar. Lo que cambia la conducta —que se escribe en la nube— es `split`.
export function record(colName, pk, filas) {
  if (!Array.isArray(filas) || !filas.length) return
  const m = deColeccion(colName)
  for (const f of filas) {
    if (!f || f[pk] == null) continue
    const ts = syncTs(f)
    if (ts) m.set(String(f[pk]), ts)
  }
}

// `candidatos` son los `nuevos` de doPush: [{ r, id, ts }], con `id` ya en
// texto. Con `enabled` falso devuelve la lista ENTERA en `subir` y en el mismo
// orden: la subida clasica, sin tocar.
export function split(colName, candidatos, enabled) {
  const lista = Array.isArray(candidatos) ? candidatos : []
  if (!enabled) return { subir: lista, saltar: [] }
  const m = anotado.get(colName)
  if (!m || !m.size) return { subir: lista, saltar: [] }
  const subir = []
  const saltar = []
  for (const c of lista) {
    if (c && c.ts && m.get(String(c.id)) === c.ts) saltar.push(c)
    else subir.push(c)
  }
  saltadas += saltar.length
  return { subir, saltar }
}

// Borra lo que ya nunca podra ser candidato (marca <= cursor): el mapa queda
// del tamaño de lo bajado desde la ultima subida.
export function prune(colName, cursor) {
  const m = anotado.get(colName)
  if (!m || !cursor) return
  for (const [id, ts] of m) if (ts <= cursor) m.delete(id)
}

// Cuantas filas se dejaron de reenviar en esta sesion (lo muestra /cloud).
export const skippedCount = () => saltadas

export const pendingCount = (colName) => anotado.get(colName)?.size || 0

// Para las pruebas: deja el modulo como recien cargado.
export function clear() {
  anotado.clear()
  saltadas = 0
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `node src/features/sync/echoLedger.test.mjs`
Expected: `echoLedger (subida sin eco): 18 aserciones OK`.

- [ ] **Step 5: Build, UTF-8 y commit**

```bash
npm run build && utf8_ok src/features/sync/echoLedger.js src/features/sync/echoLedger.test.mjs
git add src/features/sync/echoLedger.js src/features/sync/echoLedger.test.mjs
git commit -m "$(cat <<'EOF'
Subida sin eco (1/6): modulo puro del libro de ecos por id y marca

Anota en memoria la version (id + syncTs) de lo que baja de la nube y separa
los candidatos de doPush en subir/saltar. Con la bandera apagada devuelve la
lista entera en el mismo orden. Aun no esta cableado a nada.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Control negativo (la suite tiene que cazar cada mutación)**

Para cada línea: aplicar, correr la suite, **esperar FAIL**, deshacer.

```bash
F=src/features/sync/echoLedger.js
m() { node "$SCRATCH/mutar.mjs" "$F" "$1" "$2" >/dev/null && { node src/features/sync/echoLedger.test.mjs >/dev/null 2>&1 && echo "NO CAZADA: $3" || echo "cazada: $3"; }; git checkout -- "$F"; }
m "m.get(String(c.id)) === c.ts" "m.get(String(c.id)) >= c.ts" "igualdad -> >="
m "if (!enabled) return { subir: lista, saltar: [] }" "" "ignorar la bandera"
m "if (ts <= cursor) m.delete(id)" "if (ts < cursor) m.delete(id)" "prune con <"
m "if (ts) m.set(String(f[pk]), ts)" "if (ts) m.set(f[pk], ts)" "anotar sin String()"
m "saltadas += saltar.length" "" "no contar"
git status --short
```

Expected: cinco líneas `cazada: …` y ninguna `NO CAZADA`. `git status --short` solo con
`.claude/settings.json`. Si alguna no se caza, **añadir la aserción que falta** a la suite antes de
seguir (y otro commit).

---

### Task 2: falsos de Firebase y la prueba de equivalencia de `doPush` (antes de tocar `doPush`)

Se escribe **antes** de cambiar la subida, para fijar la conducta de hoy y compararla con `main`.

**Files:**
- Create: `src/features/sync/testing/fakeFirestore.mjs`
- Create: `src/features/sync/testing/fakeFirebaseApp.mjs`
- Create: `src/features/sync/testing/fakeFirebaseAuth.mjs`
- Test: `src/features/sync/pushTrace.test.mjs`

**Interfaces:**
- Consumes: `pushChanges()` de `pushEngine.js`; `mergeIncoming(col, docs)` de `pullEngine.js`; `db` de `src/db/db.js`. **No importa `echoLedger`**, para que el mismo fichero corra también en un árbol de `main`.
- Produces: `globalThis.__escrituras` = `[{ via: 'batch'|'setDoc', ref: 'businesses/<neg>/<col>/<id>', data }]`, que usa también la Tarea 5.

- [ ] **Step 1: Los tres falsos**

`src/features/sync/testing/fakeFirestore.mjs`:

```js
// FALSO de 'firebase/firestore' SOLO para pruebas (pushTrace, pushEcho). Se
// inyecta con --alias de esbuild; la app NUNCA lo importa (nadie usa
// import.meta.glob). Registra cada escritura en globalThis.__escrituras para
// ver exactamente que habria subido doPush, sin red y sin el SDK.
const log = () => (globalThis.__escrituras ||= [])

export const SELLO = '__serverTimestamp__'
export function initializeFirestore() { return { falso: true } }
export function persistentLocalCache() { return {} }
export function persistentMultipleTabManager() { return {} }
export function doc(_fs, ...segs) { return segs.join('/') }
export function serverTimestamp() { return { [SELLO]: true } }
export function setDoc(ref, data) {
  log().push({ via: 'setDoc', ref, data })
  return Promise.resolve()
}
export function writeBatch() {
  const ops = []
  return {
    set(ref, data) { ops.push({ via: 'batch', ref, data }) },
    commit() {
      log().push(...ops)
      return Promise.resolve()
    }
  }
}
```

`src/features/sync/testing/fakeFirebaseApp.mjs`:

```js
// FALSO de 'firebase/app' SOLO para pruebas (ver fakeFirestore.mjs).
export const initializeApp = () => ({ falso: true })
export const getApps = () => []
```

`src/features/sync/testing/fakeFirebaseAuth.mjs`:

```js
// FALSO de 'firebase/auth' SOLO para pruebas: una sesion abierta del negocio de
// prueba, para que doPush no salga por 'no-auth'.
export const getAuth = () => ({ currentUser: { uid: 'neg-prueba' } })
```

- [ ] **Step 2: La prueba de trazas**

`src/features/sync/pushTrace.test.mjs`:

```js
// Prueba CON BASE (fake-indexeddb) y con el doPush REAL: imprime, para cientos
// de escenarios aleatorios (semilla fija), una huella de lo que sube doPush
// (id + contenido SIN `_up`), los cursores y la cola de reintentos. Sirve para
// comparar BYTE A BYTE la subida de dos arboles (spec 2026-09-27-subida-sin-eco
// §7.3): con la bandera ausente, la rama tiene que dar la MISMA salida que main.
// No importa echoLedger a proposito: el mismo fichero corre en un arbol de main.
// Firebase se sustituye por los falsos de ./testing con --alias:
//   npx esbuild src/features/sync/pushTrace.test.mjs --bundle --platform=node --format=esm \
//     --alias:firebase/app=./src/features/sync/testing/fakeFirebaseApp.mjs \
//     --alias:firebase/auth=./src/features/sync/testing/fakeFirebaseAuth.mjs \
//     --alias:firebase/firestore=./src/features/sync/testing/fakeFirestore.mjs \
//     --outfile=<scratch>/pushTrace.bundle.mjs && node <scratch>/pushTrace.bundle.mjs
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { db } from '../../db/db'
import { pushChanges } from './pushEngine'
import { mergeIncoming } from './pullEngine'

const ESCENARIOS = 300
const NEG = 'neg-prueba'
const BASE = Date.parse('2026-09-27T10:00:00.000Z')
const iso = (k) => new Date(BASE + k * 1000).toISOString()
const COLS = [
  { name: 'products', pk: 'id' },
  { name: 'stockMovements', pk: 'id' },
  { name: 'sales', pk: 'id' },
  { name: 'orders', pk: 'id' }
]

// PRNG determinista (mulberry32): la misma semilla da el mismo escenario en
// los dos arboles.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const entero = (r, n) => Math.floor(r() * n)

// Una fila con los campos de marca que usa cada coleccion de verdad.
function fila(col, id, k) {
  if (col === 'products') return { id, name: id, price: 10, stock: 0, updatedAt: iso(k) }
  if (col === 'stockMovements') return { id, productId: 'p-' + (k % 3), qty: 1, location: 'Salon', createdAt: iso(k) }
  if (col === 'sales') return { id, totalBase: k, items: [], createdAt: iso(k) }
  return { id, table: 'Mesa ' + (k % 4), status: 'open', openedAt: iso(k), updatedAt: iso(k) }
}
const selloDe = (col, k) => (col === 'stockMovements' || col === 'sales' ? { createdAt: iso(k) } : { updatedAt: iso(k) })

const drenar = () => new Promise((r) => setTimeout(r, 50))
const limpiar = () => Promise.all(db.tables.map((t) => t.clear()))

let invariantesRotas = 0
let totalEscrituras = 0
const lineas = []

for (let s = 0; s < ESCENARIOS; s++) {
  const r = rng(1000 + s)
  await limpiar()
  globalThis.__escrituras = []
  await db.config.bulkPut([
    { key: 'syncEnabled', value: true, updatedAt: iso(-1000) },
    { key: 'syncBusinessId', value: NEG, updatedAt: iso(-1000) }
  ])
  await db.syncState.put({ key: 'push:config', value: iso(100000) })

  const cursorInicial = {}
  for (const c of COLS) {
    if (r() < 0.2) { cursorInicial[c.name] = ''; continue }
    cursorInicial[c.name] = iso(entero(r, 20))
    await db.syncState.put({ key: `push:${c.name}`, value: cursorInicial[c.name] })
  }

  for (const c of COLS) {
    const tabla = db[c.name]
    const nFilas = entero(r, 9)
    const reintentos = []
    for (let i = 0; i < nFilas; i++) {
      const id = `${c.name}-${i}`
      const k = entero(r, 30)
      const tipo = entero(r, c.name === 'products' ? 6 : 5)
      if (tipo === 0) {
        await tabla.put(fila(c.name, id, k)) // local, nunca bajada
      } else if (tipo === 1) {
        await mergeIncoming(c, [fila(c.name, id, k)]) // bajada de otro aparato
      } else if (tipo === 2) {
        await mergeIncoming(c, [fila(c.name, id, k)]) // bajada y tocada despues
        await tabla.update(id, { nota: 'tocada', ...selloDe(c.name, k + 1 + entero(r, 5)) })
      } else if (tipo === 3) {
        await tabla.put(fila(c.name, id, k)) // local que vuelve igual por el oyente
        await mergeIncoming(c, [fila(c.name, id, k)])
      } else if (tipo === 4) {
        await tabla.put(fila(c.name, id, k + 3)) // local mas nueva; llega una vieja
        await mergeIncoming(c, [fila(c.name, id, k)])
      } else {
        await mergeIncoming(c, [fila(c.name, id, k)]) // derivado sin marca
        await tabla.update(id, { stock: 5, stockByLocation: { Salon: 5 } })
      }
      if (r() < 0.15) {
        reintentos.push({ id, attempts: 1, lastAttemptAt: 0, lastErrorCode: 'unavailable', state: r() < 0.8 ? 'active' : 'paused' })
      }
    }
    if (r() < 0.2) reintentos.push({ id: `${c.name}-fantasma`, attempts: 1, lastAttemptAt: 0, lastErrorCode: 'unavailable', state: 'active' })
    if (reintentos.length) await db.syncState.put({ key: `retry:${c.name}`, value: reintentos })
  }

  // La invariante clasica, que main y la rama cumplen con la bandera ausente:
  // toda fila con marca por encima del cursor inicial sube.
  const debenSubir = []
  for (const c of COLS) {
    for (const row of await db[c.name].toArray()) {
      const ts = [row.updatedAt, row.closedAt, row.openedAt, row.createdAt].filter((v) => typeof v === 'string').sort().pop() || ''
      if (ts && ts > cursorInicial[c.name]) debenSubir.push(`${c.name}/${row[c.pk]}`)
    }
  }

  await pushChanges()
  await drenar()

  const escritas = globalThis.__escrituras.map((w) => {
    const [, , col, id] = w.ref.split('/')
    const data = { ...w.data }
    delete data._up
    return { col, id, via: w.via, data }
  })
  totalEscrituras += escritas.length
  const escritasSet = new Set(escritas.map((e) => `${e.col}/${e.id}`))
  for (const k of debenSubir) {
    if (!escritasSet.has(k)) { invariantesRotas++; console.error('INVARIANTE ROTA', s, k) }
  }

  const cursores = {}
  const colas = {}
  for (const c of COLS) {
    cursores[c.name] = (await db.syncState.get(`push:${c.name}`))?.value || ''
    const lista = (await db.syncState.get(`retry:${c.name}`))?.value || []
    colas[c.name] = lista
      .map((e) => ({ id: e.id, attempts: e.attempts, state: e.state, code: e.lastErrorCode || '' }))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
  }
  const huella = {
    escritas: escritas
      .map((e) => JSON.stringify(e))
      .sort(),
    cursores,
    colas
  }
  lineas.push(`${s} ${createHash('sha256').update(JSON.stringify(huella)).digest('hex').slice(0, 16)}`)
}

console.log(lineas.join('\n'))
console.log(`pushTrace: ${ESCENARIOS} escenarios, ${totalEscrituras} escrituras, ${invariantesRotas} invariantes rotas`)
if (invariantesRotas) process.exit(1)
```

- [ ] **Step 3: Correrla en la rama (antes del cambio)**

```bash
corre_fb src/features/sync/pushTrace.test.mjs > "$SCRATCH/trace-base.txt"; echo "exit=$?"; tail -1 "$SCRATCH/trace-base.txt"
```

Expected: `exit=0` y la última línea `pushTrace: 300 escenarios, <N> escrituras, 0 invariantes rotas`,
con N > 0. **Si N = 0, la prueba no mide nada: parar e investigar** (el falso no se está usando).

- [ ] **Step 4: Determinismo (si no, la comparación no significa nada)**

```bash
corre_fb src/features/sync/pushTrace.test.mjs > "$SCRATCH/trace-base2.txt"; cmp "$SCRATCH/trace-base.txt" "$SCRATCH/trace-base2.txt" && echo DETERMINISTA
```

Expected: `DETERMINISTA`. Si no lo es, localizar la fuente (orden, reloj) y arreglar **la prueba**,
nunca el código de producción.

- [ ] **Step 5: La misma prueba en un árbol de `main`**

```bash
git fetch origin
git worktree add -f "$SCRATCH/wt-main" origin/main
powershell -NoProfile -Command "New-Item -ItemType Junction -Path '$(cygpath -w "$SCRATCH/wt-main/node_modules")' -Target '$(cygpath -w "$PWD/node_modules")' | Out-Null"
mkdir -p "$SCRATCH/wt-main/src/features/sync/testing"
cp src/features/sync/testing/*.mjs "$SCRATCH/wt-main/src/features/sync/testing/"
cp src/features/sync/pushTrace.test.mjs "$SCRATCH/wt-main/src/features/sync/"
( cd "$SCRATCH/wt-main" && npx esbuild src/features/sync/pushTrace.test.mjs --bundle --platform=node --format=esm --log-level=error $ALIAS --outfile="$SCRATCH/pushTrace.main.bundle.mjs" && node "$SCRATCH/pushTrace.main.bundle.mjs" > "$SCRATCH/trace-main.txt" ); echo "exit=$?"
cmp "$SCRATCH/trace-base.txt" "$SCRATCH/trace-main.txt" && echo "IDENTICA A MAIN"
```

Expected: `exit=0` e `IDENTICA A MAIN`. Esto demuestra, sobre 300 escenarios, que la rama de hoy
(con F1) sube lo mismo que `main` salvo el campo `_up`. **Si difiere, PARAR y avisar al dueño**: sería
un hallazgo en F1, no algo que arreglar en este plan.

- [ ] **Step 6: Control negativo de la comparación**

```bash
node "$SCRATCH/mutar.mjs" src/features/sync/pushEngine.js "const slice = nuevos.slice(i, i + step)" "const slice = nuevos.slice(i, i + step).slice(1)"
corre_fb src/features/sync/pushTrace.test.mjs > "$SCRATCH/trace-mut.txt"
cmp -s "$SCRATCH/trace-base.txt" "$SCRATCH/trace-mut.txt" && echo "NO DETECTA (mal)" || echo "detecta la mutacion (bien)"
git checkout -- src/features/sync/pushEngine.js; git status --short
```

Expected: `detecta la mutacion (bien)` (además, la invariante debe romperse: `exit` distinto de 0).
`git status` solo con `.claude/settings.json` y los ficheros nuevos de esta tarea sin commitear.

- [ ] **Step 7: Build, UTF-8 y commit** (el worktree de `main` se conserva para la Tarea 5)

```bash
npm run build && utf8_ok src/features/sync/testing/*.mjs src/features/sync/pushTrace.test.mjs
git add src/features/sync/testing src/features/sync/pushTrace.test.mjs
git commit -m "$(cat <<'EOF'
Subida sin eco (2/6): prueba de trazas del doPush real, identica a main

Falsos de firebase/app, auth y firestore (solo pruebas, por --alias de esbuild)
y 300 escenarios deterministas que imprimen la huella de lo que sube doPush.
Antes de tocar la subida, la rama da la MISMA salida que main (sin _up), con
control negativo que la distingue.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: la bandera del negocio y su exclusión del respaldo

**Files:**
- Modify: `src/repositories/configRepo.js` (junto a `getBajadaFiltrada`, hacia la línea 131)
- Modify: `src/features/backup/backupService.js:24-33` (`DEVICE_ONLY_KEYS`)
- Test: `src/features/backup/backupFlags.test.mjs`

**Interfaces:**
- Produces: `configRepo.getSubidaSinEco(): Promise<boolean>` y `configRepo.setSubidaSinEco(v): Promise<void>`, que usan las Tareas 5 y 6.

- [ ] **Step 1: La suite (en rojo)**

`src/features/backup/backupFlags.test.mjs`:

```js
// Prueba CON BASE (fake-indexeddb) de la bandera `subidaSinEco` (spec
// 2026-09-27-subida-sin-eco §3.2): nace apagada, se lee y se escribe por
// configRepo, y NO viaja en el respaldo (ni al construirlo ni al restaurarlo).
// No corre con node directo:
//   npx esbuild src/features/backup/backupFlags.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/backupFlags.bundle.mjs && node <scratch>/...
import 'fake-indexeddb/auto'
import { db } from '../../db/db'
import { configRepo } from '../../repositories/configRepo'
import { buildBackup, applyBackup } from './backupService'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
const limpiar = () => Promise.all(db.tables.map((t) => t.clear()))

// 1. Nace apagada: sin fila, falso (comportamiento clasico).
await limpiar()
ok((await configRepo.getSubidaSinEco()) === false, 'sin fila, la bandera esta apagada')

// 2. Se enciende y se apaga, y sella su marca (toda mutacion sella: la sync depende de ello).
await configRepo.setSubidaSinEco(true)
ok((await configRepo.getSubidaSinEco()) === true, 'encendida se lee encendida')
const fila = await db.config.get('subidaSinEco')
ok(fila?.value === true && typeof fila.updatedAt === 'string' && fila.updatedAt.length > 0,
  'la fila guarda true y sella updatedAt')
await configRepo.setSubidaSinEco(false)
ok((await configRepo.getSubidaSinEco()) === false, 'apagada se lee apagada')

// 3. Un valor no booleano se normaliza (una fila rota que llegue por la sync no enciende nada raro).
await db.config.put({ key: 'subidaSinEco', value: 'si', updatedAt: '2026-09-27T10:00:00.000Z' })
ok((await configRepo.getSubidaSinEco()) === true, 'un valor verdadero no booleano cuenta como encendida')
await db.config.put({ key: 'subidaSinEco', value: 0, updatedAt: '2026-09-27T10:00:00.000Z' })
ok((await configRepo.getSubidaSinEco()) === false, 'un valor falso no booleano cuenta como apagada')

// 4. Al CONSTRUIR el respaldo no viaja.
await limpiar()
await configRepo.setSubidaSinEco(true)
await configRepo.set('areas', ['Salon'])
const bk = await buildBackup({ name: 'dueno' })
const claves = (bk.tables.config || []).map((r) => r.key)
ok(!claves.includes('subidaSinEco'), 'el respaldo NO lleva la bandera')
ok(claves.includes('areas'), 'y sigue llevando la config del negocio de siempre')

// 5. Al RESTAURAR un respaldo que la traiga, no entra ni pisa la del aparato.
await limpiar()
await configRepo.setSubidaSinEco(false)
await applyBackup({
  meta: { app: 'mypicuadre-respaldo', version: 1, schema: db.verno, exportedAt: '2026-09-01T00:00:00.000Z' },
  tables: { config: [{ key: 'subidaSinEco', value: true, updatedAt: '2099-01-01T00:00:00.000Z' }] }
})
ok((await configRepo.getSubidaSinEco()) === false, 'restaurar no cambia la bandera del aparato')

console.log(`backupFlags (la bandera subidaSinEco): ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Step 2: Verificar que falla**

Run: `corre_base src/features/backup/backupFlags.test.mjs`
Expected: FAIL con `TypeError: configRepo.getSubidaSinEco is not a function`.

- [ ] **Step 3: Implementación**

En `src/repositories/configRepo.js`, justo después de `setBajadaFiltrada`:

```js
  // Subida sin eco (spec 2026-09-27-subida-sin-eco). Del NEGOCIO y SINCRONIZADA,
  // como `bajadaFiltrada`: el dueño la enciende y la apaga para todos desde su
  // aparato, o a distancia desde la consola (§6 de la spec). Apagada por defecto
  // = la subida clasica. A diferencia de `bajadaFiltrada`, no cambia
  // suscripciones: doPush la lee en cada ciclo, asi que se aplica sin reabrir.
  async getSubidaSinEco() {
    return !!(await this.get('subidaSinEco', false))
  },

  async setSubidaSinEco(v) {
    await this.set('subidaSinEco', !!v)
  },
```

En `src/features/backup/backupService.js`, dentro de `DEVICE_ONLY_KEYS`, después de
`'lastRestoreAt'` (añadir la coma a esa línea):

```js
  'lastRestoreAt',
  // Subida sin eco: es del negocio y vive en la nube (llega por la sync). Un
  // respaldo viejo no debe encenderla ni apagarla al restaurarse.
  'subidaSinEco'
```

- [ ] **Step 4: Verificar que pasa, y que la suite vecina sigue igual**

```bash
corre_base src/features/backup/backupFlags.test.mjs
corre_base src/features/backup/backupCursors.test.mjs
```

Expected: `backupFlags (la bandera subidaSinEco): 9 OK, 0 fallos` y
`backupCursors (los cursores de bajada no viajan): 5 OK, 0 fallos`.

- [ ] **Step 5: Build, UTF-8 y commit**

```bash
npm run build && utf8_ok src/repositories/configRepo.js src/features/backup/backupService.js src/features/backup/backupFlags.test.mjs
git add src/repositories/configRepo.js src/features/backup/backupService.js src/features/backup/backupFlags.test.mjs
git commit -m "$(cat <<'EOF'
Subida sin eco (3/6): bandera del negocio apagada por defecto, fuera del respaldo

configRepo.getSubidaSinEco/setSubidaSinEco (sincronizada, como bajadaFiltrada)
y la clave en DEVICE_ONLY_KEYS para que un respaldo no la encienda ni la apague.
Aun no la lee nadie.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Control negativo**

```bash
F=src/features/backup/backupService.js
node "$SCRATCH/mutar.mjs" "$F" "  'subidaSinEco'" "  'noEsLaBandera'" >/dev/null
corre_base src/features/backup/backupFlags.test.mjs >/dev/null 2>&1 && echo "NO CAZADA" || echo "cazada: la bandera viajaria en el respaldo"
git checkout -- "$F"; git status --short
```

Expected: `cazada: …`.

---

### Task 4: la bajada anota lo que mete en Dexie

**Files:**
- Modify: `src/features/sync/pullEngine.js` (import en la cabecera; una línea tras `pullEngine.js:54`)
- Test: `src/features/sync/echoMerge.test.mjs`

**Interfaces:**
- Consumes: `record`, `split`, `pendingCount`, `clear` (Tarea 1); `mergeIncoming`, `recomputeStock` (existentes); `syncTs` de `collections.js`.

- [ ] **Step 1: La suite (en rojo)**

`src/features/sync/echoMerge.test.mjs`:

```js
// Prueba CON BASE (fake-indexeddb) de la subida sin eco, lado BAJADA: el
// `mergeIncoming` REAL anota exactamente las filas que mete en Dexie, y nada
// mas (spec 2026-09-27-subida-sin-eco §3.2 y §4). No corre con node directo:
//   npx esbuild src/features/sync/echoMerge.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/echoMerge.bundle.mjs && node <scratch>/...
import 'fake-indexeddb/auto'
import { db } from '../../db/db'
import { mergeIncoming, recomputeStock } from './pullEngine'
import { syncTs } from './collections'
import { split, pendingCount, clear } from './echoLedger'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }

const COL_PROD = { name: 'products', pk: 'id' }
const COL_MOV = { name: 'stockMovements', pk: 'id' }
const COL_CFG = { name: 'config', pk: 'key' }
const T1 = '2026-09-27T10:00:00.000Z'
const T2 = '2026-09-27T10:00:05.000Z'
const T3 = '2026-09-27T10:00:09.000Z'

const limpiar = async () => { clear(); await Promise.all(db.tables.map((t) => t.clear())) }
// ¿La subida (con la bandera encendida) se saltaria ESTA fila tal como esta en Dexie?
const saltaria = async (col, id) => {
  const r = await db[col.name].get(id)
  return split(col.name, [{ r, id: String(id), ts: syncTs(r) }], true).saltar.length === 1
}

// 1. Una fila nueva de la nube se anota: su version no se reenvia.
await limpiar()
await mergeIncoming(COL_PROD, [{ id: 'eco', name: 'Eco', updatedAt: T1 }])
ok(pendingCount('products') === 1, 'la fila bajada se anota')
ok(await saltaria(COL_PROD, 'eco'), 'y su version, tal como quedo en Dexie, no se reenviaria')

// 2. Una escritura PROPIA que vuelve por el oyente (misma marca) no gana el LWW:
//    no se anota, y por tanto sube por su cursor como siempre.
await limpiar()
await db.products.put({ id: 'propia', name: 'Mia', updatedAt: T2 })
await mergeIncoming(COL_PROD, [{ id: 'propia', name: 'Mia', updatedAt: T2 }])
ok(pendingCount('products') === 0, 'lo que vuelve igual NO se anota')
ok(!(await saltaria(COL_PROD, 'propia')), 'y se subiria')

// 3. Una version mas VIEJA que la local no entra y no se anota.
await limpiar()
await db.products.put({ id: 'nueva', name: 'Local', updatedAt: T3 })
await mergeIncoming(COL_PROD, [{ id: 'nueva', name: 'Vieja', updatedAt: T1 }])
ok(pendingCount('products') === 0, 'lo que pierde el LWW no se anota')

// 4. Bajada y tocada DESPUES en el aparato: la marca cambia y sube.
await limpiar()
await mergeIncoming(COL_PROD, [{ id: 'tocada', name: 'A', price: 1, updatedAt: T1 }])
await db.products.update('tocada', { price: 9, updatedAt: T3 })
ok(!(await saltaria(COL_PROD, 'tocada')), 'una fila tocada despues de bajarla SUBE')

// 5. El derivado sin marca (recomputeStock) no la saca del libro de ecos: el
//    stock recalculado no se reenvia (su comentario dice que no debe subir).
await limpiar()
await mergeIncoming(COL_PROD, [{ id: 'deriv', name: 'D', stock: 0, updatedAt: T1 }])
await mergeIncoming(COL_MOV, [{ id: 'mv1', productId: 'deriv', qty: 4, location: 'Salon', createdAt: T1 }])
await recomputeStock(['deriv'])
ok((await db.products.get('deriv')).stock === 4, 'recomputeStock si actualizo el stock local')
ok(await saltaria(COL_PROD, 'deriv'), 'y aun asi el producto no se reenvia (derivado, sin marca)')
ok(await saltaria(COL_MOV, 'mv1'), 'ni el movimiento bajado')

// 6. Las claves LOCALES de config nunca se anotan (mergeIncoming ya las descarta).
await limpiar()
await mergeIncoming(COL_CFG, [{ key: 'syncEnabled', value: true, updatedAt: T1 }, { key: 'areas', value: ['Salon'], updatedAt: T1 }])
ok(pendingCount('config') === 1, 'solo se anota la config del negocio, no la local del aparato')

// 7. El sello `_up` se quita antes de anotar: la version anotada es la de Dexie.
await limpiar()
await mergeIncoming(COL_MOV, [{ id: 'mv2', productId: 'p', qty: 1, createdAt: T2, _up: { seconds: 1, nanoseconds: 0 } }])
ok(!('_up' in (await db.stockMovements.get('mv2'))), 'el _up no entra en Dexie (como siempre)')
ok(await saltaria(COL_MOV, 'mv2'), 'y la version sin _up es la que se salta')

console.log(`echoMerge (la bajada anota lo que mete): ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Step 2: Verificar que falla**

Run: `corre_base src/features/sync/echoMerge.test.mjs`
Expected: `echoMerge (la bajada anota lo que mete): 6 OK, 6 fallos` y `exit` distinto de 0. Los
seis que fallan son los que dependen de anotar: `la fila bajada se anota`, `y su version, tal como
quedo en Dexie, no se reenviaria`, `y aun asi el producto no se reenvia…`, `ni el movimiento bajado`,
`solo se anota la config del negocio…` y `y la version sin _up es la que se salta`.

- [ ] **Step 3: Implementación**

En `src/features/sync/pullEngine.js`, añadir a los imports de la cabecera:

```js
import { record as anotarEco } from './echoLedger'
```

Y sustituir la línea `  if (toPut.length) await table.bulkPut(toPut)` por:

```js
  if (toPut.length) await table.bulkPut(toPut)
  // Subida sin eco: se anota la version de lo que ACABA de entrar, y solo eso
  // (lo que gano el LWW). Una escritura propia que vuelve por el oyente trae la
  // misma marca, no entra en toPut y no se anota: sube por su cursor como siempre.
  anotarEco(col.name, col.pk, toPut)
```

- [ ] **Step 4: Verificar que pasa, y que las suites de la bajada siguen igual**

```bash
corre_base src/features/sync/echoMerge.test.mjs
corre_base src/features/sync/pullDeferred.test.mjs
corre_base src/repositories/ordersRepo.test.mjs
```

Expected: `echoMerge (la bajada anota lo que mete): 12 OK, 0 fallos`, `pullDeferred …: 15 OK, 0 fallos`
y `ordersRepo: 65 OK, 0 fallos` (esta usa el `mergeIncoming` real: es la guarda de mesas).

- [ ] **Step 5: Build, UTF-8 y commit**

```bash
npm run build && utf8_ok src/features/sync/pullEngine.js src/features/sync/echoMerge.test.mjs
git add src/features/sync/pullEngine.js src/features/sync/echoMerge.test.mjs
git commit -m "$(cat <<'EOF'
Subida sin eco (4/6): la bajada anota la version de lo que mete en Dexie

mergeIncoming anota solo las filas que ganaron el LWW. Las escrituras propias
que vuelven por el oyente no se anotan. Aun nadie se salta nada: la subida no
lee el libro de ecos todavia.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Control negativo**

```bash
F=src/features/sync/pullEngine.js
node "$SCRATCH/mutar.mjs" "$F" "anotarEco(col.name, col.pk, toPut)" "anotarEco(col.name, col.pk, items)" >/dev/null
corre_base src/features/sync/echoMerge.test.mjs >/dev/null 2>&1 && echo "NO CAZADA" || echo "cazada: anotar TODO lo entrante y no solo lo que gano"
git checkout -- "$F"
node "$SCRATCH/mutar.mjs" "$F" "  anotarEco(col.name, col.pk, toPut)" "" >/dev/null
corre_base src/features/sync/echoMerge.test.mjs >/dev/null 2>&1 && echo "NO CAZADA" || echo "cazada: no anotar"
git checkout -- "$F"; git status --short
```

Expected: dos líneas `cazada: …`.

---

### Task 5: `doPush` se salta el eco con la bandera encendida

**Files:**
- Modify: `src/features/sync/pushEngine.js` (imports de la cabecera; `doPush`, líneas 130-202)
- Test: `src/features/sync/pushEcho.test.mjs`

**Interfaces:**
- Consumes: `split`, `prune` (Tarea 1); `configRepo.getSubidaSinEco()` (Tarea 3); los falsos y `globalThis.__escrituras` (Tarea 2); `mergeIncoming`, `recomputeStock`.

- [ ] **Step 1: La suite (en rojo)**

`src/features/sync/pushEcho.test.mjs`:

```js
// Prueba CON BASE (fake-indexeddb) y con el doPush REAL de la subida sin eco
// (spec 2026-09-27-subida-sin-eco §3.2, §4 y §7.3). Firebase se sustituye por
// los falsos de ./testing (ver el comando en pushTrace.test.mjs, el mismo con
// esta ruta).
import 'fake-indexeddb/auto'
import { db } from '../../db/db'
import { pushChanges } from './pushEngine'
import { mergeIncoming, recomputeStock } from './pullEngine'
import { configRepo } from '../../repositories/configRepo'
import { skippedCount, pendingCount, clear } from './echoLedger'
import { SELLO } from './testing/fakeFirestore.mjs'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }

const NEG = 'neg-prueba'
const T0 = '2026-09-27T09:00:00.000Z'
const T1 = '2026-09-27T10:00:00.000Z'
const T2 = '2026-09-27T10:00:05.000Z'
const T3 = '2026-09-27T10:00:09.000Z'
const P = { name: 'products', pk: 'id' }
const M = { name: 'stockMovements', pk: 'id' }
const V = { name: 'sales', pk: 'id' }

const drenar = () => new Promise((r) => setTimeout(r, 50))
const subidos = (col) => (globalThis.__escrituras || [])
  .filter((w) => w.ref.split('/')[2] === col)
  .map((w) => w.ref.split('/')[3])
  .sort()
const escritura = (col, id) => (globalThis.__escrituras || []).find((w) => w.ref === `businesses/${NEG}/${col}/${id}`)
const cursor = async (col) => (await db.syncState.get(`push:${col}`))?.value || ''

// bandera: undefined = sin fila (clasico), true/false = fila explicita.
async function preparar(bandera) {
  clear()
  await Promise.all(db.tables.map((t) => t.clear()))
  globalThis.__escrituras = []
  await db.config.bulkPut([
    { key: 'syncEnabled', value: true, updatedAt: T0 },
    { key: 'syncBusinessId', value: NEG, updatedAt: T0 }
  ])
  if (bandera !== undefined) await configRepo.setSubidaSinEco(bandera)
  // La config no es lo que se prueba: su cursor en el futuro la deja fuera.
  await db.syncState.bulkPut([
    { key: 'push:config', value: '9999-12-31T00:00:00.000Z' },
    { key: 'push:products', value: T0 },
    { key: 'push:stockMovements', value: T0 },
    { key: 'push:sales', value: T0 }
  ])
  // Lo que ya habia en el aparato y lo que llega de otro:
  await db.products.put({ id: 'loc', name: 'Local', updatedAt: T2 }) // nunca bajada
  await mergeIncoming(P, [{ id: 'eco', name: 'Eco', updatedAt: T1 }]) // bajada, intacta
  await mergeIncoming(P, [{ id: 'tocada', name: 'T', price: 1, updatedAt: T1 }])
  await db.products.update('tocada', { price: 9, updatedAt: T3 }) // bajada y tocada
  await mergeIncoming(P, [{ id: 'deriv', name: 'D', stock: 0, updatedAt: T1 }])
  await mergeIncoming(M, [{ id: 'mv1', productId: 'deriv', qty: 4, location: 'Salon', createdAt: T1 }])
  await recomputeStock(['deriv']) // derivado sin marca
  await db.stockMovements.put({ id: 'mvLoc', productId: 'loc', qty: -1, location: 'Salon', createdAt: T2 })
  await mergeIncoming(V, [{ id: 'ven1', totalBase: 10, items: [], createdAt: T1 }]) // la unica de sales
}

// --- A) Bandera ENCENDIDA -------------------------------------------------------
await preparar(true)
await pushChanges()
await drenar()
ok(subidos('products').join(',') === 'loc,tocada', 'A: suben la local y la tocada; NO el eco ni el derivado')
ok(subidos('stockMovements').join(',') === 'mvLoc', 'A: sube el movimiento local; NO el bajado')
ok(subidos('sales').length === 0, 'A: el eco de la venta no se reenvia')
ok((await cursor('products')) === T3, 'A: el cursor de products avanza al maximo de TODOS los candidatos')
ok((await cursor('stockMovements')) === T2, 'A: el de stockMovements tambien')
ok((await cursor('sales')) === T1, 'A: y el de sales avanza aunque se saltaran TODOS (Review Focus 5)')
ok(skippedCount() === 4, 'A: el contador dice 4 filas no reenviadas (eco, deriv, mv1, ven1)')
ok(pendingCount('products') === 0 && pendingCount('sales') === 0, 'A: prune vacia lo que ya quedo bajo el cursor')
ok(escritura('stockMovements', 'mvLoc')?.data?._up?.[SELLO] === true, 'A: F1 intacto: el movimiento sube sellado')
ok(!('_up' in (escritura('products', 'loc')?.data || {})), 'A: y los productos siguen sin sello')

// --- B) SIN fila de bandera: la subida clasica -----------------------------------
await preparar(undefined)
await pushChanges()
await drenar()
ok(subidos('products').join(',') === 'deriv,eco,loc,tocada', 'B: sin bandera sube TODO, como hoy')
ok(subidos('stockMovements').join(',') === 'mv1,mvLoc', 'B: movimientos, todos')
ok(subidos('sales').join(',') === 'ven1', 'B: ventas, todas')
ok((await cursor('products')) === T3 && (await cursor('sales')) === T1, 'B: los cursores quedan en el MISMO valor que en A')
ok(skippedCount() === 0, 'B: el contador no se mueve')

// --- C) Bandera explicitamente APAGADA = B --------------------------------------
await preparar(false)
await pushChanges()
await drenar()
ok(subidos('products').join(',') === 'deriv,eco,loc,tocada', 'C: apagada sube TODO, como hoy')

// --- D) Un reintento de una fila que se salta no se pierde (Review Focus 3) -------
clear()
await Promise.all(db.tables.map((t) => t.clear()))
globalThis.__escrituras = []
await db.config.bulkPut([
  { key: 'syncEnabled', value: true, updatedAt: T0 },
  { key: 'syncBusinessId', value: NEG, updatedAt: T0 }
])
await configRepo.setSubidaSinEco(true)
await db.syncState.bulkPut([
  { key: 'push:config', value: '9999-12-31T00:00:00.000Z' },
  { key: 'push:products', value: T0 },
  { key: 'retry:products', value: [{ id: 'r1', attempts: 1, lastAttemptAt: 0, lastErrorCode: 'unavailable', state: 'active' }] }
])
await mergeIncoming(P, [{ id: 'r1', name: 'R', updatedAt: T1 }])
await pushChanges()
await drenar()
ok(subidos('products').length === 0, 'D: primer ciclo: la fila bajada no se reenvia')
const cola1 = (await db.syncState.get('retry:products'))?.value || []
ok(cola1.some((e) => e.id === 'r1' && e.state === 'active'), 'D: su reintento sigue en la cola, no se pierde')
globalThis.__escrituras = []
await pushChanges()
await drenar()
ok(subidos('products').join(',') === 'r1', 'D: segundo ciclo: el reintento sale por su camino de siempre')
const cola2 = (await db.syncState.get('retry:products'))?.value || []
ok(!cola2.some((e) => e.id === 'r1'), 'D: y al confirmarse sale de la cola')

// --- E) La bandera se aplica en el siguiente ciclo, sin reabrir nada --------------
await preparar(true)
await configRepo.setSubidaSinEco(false)
await pushChanges()
await drenar()
ok(subidos('products').includes('eco'), 'E: apagada entre ciclos, el siguiente ciclo ya sube el eco')

console.log(`pushEcho (doPush se salta el eco): ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Step 2: Verificar que falla**

Run: `corre_fb src/features/sync/pushEcho.test.mjs`
Expected: `pushEcho (doPush se salta el eco): 13 OK, 8 fallos`. Fallan cinco de A (`suben la local
y la tocada…`, `sube el movimiento local…`, `el eco de la venta…`, `el contador dice 4…`, `prune
vacia…`) y tres de D (`primer ciclo…`, `su reintento sigue en la cola…`, `segundo ciclo…`: hoy la fila
sube en el primer ciclo y su reintento sale de la cola). B, C y E pasan: son la conducta de hoy. Los
cursores de A y las dos de F1 también pasan en rojo, y es correcto: no dependen de saltarse nada.

- [ ] **Step 3: Implementación**

En `src/features/sync/pushEngine.js`, añadir a los imports de la cabecera:

```js
import { split as separarEco, prune as podarEco } from './echoLedger'
import { configRepo } from '../../repositories/configRepo'
```

En `doPush`, justo después de `const ctx = { fs, setDoc, ref, serverTimestamp }`:

```js
  // Subida sin eco (spec 2026-09-27-subida-sin-eco): se lee una vez por ciclo,
  // asi que encenderla o apagarla se aplica en la siguiente subida. Si la
  // lectura fallara, la subida clasica (el lado seguro).
  const sinEco = await configRepo.getSubidaSinEco().catch(() => false)
```

Sustituir el bloque de lotes de nuevos:

```js
    // 1) NUEVOS -> lotes (como siempre). Sin await: offline queda pendiente.
    const step = batchSizeFor(col.name)
    for (let i = 0; i < nuevos.length; i += step) {
      const slice = nuevos.slice(i, i + step)
```

por:

```js
    // 1) NUEVOS -> lotes (como siempre). Sin await: offline queda pendiente.
    // Con la bandera, se quedan fuera las filas cuya version es EXACTAMENTE la
    // que llego de la nube (el eco): la nube ya la tiene. El cursor de arriba se
    // calculo sobre TODOS los nuevos, asi que queda en el mismo valor que si se
    // hubieran subido, y `changedIds` tampoco cambia (un saltado con reintento
    // pendiente se reintenta en el ciclo siguiente, por su camino de siempre).
    const { subir } = separarEco(col.name, nuevos, sinEco)
    const step = batchSizeFor(col.name)
    for (let i = 0; i < subir.length; i += step) {
      const slice = subir.slice(i, i + step)
```

Y sustituir `    await setCursorForward(col.name, maxTs)` (al final del bucle de colecciones) por:

```js
    await setCursorForward(col.name, maxTs)
    podarEco(col.name, maxTs)
```

**No tocar nada más de `doPush`**: `nuevos`, `changedIds`, `due`, la salida temprana, `maxTs`,
los reintentos individuales y `onBatchError` quedan como están.

- [ ] **Step 4: Verificar que pasa**

Run: `corre_fb src/features/sync/pushEcho.test.mjs`
Expected: `pushEcho (doPush se salta el eco): 21 OK, 0 fallos`.

- [ ] **Step 5: Equivalencia con la bandera ausente — sigue IDÉNTICA a `main` y a antes del cambio**

```bash
corre_fb src/features/sync/pushTrace.test.mjs > "$SCRATCH/trace-eco.txt"; echo "exit=$?"
cmp "$SCRATCH/trace-eco.txt" "$SCRATCH/trace-base.txt" && echo "IDENTICA A ANTES DEL CAMBIO"
cmp "$SCRATCH/trace-eco.txt" "$SCRATCH/trace-main.txt" && echo "IDENTICA A MAIN"
```

Expected: `exit=0`, `IDENTICA A ANTES DEL CAMBIO` e `IDENTICA A MAIN`. **Si difiere, PARAR:** con la
bandera ausente el cambio no puede alterar la subida (regla 2).

- [ ] **Step 6: El resto de suites que tocan la sync, sin cambios**

```bash
for t in src/features/sync/retryQueue.test.mjs src/features/sync/resend.test.mjs src/features/sync/commitWatch.test.mjs src/features/sync/deferred.test.mjs src/features/sync/cursorType.test.mjs src/features/sync/echoLedger.test.mjs; do node "$t" | tail -1; done
corre_base src/features/sync/echoMerge.test.mjs | tail -1
corre_base src/lib/syncLog.test.mjs | tail -1
```

Expected: todas en verde, con las mismas cifras que antes (`cursorType` sigue con 10; si su candado
sobre el fuente de `pushEngine.js` fallara, **leer por qué** antes de tocar nada).

- [ ] **Step 7: Build, UTF-8 y commit**

```bash
npm run build && utf8_ok src/features/sync/pushEngine.js src/features/sync/pushEcho.test.mjs
git add src/features/sync/pushEngine.js src/features/sync/pushEcho.test.mjs
git commit -m "$(cat <<'EOF'
Subida sin eco (5/6): doPush no reenvia lo que acaba de bajar, tras la bandera

Con config.subidaSinEco encendida, doPush se salta las filas cuya version es
exactamente la que llego de la nube. El cursor avanza igual que si se hubieran
subido; los reintentos, forceResend y el reenvio que compara no cambian. Con
la bandera ausente, la subida es identica a main en 300 escenarios.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Control negativo del cableado**

```bash
F=src/features/sync/pushEngine.js
mm() { node "$SCRATCH/mutar.mjs" "$F" "$1" "$2" >/dev/null && { corre_fb src/features/sync/pushEcho.test.mjs >/dev/null 2>&1 && echo "NO CAZADA: $3" || echo "cazada: $3"; }; git checkout -- "$F"; }
mm "separarEco(col.name, nuevos, sinEco)" "separarEco(col.name, nuevos, true)" "ignorar la bandera"
mm "separarEco(col.name, nuevos, sinEco)" "separarEco(col.name, nuevos, false)" "no saltar nunca"
mm "for (const x of nuevos) if (x.ts > maxTs) maxTs = x.ts" "for (const x of separarEco(col.name, nuevos, sinEco).subir) if (x.ts > maxTs) maxTs = x.ts" "cursor solo sobre los subidos"
mm "    podarEco(col.name, maxTs)" "" "no podar"
mm "const changedIds = new Set(nuevos.map((x) => x.id))" "const changedIds = new Set()" "reintentos: no excluir los nuevos"
git status --short
```

Expected: cinco líneas `cazada: …`. En «cursor solo sobre los subidos», la suite caza que el cursor de
`sales` no avanza (Review Focus 5). **Si alguna es `NO CAZADA`, añadir la aserción que falta a
`pushEcho.test.mjs`** (con otro commit) antes de seguir.

---

### Task 6: el panel de `/cloud`

**Files:**
- Modify: `src/features/sync/CloudScreen.jsx` (import; render en la línea 159; componente nuevo antes de `BajadaFiltradaPanel`, línea 230)

**Interfaces:**
- Consumes: `configRepo.getSubidaSinEco/setSubidaSinEco` (Tarea 3), `skippedCount()` (Tarea 1).

No hay pruebas de pantalla en el proyecto. La validación de esta tarea es el build, los
identificadores libres (Tarea 7) y la lectura del diff.

- [ ] **Step 1: Import**

Tras `import { COMPARE_RESENDABLE, MAX_PER_RUN } from './compareResend'` en `CloudScreen.jsx`:

```js
import { skippedCount } from './echoLedger'
```

- [ ] **Step 2: Render**

Sustituir la línea `      {cloudUser && syncEnabled && <BajadaFiltradaPanel />}` por:

```jsx
      {cloudUser && syncEnabled && <SubidaSinEcoPanel />}
      {cloudUser && syncEnabled && <BajadaFiltradaPanel />}
```

(La pantalla entera ya es solo del dueño: `if (!isOwner)` en `CloudScreen.jsx:51`.)

- [ ] **Step 3: El componente**

Justo antes del comentario `// Bajada filtrada (spec 2026-09-24-reduccion-cuota). Dice SIEMPRE si este`:

```jsx
// Subida sin eco (spec 2026-09-27-subida-sin-eco). Del NEGOCIO y apagada por
// defecto. Se aplica en el siguiente envio de cada telefono, sin reabrir la app,
// y el contador dice lo que ESTE telefono ha dejado de reenviar en la sesion:
// un ahorro que no se ve se da por hecho, que es justo como se pierde.
function SubidaSinEcoPanel() {
  const [activa, setActiva] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saltadas, setSaltadas] = useState(() => skippedCount())

  useEffect(() => {
    let vivo = true
    configRepo.getSubidaSinEco().then((v) => { if (vivo) setActiva(v) })
    // El contador vive en memoria (echoLedger): releerlo no toca la base ni la red.
    const id = setInterval(() => setSaltadas(skippedCount()), 5000)
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [])

  const cambiar = async (v) => {
    setBusy(true)
    try {
      await configRepo.setSubidaSinEco(v)
      setActiva(v)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3>Subida sin eco</h3>
      <p className="muted">
        Evita que cada teléfono vuelva a subir a la nube lo que acaba de recibir de otro.
        Ahorra escrituras y cuota. Es del negocio: se aplica a todos los teléfonos en su
        siguiente envío, sin volver a abrir la app. Lo que cada teléfono cambia se sigue
        subiendo siempre.
      </p>
      <label className="field">
        <input
          type="checkbox"
          checked={activa}
          disabled={busy}
          onChange={(e) => cambiar(e.target.checked)}
        />
        <span>No reenviar lo recibido</span>
      </label>
      <p className="muted">
        {activa
          ? <>Activa. En esta sesión, este teléfono ha dejado de reenviar {saltadas} fila(s).</>
          : <>Apagada: se sube como siempre.</>}
      </p>
    </section>
  )
}

```

- [ ] **Step 4: Build, UTF-8 y commit**

```bash
npm run build && utf8_ok src/features/sync/CloudScreen.jsx
git add src/features/sync/CloudScreen.jsx
git commit -m "$(cat <<'EOF'
Subida sin eco (6/6): interruptor en /cloud y contador de filas no reenviadas

Solo el dueño (la pantalla ya lo exige). Apagada por defecto; se aplica en el
siguiente envio de cada telefono. El contador lee la memoria del libro de ecos,
sin tocar la base ni la red.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: auditoría de cierre, acta y revisión independiente

Nada de esto es opcional, y todo se **ejecuta**: no se cita de memoria ni de otra acta.

**Files:**
- Modify: `CLAUDE.md` (bloque de comandos de pruebas; nueva sección de estado)

- [ ] **Step 1: Todas las suites, en la rama y en `main`, y comparación byte a byte**

Correr las 29 suites de node directo del bloque de `CLAUDE.md` **más** `echoLedger.test.mjs`, y las
empaquetadas: `ordersRepo`, `syncLog`, `dailyControlLocations`, `pullDeferred`, `backupCursors`,
`backupFlags`, `echoMerge` (con `corre_base`), y `pushTrace`, `pushEcho` (con `corre_fb`). Guardar la
salida de cada una en `$SCRATCH/out-head/<nombre>.txt`. Correr en `$SCRATCH/wt-main` las suites que
existen allí y guardarlas en `$SCRATCH/out-main/`. Comparar con `cmp` cada suite común.

Expected: **0 fallos** en todas. Las suites comunes con `main`, **idénticas byte a byte**. Control
negativo: añadir un byte a una copia de una salida y comprobar que `cmp` lo detecta. Anotar el total
de suites y de aserciones sumando la última línea de cada salida.

- [ ] **Step 2: Ficheros sensibles sin cambios**

```bash
git diff --stat origin/main HEAD -- src/db/db.js firestore.rules firestore.indexes.json package.json package-lock.json vite.config.js index.html src/features/sync/collections.js src/repositories/ordersRepo.js src/repositories/salesRepo.js src/features/tables
git diff --stat d709f55 HEAD -- src/features/sync/retryQueue.js src/features/sync/resend.js src/features/sync/commitWatch.js src/features/sync/deferred.js src/features/sync/syncEngine.js src/app/providers/SyncProvider.jsx
```

Expected: las dos salidas **vacías**.

- [ ] **Step 3: Líneas borradas en producción, leídas una a una**

```bash
git diff d709f55 HEAD -- src ':!*.test.mjs' ':!src/features/sync/testing' | grep -E '^-[^-]'
```

Expected (medido en la validación del plan): **exactamente tres** líneas, todas sustituciones en el
sitio: `'lastRestoreAt'` (gana la coma) y las dos del bucle de lotes de `doPush`
(`nuevos.length` → `subir.length`, `nuevos.slice` → `subir.slice`). Cualquier otra, investigarla.

- [ ] **Step 4: Escrituras nuevas a la base**

```bash
git diff d709f55 HEAD -- src ':!*.test.mjs' ':!src/features/sync/testing' | grep -E '^\+' | grep -nE '\.(add|put|bulkPut|update|delete|modify|bulkAdd)\(|transaction\('
```

Expected: una sola coincidencia, `for (const [id, ts] of m) if (ts <= cursor) m.delete(id)` de
`echoLedger.js`, que es el `Map` **en memoria** y no una tabla de Dexie. Ninguna otra.
`setSubidaSinEco` usa el `configRepo.set` existente, que no aparece en el diff.

- [ ] **Step 5: Identificadores libres (el build no los caza; no hay linter)**

Con `@babel/parser` y `@babel/traverse` de `node_modules`, recorrer los seis ficheros de producción
tocados desde `d709f55` (`echoLedger.js`, `pullEngine.js`, `pushEngine.js`, `configRepo.js`,
`backupService.js`, `CloudScreen.jsx`). Listar todo `Identifier` referenciado que no esté ligado en
su ámbito (`path.scope.hasBinding`) y no sea global conocido (`window`, `console`, `setInterval`,
`clearInterval`, `setTimeout`, `clearTimeout`, `Promise`, `Map`, `Set`, `Date`, `JSON`, `Number`,
`String`, `Boolean`, `Array`, `Object`, `Math`, `Error`, `navigator`, `confirm`, `process`).

Expected: **0**. **Control negativo:** inyectar `noExisteNunca()` en una copia de `echoLedger.js` y
comprobar que la herramienta lo lista. Sin ese control, el 0 no significa nada.

- [ ] **Step 6: Peso, medido en los dos árboles con el mismo compresor**

```bash
npx vite build --outDir "$SCRATCH/dist-head" --emptyOutDir >/dev/null 2>&1
( cd "$SCRATCH/wt-main" && npx vite build --outDir "$SCRATCH/dist-main" --emptyOutDir >/dev/null 2>&1 )
for d in dist-main dist-head; do f=$(ls "$SCRATCH/$d"/assets/index-*.js); c=$(ls "$SCRATCH/$d"/assets/index-*.css); echo "$d js=$(wc -c <"$f") gzip=$(gzip -9 -c "$f" | wc -c) css=$(basename "$c")"; done
```

Expected: el CSS con el **mismo nombre (hash)** en los dos, y el delta del JS anotado (crudo y gzip,
con porcentaje) para el acta. Los falsos de `testing/` no deben aparecer:
`grep -c "__serverTimestamp__" "$SCRATCH"/dist-head/assets/*.js` debe dar 0 en todos.

- [ ] **Step 7: `CLAUDE.md` — comandos de pruebas y acta**

En el bloque de comandos de pruebas:
- añadir `src/features/sync/echoLedger.test.mjs` a la lista de node directo;
- en el párrafo de las suites empaquetadas, añadir `backupFlags`, `echoMerge` (con base real) y
  `pushTrace`/`pushEcho`, estas dos **con los tres `--alias`** (copiar el comando de la cabecera de
  `pushTrace.test.mjs`);
- actualizar el total de suites y aserciones con la cifra **medida** en el Step 1.

Añadir, justo antes de «## Estado del trabajo (27-09-2026) — reducción de la cuota de Firestore
(F1 + F2)», una sección «## Estado del trabajo (<fecha>) — subida sin eco» con:
- qué hace y dónde vive (spec y plan);
- lo medido en los Steps 1 a 6, con sus números;
- las mutaciones cazadas de las Tareas 1, 3, 4 y 5;
- **lo que NO se puede garantizar** (spec §8, literal en el fondo): el ahorro real lo decide la
  facturación del servidor; cero runtime; nadie lo ejecutó en un teléfono ni contra Firestore;
- el orden operativo de la spec §6, incluido el procedimiento de consola;
- **«NO fusionado a `main` y NO desplegado»**.

```bash
npm run build && utf8_ok CLAUDE.md
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
Acta - subida sin eco: lo medido, las mutaciones cazadas y lo que no se garantiza

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Revisión independiente**

Usar `superpowers:requesting-code-review` con `BASE_SHA=d709f55` y `HEAD_SHA=$(git rev-parse HEAD)`,
pasándole la spec, este plan y las reglas del dueño. Pedirle que **ejecute** (build, suites,
mutaciones propias sobre `pushEngine.js` y `pullEngine.js`), no que lea el acta. Corregir los
críticos e importantes con prueba en rojo primero (TDD), y dejar anotados en el acta los que el dueño
decida no tocar.

- [ ] **Step 9: Limpieza y parada**

```bash
cmd //c rmdir "$(cygpath -w "$SCRATCH/wt-main/node_modules")"
git worktree remove --force "$SCRATCH/wt-main"; git worktree prune; git worktree list
ls node_modules/firebase/package.json
git status --short
```

Expected: solo el worktree principal, `node_modules` intacto y `git status` solo con
`.claude/settings.json`.

**PARAR AQUÍ.** Fusionar a `main` (F1+F2+esto) exige **autorización explícita del dueño** tras leer la
auditoría (regla 1). No hacer push sin que lo pida.
