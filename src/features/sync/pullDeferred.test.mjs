// Prueba CON BASE (fake-indexeddb) de P2: el sello `_up` NO entra en Dexie y su
// maximo alimenta el cursor de la bajada diferida (spec 2026-09-24-reduccion-cuota
// §10.2). Usa el `mergeIncoming` REAL, que es lo unico del cableado que se puede
// probar sin Firestore. No corre con node directo porque pullEngine importa sin
// extension: se empaqueta con el esbuild de Vite.
//   npx esbuild src/features/sync/pullDeferred.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/pullDeferred.bundle.mjs && node <scratch>/...
import 'fake-indexeddb/auto'
import { db } from '../../db/db'
import { mergeIncoming } from './pullEngine'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }

const COL_MOV = { name: 'stockMovements', pk: 'id' }
const COL_PROD = { name: 'products', pk: 'id' }
const VIEJO = '2026-09-20T10:00:00.000Z'
const NUEVO = '2026-09-25T10:00:00.000Z'

// Remedo del Timestamp del SDK con su FORMA REAL, medida (no supuesta) sobre
// `firebase` 12.15.0: datos propios `seconds`/`nanoseconds` y `toMillis` en el
// PROTOTIPO. Importa: un objeto con `toMillis` como propiedad propia NO es
// clonable por structuredClone y Dexie lo rechazaria, asi que probaria un modo
// de fallo que no existe. El SDK de verdad no se importa aqui porque su entrada
// de node arrastra grpc y no se deja empaquetar para este arnes.
class TimestampComoElSDK {
  constructor(ms) {
    this.seconds = Math.floor(ms / 1000)
    this.nanoseconds = (ms % 1000) * 1e6
  }

  toMillis() {
    return this.seconds * 1000 + this.nanoseconds / 1e6
  }
}
const ts = (ms) => new TimestampComoElSDK(ms)

const limpiar = () => Promise.all(db.tables.map((t) => t.clear()))

// 1. El sello no entra en Dexie, y el maximo vuelve al llamador.
await limpiar()
const entrantes = [
  { id: 'm1', productId: 'p1', qty: 5, location: 'Salon', createdAt: VIEJO, updatedAt: VIEJO, _up: ts(1000) },
  { id: 'm2', productId: 'p1', qty: -2, location: 'Salon', createdAt: NUEVO, updatedAt: NUEVO, _up: ts(3000) },
  { id: 'm3', productId: 'p2', qty: 1, location: 'Salon', createdAt: NUEVO, updatedAt: NUEVO } // build viejo
]
const afectados = await mergeIncoming(COL_MOV, entrantes)
const guardados = await db.stockMovements.toArray()
ok(guardados.length === 3, 'entran los tres movimientos')
ok(guardados.every((m) => !('_up' in m)), 'NINGUNA fila guardada lleva _up (ni viaja en respaldos ni se resube)')
ok(afectados instanceof Set, 'el valor de retorno sigue siendo un Set (sus consumidores no cambian)')
ok(afectados.has('p1') && afectados.has('p2'), 'y sigue trayendo los productos afectados')
ok(afectados.maxUpMs === 3000, 'devuelve el MAXIMO _up de la tanda, que es lo unico que se conserva')

// 2. Una tanda sin ningun sello no mueve el cursor.
await limpiar()
const sinSello = await mergeIncoming(COL_MOV, [
  { id: 'm9', productId: 'p1', qty: 1, createdAt: NUEVO, updatedAt: NUEVO }
])
ok(sinSello.maxUpMs == null, 'tanda sin sellos -> sin maximo (el cursor no puede avanzar)')

// 3. EL LWW NO CAMBIA: `_up` no entra en la marca de sync. Un documento con un
//    `_up` nuevisimo pero `updatedAt` viejo NO puede pisar lo local.
await limpiar()
await db.products.put({ id: 'p1', name: 'Jugo', price: 100, updatedAt: NUEVO })
const pisar = await mergeIncoming(COL_PROD, [
  { id: 'p1', name: 'Jugo', price: 999, updatedAt: VIEJO, _up: ts(999999) }
])
ok((await db.products.get('p1')).price === 100, 'lo entrante mas VIEJO no pisa, aunque su _up sea el mas nuevo')
ok(pisar.maxUpMs === 999999, 'pero su _up si cuenta para el cursor: llego, y no hay que volver a pedirlo')

// 4. Una coleccion SIN sello se comporta exactamente como hoy.
await limpiar()
const sinSelloCol = await mergeIncoming(COL_PROD, [{ id: 'p7', name: 'Pan', updatedAt: NUEVO }])
const p7 = await db.products.get('p7')
ok(Object.keys(p7).sort().join(',') === 'id,name,updatedAt', 'el registro local queda IDENTICO al de hoy')
ok(sinSelloCol.maxUpMs == null, 'y sin maximo')

// 4bis. El Timestamp PLANO, que es como queda tras structuredClone (medido) y
// como llega desde la cache.
await limpiar()
const plano = await mergeIncoming(COL_MOV, [
  { id: 'm8', productId: 'p1', qty: 1, createdAt: NUEVO, updatedAt: NUEVO, _up: { seconds: 7, nanoseconds: 500000000 } }
])
ok(plano.maxUpMs === 7500, 'el Timestamp plano (cache/serializado) tambien cuenta para el cursor')
ok(!('_up' in (await db.stockMovements.get('m8'))), 'y tampoco entra en Dexie')

// 4ter. Aunque la tanda entera se descarte por no traer clave primaria, el
// maximo se conserva: si no, esos documentos se volverian a pedir en CADA timbre.
await limpiar()
const sinClave = await mergeIncoming(COL_MOV, [{ productId: 'p1', qty: 1, _up: ts(5555) }])
ok(sinClave.maxUpMs === 5555, 'una tanda descartada entera sigue moviendo el cursor')
ok(sinClave.size === 0, 'y no afecta a ningun producto')

// 5. No muta el documento que le dieron (la copia es nueva).
await limpiar()
const original = { id: 'm5', productId: 'p1', qty: 1, createdAt: NUEVO, updatedAt: NUEVO, _up: ts(42) }
await mergeIncoming(COL_MOV, [original])
ok(original._up != null, 'el documento entrante no se toca (se copia antes de quitarle el sello)')

console.log(`pullDeferred (el sello no entra en Dexie): ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
