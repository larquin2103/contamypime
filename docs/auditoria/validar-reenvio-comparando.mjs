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
