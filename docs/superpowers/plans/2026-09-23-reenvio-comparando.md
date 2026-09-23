# Reenvío que compara antes de escribir — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reparar desde `/cloud` las versiones de `products`, `counts` y `auditEvents` que un aparato
tiene y la nube no, escribiendo cada documento solo si la nube no lo tiene o lo local es
estrictamente más nuevo por `syncTs`, dentro de una transacción de Firestore.

**Architecture:** Hay tres capas.
- **Lógica pura** (`compareResend.js`): decide si se escribe.
- **Núcleo del motor con dependencias inyectadas** (`compareResendEngine.js`): recorre, cierra el
  cerrojo, gestiona los errores y el tope. Se prueba con node sin Firebase ni Dexie.
- **Conexión fina** (`compareResendFirebase.js`): conecta el núcleo a Dexie, `syncConfig`,
  `runTransaction` y `logSyncEvent`.

Un panel en `CloudScreen` consume la capa fina. `pushEngine.js` no se toca.

**Tech Stack:** React 18, Dexie 4, Firebase 12 (`runTransaction`, `doc`), pruebas `.test.mjs` con
node.

**Spec:** `docs/superpowers/specs/2026-09-23-reenvio-comparando-design.md`

## Global Constraints

- Colecciones: **solo** `['products', 'counts', 'auditEvents']`.
- Se escribe si `cloud` es nulo o `syncTs(local) > syncTs(cloud)`, con comparación **estricta**.
  Con marcas iguales no se escribe.
- `MAX_PER_RUN = 1000` documentos por tanda.
- `pushEngine.js`, `src/db/`, `collections.js`, `pullEngine.js`, `retryQueue.js` y
  `firestore.rules`: **diff vacío** contra `origin/main`.
- Firebase solo con `import()` dinámico (regla 8 de `CLAUDE.md`).
- UI, comentarios y commits en **español**; imitar el estilo vecino.
- Panel solo para el dueño, con sesión de nube y sync activa, como `ResendPanel`.
- Errores a `/errors` con `logSyncEvent('comparar-reenvio', coleccion, error, detalle)`.
- `npm run build` limpio antes de cada commit; todas las suites en verde.

## Review Focus

1. **La fila local desaparece entre «Contar» y «Reparar»**, por ejemplo por una restauración. Se
   cuenta como error `sin-local`, sin reventar y sin escribir. Lo prueba la Task 2, paso 1, caso F.
2. **Documento de la nube sin marcas** (dato viejo o corrupto): `syncTs` da `''`, así que lo local
   gana y se escribe. Es el comportamiento buscado: lo prueba la Task 1, caso `decide` sin marcas.
3. **Doble toque en «Reparar»:** la segunda llamada se rechaza con un mensaje, sin correr dos tandas.
   Lo prueba la Task 2, caso D.
4. **Se cae la red a mitad de tanda:** se detiene y dice cuántos quedaron pendientes. Lo prueba la
   Task 2, caso C.
5. **Fecha «Desde» vacía o inválida:** error claro, sin empezar. Lo prueba la Task 2, caso G.

---

### Task 1: Lógica pura `compareResend.js`

**Files:**
- Create: `src/features/sync/compareResend.js`
- Test: `src/features/sync/compareResend.test.mjs`

**Interfaces:**
- Consumes: `syncTs` de `src/features/sync/collections.js` (import con `.js`, como `resend.js`).
- Produces:
  - `COMPARE_RESENDABLE: string[]` y `isCompareResendable(name: string): boolean`
  - `candidatesSince(rows: object[], sinceIso: string): object[]`
  - `decide(local: object, cloud: object|null): 'escribir'|'igual'|'nube-mas-nueva'`
  - `MAX_PER_RUN: number` (1000)
  - `summarize(results: {decision: string}[], pendientes = 0)`, que devuelve
    `{ escritos, iguales, nubeMasNueva, errores, pendientes }`

- [ ] **Paso 1: la prueba que falla** — `src/features/sync/compareResend.test.mjs`

```js
// Pruebas PURAS del reenvio que compara (spec 2026-09-23-reenvio-comparando-design.md).
// Sin framework: `node src/features/sync/compareResend.test.mjs`.
//
// QUE CAZA: (1) escribir una version que NO es mas nueva que la de la nube (haria
// retroceder a los demas aparatos); (2) colar una coleccion no aprobada; (3) que el
// recuento de candidatos no sea el mismo predicado que usa la subida.
import {
  COMPARE_RESENDABLE, isCompareResendable, candidatesSince, decide, MAX_PER_RUN, summarize
} from './compareResend.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}

// Alcance exacto (decision del duenio).
eq(COMPARE_RESENDABLE.join(','), 'products,counts,auditEvents', 'lista exacta')
for (const n of ['products', 'counts', 'auditEvents']) eq(isCompareResendable(n), true, `${n} entra`)
for (const n of ['config', 'sales', 'stockMovements', 'orders', 'images', 'x']) eq(isCompareResendable(n), false, `${n} no entra`)

// decide: la regla que hace seguro todo.
const L = (t) => ({ id: 'a', updatedAt: t })
eq(decide(L('2026-09-19T15:31:45.050Z'), null), 'escribir', 'nube sin el documento: escribir')
eq(decide(L('2026-09-19T15:31:45.050Z'), L('2026-09-14T03:52:41.413Z')), 'escribir', 'local mas nuevo: escribir')
eq(decide(L('2026-09-14T03:52:41.413Z'), L('2026-09-14T03:52:41.413Z')), 'igual', 'misma marca: igual (no escribe)')
eq(decide(L('2026-09-14T03:52:41.413Z'), L('2026-09-19T15:31:45.050Z')), 'nube-mas-nueva', 'nube mas nueva: NO escribir')
eq(decide({ id: 'a', createdAt: '2026-09-22T22:17:58.503Z' }, null), 'escribir', 'evento solo con createdAt: escribir')
eq(decide(L('2026-09-01T00:00:00.000Z'), { id: 'a' }), 'escribir', 'nube sin marcas: lo local gana')
eq(decide({ id: 'a' }, { id: 'a' }), 'igual', 'ninguno con marca: igual')
// syncTs toma la MAYOR marca: closedAt posterior a updatedAt cuenta.
eq(decide({ id: 'a', updatedAt: 'T1', closedAt: 'T9' }, { id: 'a', updatedAt: 'T5' }), 'escribir', 'usa la mayor marca (syncTs)')

// candidatesSince: mismo predicado que la subida (syncTs > desde, estricto).
const rows = [{ id: '1', updatedAt: 'T1' }, { id: '2', updatedAt: 'T5' }, { id: '3', updatedAt: 'T9' }, { id: '4' }]
eq(candidatesSince(rows, 'T5').map((r) => r.id).join(','), '3', 'estricto: T5 no entra desde T5')
eq(candidatesSince(rows, '').map((r) => r.id).join(','), '1,2,3', 'desde vacio: todas las que tienen marca')
eq(candidatesSince(null, 'T1').length, 0, 'sin filas no revienta')

eq(MAX_PER_RUN, 1000, 'tope por tanda')

// summarize
const s = summarize([{ decision: 'escribir' }, { decision: 'escribir' }, { decision: 'igual' },
  { decision: 'nube-mas-nueva' }, { decision: 'error' }], 3)
eq(JSON.stringify(s), JSON.stringify({ escritos: 2, iguales: 1, nubeMasNueva: 1, errores: 1, pendientes: 3 }), 'resumen')

console.log(`compareResend: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

- [ ] **Paso 2: ver el rojo** — `node src/features/sync/compareResend.test.mjs` → `ERR_MODULE_NOT_FOUND`.

- [ ] **Paso 3: implementación mínima** — `src/features/sync/compareResend.js`

```js
import { syncTs } from './collections.js'

// ---------------------------------------------------------------------------
// Reenvio que COMPARA antes de escribir (La Patrona §14.5; spec
// docs/superpowers/specs/2026-09-23-reenvio-comparando-design.md). PURO.
//
// El reenvio de resend.js escribe a ciegas y por eso solo admite libros
// inmutables. Este lee la nube y escribe SOLO si la nube no tiene el documento o
// lo local es ESTRICTAMENTE mas nuevo por syncTs (el mismo criterio que la bajada),
// asi que tambien vale para colecciones mutables: no puede hacer retroceder nada.
// Alcance cerrado por el duenio: las tres colecciones de La Patrona.
// ---------------------------------------------------------------------------
export const COMPARE_RESENDABLE = ['products', 'counts', 'auditEvents']

export const isCompareResendable = (name) => COMPARE_RESENDABLE.includes(name)

export const MAX_PER_RUN = 1000

// Candidatos: MISMO predicado que pushEngine (syncTs(r) > cursor, estricto).
export function candidatesSince(rows, sinceIso) {
  const list = Array.isArray(rows) ? rows : []
  return list.filter((r) => { const ts = syncTs(r); return ts && ts > (sinceIso || '') })
}

// La regla. Con marcas iguales NO se escribe: lo que pueda diferir son campos
// derivados (la cache del stock) que cada aparato recalcula por su cuenta.
export function decide(local, cloud) {
  if (!cloud) return 'escribir'
  const l = syncTs(local) || ''
  const c = syncTs(cloud) || ''
  if (l > c) return 'escribir'
  if (l === c) return 'igual'
  return 'nube-mas-nueva'
}

export function summarize(results, pendientes = 0) {
  const out = { escritos: 0, iguales: 0, nubeMasNueva: 0, errores: 0, pendientes }
  for (const r of Array.isArray(results) ? results : []) {
    if (r.decision === 'escribir') out.escritos++
    else if (r.decision === 'igual') out.iguales++
    else if (r.decision === 'nube-mas-nueva') out.nubeMasNueva++
    else out.errores++
  }
  return out
}
```

- [ ] **Paso 4: ver el verde** — `node src/features/sync/compareResend.test.mjs` → `compareResend: N OK, 0 fallos` (el número lo da la suite; contadas a mano son 23).

- [ ] **Paso 5: controles negativos.** Cada uno debe hacer fallar su caso; después se restaura el
  código y se vuelve a comprobar el verde:
  - (a) cambiar `if (l > c)` por `if (l >= c)`: falla «misma marca: igual»;
  - (b) quitar `if (l === c) return 'igual'`: falla «misma marca»;
  - (c) cambiar `return 'nube-mas-nueva'` por `return 'escribir'`: falla «nube mas nueva: NO escribir».

- [ ] **Paso 6: commit**

```bash
git add src/features/sync/compareResend.js src/features/sync/compareResend.test.mjs
git commit -m "Sync - reenvio que compara (1/4): regla pura de decision y alcance cerrado"
```

---

### Task 2: Núcleo del motor `compareResendEngine.js` (dependencias inyectadas)

**Files:**
- Create: `src/features/sync/compareResendEngine.js`
- Test: `src/features/sync/compareResendEngine.test.mjs`

**Interfaces:**
- Consumes: de la Task 1, `isCompareResendable`, `candidatesSince`, `decide`, `MAX_PER_RUN` y
  `summarize`.
- Produces: `createCompareResender(deps)`, que devuelve `{ count(name, sinceIso): Promise<number>,
  run(name, sinceIso, { onProgress } = {}): Promise<summary> }`.
  - `deps.listLocal(name)`: `Promise<object[]>`, las filas locales.
  - `deps.getLocal(name, id)`: `Promise<object|undefined>`.
  - `deps.pkOf(name)`: `string` (`'id'` para las tres).
  - `deps.ready()`: `Promise<string|null>`; `null` si se puede empezar, o el motivo en español.
  - `deps.isOnline()`: `boolean`.
  - `deps.runTx(name, id, fn)`: `Promise<decision>`. Ejecuta `fn(cloudData|null)` dentro de una
    transacción, y `fn` devuelve `{ decision, write }`. Si `write` no es nulo, la transacción lo
    escribe. En una contención, Firestore puede llamar a `fn` más de una vez.
  - `deps.log(stage, col, error, detail)`: registro, sin valor de retorno.

- [ ] **Paso 1: la prueba que falla** — `src/features/sync/compareResendEngine.test.mjs`

```js
// Pruebas del nucleo del reenvio que compara, con una "nube" en memoria.
// Sin framework: `node src/features/sync/compareResendEngine.test.mjs`.
import { createCompareResender } from './compareResendEngine.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}

// Montaje: local y nube como Map por coleccion. runTx llama fn con la version de
// la nube y aplica la escritura, como haria Firestore.
function harness({ local = {}, cloud = {}, online = true, ready = null, txHook } = {}) {
  const L = new Map(Object.entries(local).map(([c, rows]) => [c, new Map(rows.map((r) => [r.id, r]))]))
  const C = new Map(Object.entries(cloud).map(([c, rows]) => [c, new Map(rows.map((r) => [r.id, r]))]))
  const logs = []
  const writes = []
  const deps = {
    listLocal: async (n) => [...(L.get(n) || new Map()).values()],
    getLocal: async (n, id) => (L.get(n) || new Map()).get(id),
    pkOf: () => 'id',
    ready: async () => ready,
    isOnline: () => online,
    runTx: async (n, id, fn) => {
      if (txHook) await txHook(n, id)
      const col = C.get(n) || new Map()
      const r = await fn(col.get(id) || null)
      if (r.write) { col.set(id, r.write); C.set(n, col); writes.push(`${n}/${id}`) }
      return r.decision
    },
    log: (stage, col, err, detail) => logs.push({ stage, col, code: err?.code, detail })
  }
  return { r: createCompareResender(deps), L, C, logs, writes, deps, setOnline: (v) => { online = v } }
}
const P = (id, t, extra = {}) => ({ id, name: `P${id}`, updatedAt: t, ...extra })

// A. La nube vieja se repara; la nube mas nueva NO se toca; iguales no se escriben.
{
  const h = harness({
    local: { products: [P('1', 'T9', { price: 4600 }), P('2', 'T5'), P('3', 'T2'), P('4', 'T7')] },
    cloud: { products: [P('1', 'T3', { price: 3800 }), P('2', 'T5'), P('3', 'T8')] }
  })
  const s = await h.r.run('products', '')
  eq(JSON.stringify(s), JSON.stringify({ escritos: 2, iguales: 1, nubeMasNueva: 1, errores: 0, pendientes: 0 }), 'resumen')
  eq(h.C.get('products').get('1').price, 4600, 'la nube vieja recibe la version local')
  eq(h.C.get('products').get('3').updatedAt, 'T8', 'la nube MAS NUEVA no se toca')
  eq(h.C.get('products').has('4'), true, 'la que faltaba en la nube se escribe')
  eq(h.writes.join(','), 'products/1,products/4', 'solo se escribe lo necesario')
}
// B. Reintento de la transaccion: otro aparato escribe algo MAS NUEVO entre medias;
// la segunda llamada de fn decide sobre esa version y no escribe.
{
  let calls = 0
  const cloud = { products: [P('1', 'T3')] }
  const h = harness({ local: { products: [P('1', 'T5')] }, cloud })
  h.deps.runTx = async (n, id, fn) => {
    calls++
    const first = await fn({ ...P('1', 'T3') })     // primera pasada: la nube vieja
    if (first.write) {
      const retry = await fn({ ...P('1', 'T6') })   // contencion: Firestore repite con la nueva
      return retry.decision
    }
    return first.decision
  }
  const r2 = createCompareResender(h.deps)
  const s = await r2.run('products', '')
  eq(s.nubeMasNueva, 1, 'tras el reintento decide sobre la version nueva: nube-mas-nueva')
  eq(s.escritos, 0, 'y no cuenta como escrito')
}
// C. Se cae la red a mitad: se detiene y dice cuantos quedaron.
{
  let n = 0
  const h = harness({
    local: { counts: [P('1', 'T1'), P('2', 'T2'), P('3', 'T3'), P('4', 'T4')] },
    txHook: async () => { n++; if (n === 2) { const e = new Error('offline'); e.code = 'unavailable'; throw e } }
  })
  const s = await h.r.run('counts', '')
  eq(s.escritos, 1, 'antes del corte se escribio 1')
  eq(s.errores, 1, 'el corte cuenta como error')
  eq(s.pendientes, 2, 'quedan 2 pendientes')
  eq(h.logs.some((l) => l.stage === 'comparar-reenvio' && l.code === 'unavailable'), true, 'el corte va a /errors')
}
// Un error que NO es de red se cuenta y se sigue.
{
  let n = 0
  const h = harness({
    local: { auditEvents: [{ id: '1', createdAt: 'T1' }, { id: '2', createdAt: 'T2' }] },
    txHook: async () => { n++; if (n === 1) { const e = new Error('x'); e.code = 'permission-denied'; throw e } }
  })
  const s = await h.r.run('auditEvents', '')
  eq(s.errores, 1, 'error no de red: se cuenta')
  eq(s.escritos, 1, 'y se sigue con el siguiente')
}
// D. Doble toque: la segunda tanda se rechaza mientras corre la primera.
{
  let release
  const gate = new Promise((r) => { release = r })
  const h = harness({ local: { products: [P('1', 'T1')] }, txHook: () => gate })
  const first = h.r.run('products', '')
  let msg = ''
  try { await h.r.run('products', '') } catch (e) { msg = e.message }
  eq(/ya hay una reparacion en curso/i.test(msg), true, `segunda tanda rechazada: ${msg}`)
  release(); await first
  const again = await h.r.run('products', '')
  eq(again.iguales, 1, 'terminada la primera, se puede volver a lanzar')
}
// E. Tope por tanda, coleccion no admitida, sin red y sin sync.
{
  const many = Array.from({ length: 1001 }, (_, i) => P(String(i), `T${String(i).padStart(5, '0')}`))
  const h = harness({ local: { products: many } })
  let m = ''
  try { await h.r.run('products', '') } catch (e) { m = e.message }
  eq(/1001/.test(m) && /1000/.test(m), true, `tope: ${m}`)
  eq(h.writes.length, 0, 'con el tope superado no escribe nada')
  let m2 = ''
  try { await h.r.run('sales', '') } catch (e) { m2 = e.message }
  eq(/no se puede reparar/i.test(m2), true, `coleccion no admitida: ${m2}`)
  const off = harness({ local: { products: [P('1', 'T1')] }, online: false })
  let m3 = ''
  try { await off.r.run('products', '') } catch (e) { m3 = e.message }
  eq(/sin conexi/i.test(m3), true, `sin red no empieza: ${m3}`)
  const nosync = harness({ local: { products: [P('1', 'T1')] }, ready: 'La sincronización no está activa en este aparato' })
  let m4 = ''
  try { await nosync.r.run('products', '') } catch (e) { m4 = e.message }
  eq(/no est/i.test(m4), true, `sin sync no empieza: ${m4}`)
}
// F. La fila local desaparece entre contar y reparar: error, sin escribir.
{
  const h = harness({ local: { products: [P('1', 'T5')] } })
  h.deps.getLocal = async () => undefined
  const r3 = createCompareResender(h.deps)
  const s = await r3.run('products', '')
  eq(s.errores, 1, 'sin fila local: error')
  eq(h.writes.length, 0, 'y no escribe')
}
// G. Fecha invalida; y count es local y coincide con lo que se revisaria.
{
  const h = harness({ local: { products: [P('1', 'T1'), P('2', 'T5')] } })
  let m = ''
  try { await h.r.run('products', null) } catch (e) { m = e.message }
  eq(/fecha/i.test(m), true, `sin fecha: ${m}`)
  eq(await h.r.count('products', 'T1'), 1, 'count estricto desde T1')
  eq(await h.r.count('products', ''), 2, 'count desde vacio')
}
// Progreso
{
  const seen = []
  const h = harness({ local: { products: [P('1', 'T1'), P('2', 'T2')] } })
  await h.r.run('products', '', { onProgress: (done, total) => seen.push(`${done}/${total}`) })
  eq(seen.join(','), '1/2,2/2', 'progreso por documento')
}

console.log(`compareResendEngine: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
```

Nota para la Task 2: en el caso G, `run(name, null)` exige fecha. `''` (todas) solo se admite de forma
**explícita**. Es la herramienta del script de validación y de las pruebas; el panel siempre pasa una
fecha.

- [ ] **Paso 2: ver el rojo** — `node src/features/sync/compareResendEngine.test.mjs` → `ERR_MODULE_NOT_FOUND`.

- [ ] **Paso 3: implementación mínima** — `src/features/sync/compareResendEngine.js`

```js
import { isCompareResendable, candidatesSince, decide, MAX_PER_RUN, summarize } from './compareResend.js'

// ---------------------------------------------------------------------------
// Nucleo del reenvio que compara (spec 2026-09-23). Todo lo externo se inyecta
// (Dexie, syncConfig, Firestore, registro), asi que se prueba con node sin nada de
// eso. compareResendFirebase.js lo conecta a lo real.
//
// No usa el cursor, ni la cola de reintentos, ni el cerrojo `running` de la
// subida: si la subida normal hace a la vez un set a ciegas del mismo documento,
// escribe la MISMA version local (sale del mismo aparato). Cerrojo propio para
// que no corran dos tandas a la vez.
// ---------------------------------------------------------------------------
const toCloud = (rec) => JSON.parse(JSON.stringify(rec)) // la misma conversion que la subida

export function createCompareResender(deps) {
  let comparing = false

  async function candidates(name, sinceIso) {
    if (!isCompareResendable(name)) throw new Error('Esa colección no se puede reparar comparando')
    if (typeof sinceIso !== 'string') throw new Error('Escribe una fecha válida.')
    return candidatesSince(await deps.listLocal(name), sinceIso)
  }

  async function count(name, sinceIso) {
    return (await candidates(name, sinceIso)).length
  }

  async function run(name, sinceIso, { onProgress } = {}) {
    if (comparing) throw new Error('Ya hay una reparación en curso: espera a que termine')
    comparing = true
    try {
      const rows = await candidates(name, sinceIso)
      if (rows.length > MAX_PER_RUN) {
        throw new Error(`Hay ${rows.length} documentos desde esa fecha: acota la fecha (máximo ${MAX_PER_RUN} por tanda).`)
      }
      const why = await deps.ready()
      if (why) throw new Error(why)
      if (!deps.isOnline()) throw new Error('Sin conexión: la reparación necesita internet para comparar con la nube')

      const pk = deps.pkOf(name)
      const results = []
      for (let i = 0; i < rows.length; i++) {
        const id = String(rows[i][pk])
        try {
          const local = await deps.getLocal(name, id) // se relee: puede haber cambiado
          if (!local) {
            results.push({ id, decision: 'error' })
            deps.log('comparar-reenvio', name, { code: 'sin-local' }, id)
          } else {
            const decision = await deps.runTx(name, id, async (cloud) => {
              const d = decide(local, cloud)
              return { decision: d, write: d === 'escribir' ? toCloud(local) : null }
            })
            results.push({ id, decision })
          }
        } catch (e) {
          results.push({ id, decision: 'error' })
          deps.log('comparar-reenvio', name, e, id)
          if (e?.code === 'unavailable') {
            if (onProgress) onProgress(i + 1, rows.length)
            return summarize(results, rows.length - (i + 1))
          }
        }
        if (onProgress) onProgress(i + 1, rows.length)
      }
      return summarize(results, 0)
    } finally {
      comparing = false
    }
  }

  return { count, run }
}
```

- [ ] **Paso 4: ver el verde** — `node src/features/sync/compareResendEngine.test.mjs` → `compareResendEngine: N OK, 0 fallos` (el número lo da la suite; contadas a mano son 26).

- [ ] **Paso 5: controles negativos.** Cada uno debe hacer fallar su caso; después se restaura:
  - (a) escribir siempre (`write: toCloud(local)`): fallan los casos A y B;
  - (b) quitar el cerrojo (`if (comparing) ...`): falla el caso D;
  - (c) quitar el corte por `unavailable`: falla el caso C;
  - (d) quitar la relectura y usar `rows[i]`: falla el caso F.

- [ ] **Paso 6: commit**

```bash
git add src/features/sync/compareResendEngine.js src/features/sync/compareResendEngine.test.mjs
git commit -m "Sync - reenvio que compara (2/4): nucleo con dependencias inyectadas, cerrojo, tope y corte por red"
```

---

### Task 3: Conexión real y validación con los respaldos de La Patrona

**Files:**
- Create: `src/features/sync/compareResendFirebase.js`
- Create: `docs/auditoria/validar-reenvio-comparando.mjs` (fuera del bundle)

**Interfaces:**
- Consumes: `createCompareResender` (Task 2); `db` (`../../db/db`); `syncConfig`
  (`./syncService`); `getFirebase` (`../../lib/firebase`); `logSyncEvent` (`../../lib/syncLog`).
- Produces: `countCompareResend(name, sinceIso): Promise<number>` y
  `compareResend(name, sinceIso, { onProgress }): Promise<summary>`, para `CloudScreen`.

- [ ] **Paso 1: la conexión** — `src/features/sync/compareResendFirebase.js`

```js
import { db } from '../../db/db'
import { syncConfig } from './syncService'
import { getFirebase } from '../../lib/firebase'
import { logSyncEvent } from '../../lib/syncLog'
import { createCompareResender } from './compareResendEngine'

// Conexion REAL del reenvio que compara (spec 2026-09-23): Dexie para lo local y
// una transaccion de Firestore por documento (lee del SERVIDOR, compara y escribe
// atomicamente; si otro aparato escribe entre medias, Firestore la repite).
// Firebase se carga con import() dinamico, como en toda la app.
let cached = null

async function ready() {
  if (!(await syncConfig.isEnabled())) return 'La sincronización no está activa en este aparato'
  if (!(await syncConfig.businessId())) return 'Este aparato no tiene un negocio vinculado a la nube'
  const { auth } = await getFirebase()
  if (!auth.currentUser) return 'No hay sesión abierta con la nube en este aparato'
  return null
}

async function runTx(name, id, fn) {
  const { db: fs } = await getFirebase()
  const businessId = await syncConfig.businessId()
  const { doc, runTransaction } = await import('firebase/firestore')
  const ref = doc(fs, 'businesses', businessId, name, id)
  return runTransaction(fs, async (tx) => {
    const snap = await tx.get(ref)
    const r = await fn(snap.exists() ? snap.data() : null)
    if (r.write) tx.set(ref, r.write)
    return r.decision
  })
}

function resender() {
  if (!cached) {
    cached = createCompareResender({
      listLocal: (name) => db[name].toArray(),
      getLocal: (name, id) => db[name].get(id),
      pkOf: () => 'id',
      ready,
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
      runTx,
      log: logSyncEvent
    })
  }
  return cached
}

export const countCompareResend = (name, sinceIso) => resender().count(name, sinceIso)
export const compareResend = (name, sinceIso, opts) => resender().run(name, sinceIso, opts)
```

- [ ] **Paso 2: el script de validación** — `docs/auditoria/validar-reenvio-comparando.mjs`

```js
// Valida el reenvio que compara con respaldos REALES, sin tocar la nube: un respaldo
// hace de LOCAL y otro de NUBE (en memoria). Uso:
//   node docs/auditoria/validar-reenvio-comparando.mjs <local.json> <nube.json>
// La nube real no es el otro respaldo: esto valida la LOGICA, no la nube.
import { readFileSync } from 'node:fs'
import { createCompareResender } from '../../src/features/sync/compareResendEngine.js'
import { COMPARE_RESENDABLE } from '../../src/features/sync/compareResend.js'

const [fl, fc] = process.argv.slice(2)
if (!fl || !fc) { console.error('Uso: node docs/auditoria/validar-reenvio-comparando.mjs <local.json> <nube.json>'); process.exit(2) }
const L = JSON.parse(readFileSync(fl, 'utf8')).tables
const C = JSON.parse(readFileSync(fc, 'utf8')).tables
const cloud = new Map(COMPARE_RESENDABLE.map((n) => [n, new Map((C[n] || []).map((r) => [r.id, r]))]))
const r = createCompareResender({
  listLocal: async (n) => L[n] || [],
  getLocal: async (n, id) => (L[n] || []).find((x) => x.id === id),
  pkOf: () => 'id',
  ready: async () => null,
  isOnline: () => true,
  runTx: async (n, id, fn) => { const res = await fn(cloud.get(n).get(id) || null); if (res.write) cloud.get(n).set(id, res.write); return res.decision },
  log: () => {}
})
console.log(`local ${fl}\nnube  ${fc}`)
for (const n of COMPARE_RESENDABLE) console.log(n.padEnd(12), JSON.stringify(await r.run(n, '')))
```

- [ ] **Paso 3: correrlo en los dos sentidos** con los respaldos reales de La Patrona:
  - A (`Downloads/respaldo_mypicuadre_2026-09-22dueña.json`, SHA `68307298…`);
  - B (`Downloads/respaldo_mypicuadre_2026-09-22ventas.json`, SHA `3e1fa722…`).

  Esperado:
  - **A local → B nube:** `products` escritos 36, nubeMasNueva 0; `counts` escritos 3;
    `auditEvents` escritos 5; errores 0.
  - **B local → A nube:** escritos **0** en las tres, y `products` nubeMasNueva **36**.

  Si alguna cifra no coincide, **parar** e investigar antes de seguir.

- [ ] **Paso 4: build** — `npm run build` → exit 0. Comprobar también que
  `grep -l "comparar-reenvio" dist/assets/*.js` da 0 ficheros: la conexión aún no se importa desde
  ninguna pantalla.

- [ ] **Paso 5: commit**

```bash
git add src/features/sync/compareResendFirebase.js docs/auditoria/validar-reenvio-comparando.mjs
git commit -m "Sync - reenvio que compara (3/4): conexion con Firestore por transaccion y validacion con los respaldos de La Patrona"
```

---

### Task 4: Panel en `/cloud`, invariantes y actas

**Files:**
- Modify: `src/features/sync/CloudScreen.jsx` (imports; montar `<CompareResendPanel />` justo
  después de `<ResendPanel />` en la línea 152; componente nuevo al final del fichero)
- Modify: `CLAUDE.md` (bucle de pruebas y recuento; estado del trabajo)

**Interfaces:**
- Consumes: `countCompareResend` y `compareResend` (Task 3); `COMPARE_RESENDABLE` (Task 1);
  `localInputToIso` (`./resend`, ya importado).

- [ ] **Paso 1: import y montaje.** En la cabecera de `CloudScreen.jsx`, tras la línea
  `import { RESENDABLE, localInputToIso } from './resend'`, añadir:

```js
import { COMPARE_RESENDABLE } from './compareResend'
import { countCompareResend, compareResend } from './compareResendFirebase'
```

  Y sustituir `{cloudUser && syncEnabled && <ResendPanel />}` por:

```jsx
      {cloudUser && syncEnabled && <ResendPanel />}
      {cloudUser && syncEnabled && <CompareResendPanel />}
```

- [ ] **Paso 2: el componente**, al final de `CloudScreen.jsx`:

```jsx
// Panel «Reparar versiones (comparando con la nube)» (spec 2026-09-23). Para
// colecciones que CAMBIAN: lee la version de la nube y solo escribe si la local es
// mas nueva, asi que no puede hacer retroceder nada aunque se lance en el aparato
// equivocado. Solo reparacion manual del dueño, con el coste a la vista.
const COMPARE_LABELS = {
  products: 'Productos (fichas)',
  counts: 'Conteos físicos',
  auditEvents: 'Eventos de auditoría'
}

function CompareResendPanel() {
  const [col, setCol] = useState(COMPARE_RESENDABLE[0])
  const [when, setWhen] = useState('')
  const [sinceIso, setSinceIso] = useState(null)
  const [count, setCount] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const reset = () => { setCount(null); setSinceIso(null); setOk(''); setProgress('') }
  const changeCol = (e) => { setCol(e.target.value); reset(); setError('') }
  const changeWhen = (e) => { setWhen(e.target.value); reset(); setError('') }

  const doCount = async () => {
    setError(''); setOk(''); setBusy(true)
    try {
      const iso = localInputToIso(when)
      if (!iso) throw new Error('Escribe una fecha válida.')
      setCount(await countCompareResend(col, iso))
      setSinceIso(iso)
    } catch (e) {
      setError(e.message); setCount(null); setSinceIso(null)
    } finally { setBusy(false) }
  }

  const doRun = async () => {
    setError(''); setOk(''); setBusy(true); setProgress('')
    try {
      const s = await compareResend(col, sinceIso, { onProgress: (d, t) => setProgress(`${d} / ${t}`) })
      const msg = `Escritos: ${s.escritos}. Ya iguales: ${s.iguales}. La nube tenía uno más nuevo (no se tocó): ${s.nubeMasNueva}.` +
        (s.errores ? ` Errores: ${s.errores} (ver /errors).` : '') +
        (s.pendientes ? ` Quedaron ${s.pendientes} sin revisar: se cortó la conexión.` : '')
      if (s.errores || s.pendientes) setError(msg); else setOk(msg)
      setCount(null); setSinceIso(null)
    } catch (e) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  return (
    <section className="card">
      <h3>Reparar versiones (comparando con la nube)</h3>
      <label className="field">
        <span>Colección</span>
        <select value={col} onChange={changeCol}>
          {COMPARE_RESENDABLE.map((name) => (
            <option key={name} value={name}>{COMPARE_LABELS[name] || name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Desde</span>
        <input type="datetime-local" value={when} onChange={changeWhen} />
      </label>

      <button className="btn btn--block" disabled={busy} onClick={doCount}>Contar</button>

      {count !== null && sinceIso && (
        <p className="muted">
          Se revisarán {count} documentos desde el {new Date(sinceIso).toLocaleString('es')}. Gasta {count}{' '}
          lecturas y, como mucho, {count} escrituras de la cuota de Firestore. Solo se escribe lo que la nube
          tenga más viejo o no tenga.
        </p>
      )}

      <button
        className="btn btn--primary btn--block"
        disabled={busy || count === null || count <= 0}
        onClick={doRun}
      >
        {busy && progress ? `Revisando… ${progress}` : count ? `Reparar ${count} documentos` : 'Reparar documentos'}
      </button>

      {error && <p className="error">{error}</p>}
      {ok && <p className="ok-text">{ok}</p>}

      <p className="muted">
        <small>
          Úsalo en el aparato que tiene los datos buenos. Necesita internet. Lanzarlo en el aparato
          equivocado no estropea nada: lo que en la nube ya sea más nuevo no se toca.
        </small>
      </p>
    </section>
  )
}
```

- [ ] **Paso 3: invariantes.** Todos se ejecutan y se anotan con su resultado:
  - `npm run build` → exit 0, y el peso del chunk contra el de `732f4ec` (1.011.569 B);
  - `git diff --stat origin/main -- src/features/sync/pushEngine.js src/db src/features/sync/collections.js src/features/sync/pullEngine.js src/features/sync/retryQueue.js firestore.rules`
    → **vacío**;
  - identificadores sin definir en los 5 ficheros tocados → 0, con control negativo;
  - el bucle de `CLAUDE.md`, más `ordersRepo` y `syncLog` empaquetadas → todo en verde, con el total
    sumado de la salida real.

- [ ] **Paso 4: `CLAUDE.md`.** Añadir al bucle `src/features/sync/compareResend.test.mjs` y
  `src/features/sync/compareResendEngine.test.mjs` **con la herramienta de edición**, nunca con un
  `\n` de Python. Luego ejecutar el bucle copiado del propio fichero y comprobar que
  `grep -cF '\n' CLAUDE.md` da 0. Actualizar el recuento con la suma real. En «Estado del trabajo»,
  una viñeta con lo hecho y lo que no se puede garantizar (spec §5).

- [ ] **Paso 5: commit y subida a la rama**

```bash
git add src/features/sync/CloudScreen.jsx CLAUDE.md
git commit -m "Sync - reenvio que compara (4/4): panel en /cloud solo del duenio, invariantes y actas"
git push origin claude/awesome-dirac-484azm
```

---

### Task 5: Revisión independiente de toda la función

- [ ] Lanzar una revisión (superpowers:requesting-code-review) sobre el rango de las Tasks 1–4 que
  verifique:
  - que ningún camino escribe una versión no más nueva que la de la nube;
  - que la transacción lee del servidor;
  - la puerta de dueño y sync;
  - el coste en cuota;
  - que `pushEngine` no se tocó;
  - que no hay fugas;
  - la convivencia con teléfonos de la versión anterior.
- [ ] Aplicar lo que encuentre con TDD y control negativo. Añadir el acta en
  `docs/AUDITORIA-LA-PATRONA-22-09-2026.md` §14.7, con los resultados del script en los dos
  sentidos y lo que no se puede garantizar.
- [ ] **No fusionar a `main`**: pedir la autorización y la auditoría previa.
