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
