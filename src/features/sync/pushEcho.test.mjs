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
