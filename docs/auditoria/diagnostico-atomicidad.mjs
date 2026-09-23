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
