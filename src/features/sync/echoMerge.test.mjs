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
