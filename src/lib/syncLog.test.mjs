// Prueba CON BASE (fake-indexeddb) del escritor del registro de la sync. No corre con
// node directo (errorsRepo importa sin extension): se empaqueta con el esbuild de Vite.
//   npx esbuild src/lib/syncLog.test.mjs --bundle --platform=node --format=esm \
//     --outfile=<scratch>/syncLog.test.bundle.mjs && node <scratch>/syncLog.test.bundle.mjs
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { logSyncEvent } from './syncLog'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
// errorsRepo.add no se espera: se sondea hasta que el recuento llegue (o 2 s).
const settle = async (min = 0) => {
  for (let i = 0; i < 40; i++) {
    if ((await db.errorLog.count()) >= min) return
    await new Promise((r) => setTimeout(r, 50))
  }
}
// En el navegador window === globalThis, asi que location es global.
globalThis.location = { pathname: '/cloud' }

await db.errorLog.clear()
logSyncEvent('subida-lote-rechazado', 'stockMovements', { code: 'unavailable', message: 'Backend unavailable' }, '3 fila(s) T1..T3')
await settle()
let rows = await db.errorLog.toArray()
ok(rows.length === 1, 'se guarda una entrada')
ok(rows[0]?.source === 'sync', 'con origen sync')
ok(rows[0]?.message === 'subida-lote-rechazado stockMovements unavailable: 3 fila(s) T1..T3 · Backend unavailable', `mensaje completo: ${rows[0]?.message}`)
ok(rows[0]?.route === '/cloud', 'con la pantalla')

// El mismo fallo en el siguiente ciclo (otro detalle): NO se repite.
logSyncEvent('subida-lote-rechazado', 'stockMovements', { code: 'unavailable' }, '1 fila(s) T4..T4')
await settle()
ok((await db.errorLog.count()) === 1, 'el mismo fallo no se repite en la sesion')

// Otra coleccion o etapa: si.
logSyncEvent('bajada-oyente-caido', 'products', { code: 'permission-denied' })
await settle()
rows = await db.errorLog.toArray()
ok(rows.length === 2, 'otra etapa/coleccion se guarda')

// Nunca lanza, ni con errores raros ni sin window.
let threw = false
try {
  logSyncEvent('x', null, undefined)
  logSyncEvent('y', null, Object.create(null))
  const l = globalThis.location
  delete globalThis.location
  logSyncEvent('z', null, new Error('sin location'))
  globalThis.location = l
} catch { threw = true }
await settle(5)
ok(!threw, 'nunca lanza')
// Revision (menor 3): sin location TAMBIEN se escribe (antes la clave se gastaba sin escribir).
ok((await db.errorLog.toArray()).some((r) => /^z /.test(r.message)), 'sin location la entrada se escribe igual')

// Presupuesto propio de 30 por sesion (ya van 5 claves: las dos de arriba, x, y y z).
for (let i = 0; i < 40; i++) logSyncEvent(`etapa-${i}`, null, { code: 'c' })
await settle(30)
const total = await db.errorLog.where('source').equals('sync').count().catch(async () => (await db.errorLog.toArray()).filter((r) => r.source === 'sync').length)
ok(total <= 30, `no pasa de 30 por sesion (hay ${total})`)
ok(total === 30, `y llega EXACTO al presupuesto (hay ${total})`)

console.log(`syncLog: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
