// Prueba CON BASE (fake-indexeddb) de P9: los cursores de la BAJADA no viajan en
// el respaldo. Restaurar uno viejo le diria al aparato "ya baje hasta aqui"
// cuando no es verdad, y el hueco en el libro seria PERMANENTE.
// No corre con node directo (backupService importa sin extension):
//   npx esbuild src/features/backup/backupCursors.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/backupCursors.bundle.mjs && node <scratch>/...
import 'fake-indexeddb/auto'
import { db } from '../../db/db'
import { buildBackup, applyBackup } from './backupService'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }

const limpiar = () => Promise.all(db.tables.map((t) => t.clear()))
const claves = (filas) => (filas || []).map((r) => r.key).sort()

// 1. Al CONSTRUIR: los `pull:*` se quedan fuera; los `push:*` y `retry:*` no.
await limpiar()
await db.syncState.bulkPut([
  { key: 'push:stockMovements', value: '2026-09-25T10:00:00.000Z' },
  { key: 'retry:sales', value: [] },
  { key: 'pull:neg1:stockMovements', value: '2026-09-25T09:00:00.000Z' },
  { key: 'pull:neg1:sales', value: '2026-09-25T09:00:00.000Z' },
  { key: 'pull:neg1:diferidas', value: ['stockMovements'] },
  { key: 'pull:neg1:reconciliado', value: '2026-09-25T08:00:00.000Z' }
])
const bk = await buildBackup({ name: 'dueno' })
ok(claves(bk.tables.syncState).join(',') === 'push:stockMovements,retry:sales',
  'el respaldo lleva los cursores de SUBIDA y la cola, y NINGUN pull:*')
ok(!claves(bk.tables.syncState).some((k) => String(k).startsWith('pull:')),
  'ni el veredicto ni la marca de reconciliacion viajan')

// 2. Al RESTAURAR: aunque el respaldo venga de un build anterior a este cambio y
//    TRAIGA los pull:*, no entran.
await limpiar()
const respaldoViejo = {
  meta: { app: 'mypicuadre-respaldo', version: 1, schema: db.verno, exportedAt: '2026-09-01T00:00:00.000Z' },
  tables: {
    syncState: [
      { key: 'push:sales', value: '2026-09-01T00:00:00.000Z' },
      { key: 'pull:neg1:stockMovements', value: '2026-09-01T00:00:00.000Z' },
      { key: 'pull:neg1:diferidas', value: ['stockMovements', 'sales'] },
      { key: 'pull:neg1:reconciliado', value: '2026-09-01T00:00:00.000Z' }
    ]
  }
}
await applyBackup(respaldoViejo)
const tras = claves(await db.syncState.toArray())
ok(tras.includes('push:sales'), 'el cursor de subida SI se restaura, como siempre')
ok(!tras.some((k) => String(k).startsWith('pull:')),
  'los pull:* de un respaldo viejo NO entran: nada de "ya baje hasta aqui" mintiendo')

// 3. Un aparato que YA estaba filtrando no se queda con el cursor del respaldo.
await limpiar()
await db.syncState.put({ key: 'pull:neg1:stockMovements', value: '2026-09-25T12:00:00.000Z' })
await applyBackup(respaldoViejo)
const suyo = await db.syncState.get('pull:neg1:stockMovements')
ok(suyo?.value === '2026-09-25T12:00:00.000Z',
  'y el cursor PROPIO del aparato queda intacto, no retrocede al del respaldo')

console.log(`backupCursors (los cursores de bajada no viajan): ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
