// Pruebas PURAS del reenvio forzado (auditoria Burger Premium, H3-a).
// Sin framework: ejecutar con  `node src/features/sync/resend.test.mjs`.
//
// QUE CAZA: (1) que se pueda reenviar una coleccion MUTABLE -batch.set pisa la
// nube a ciegas y la regresaria-; (2) que el conteo mostrado al dueno no sea el
// mismo predicado que usa doPush (x.ts > cursor, estricto); (3) que el cursor
// se mueva hacia DELANTE por esta via; (4) el desfase hora local / UTC (§9.8).
import { RESENDABLE, isResendable, countSince, rewindTo, localInputToIso } from './resend.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}

// (1) Solo libros inmutables.
for (const n of ['stockMovements', 'productions', 'purchases', 'transfers']) eq(isResendable(n), true, n)
for (const n of ['orders', 'orderItems', 'products', 'counts', 'config', 'sales', 'remittances', 'x'])
  eq(isResendable(n), false, `mutable/desconocida: ${n}`)
eq(RESENDABLE.length, 4, 'exactamente cuatro')

// (2) Mismo predicado que doPush: syncTs(r) > since, estricto.
const rows = [
  { createdAt: '2026-09-21T20:02:30.917Z' },
  { createdAt: '2026-09-21T20:02:30.000Z' },   // igual al corte: NO entra
  { createdAt: '2026-09-21T19:00:00.000Z' },
  { createdAt: '' },                           // sin marca: doPush la ignora
  { createdAt: '2026-09-22T10:00:00.000Z', updatedAt: '2026-09-22T11:00:00.000Z' }
]
eq(countSince(rows, '2026-09-21T20:02:30.000Z'), 2, 'cuenta estricta')
eq(countSince(rows, ''), 4, 'sin fecha cuenta todas las que tienen marca')

// (3) El cursor solo RETROCEDE por esta via.
eq(rewindTo('2026-09-22T14:30:34.409Z', '2026-09-21T20:00:00.000Z'), '2026-09-21T20:00:00.000Z', 'retrocede')
eq(rewindTo('2026-09-20T00:00:00.000Z', '2026-09-21T20:00:00.000Z'), null, 'no avanza: nada que hacer')
eq(rewindTo('', '2026-09-21T20:00:00.000Z'), null, 'cursor vacio: ya lo sube todo')
eq(rewindTo('2026-09-22T00:00:00.000Z', 'basura'), null, 'fecha invalida')

// (4) Local -> ISO UTC. Se compara contra el propio Date del entorno para no
// depender de la zona de la maquina que corre la prueba.
eq(localInputToIso('2026-09-21T16:00'), new Date('2026-09-21T16:00').toISOString(), 'local a ISO')
eq(localInputToIso(''), null, 'vacio')
eq(localInputToIso('no-es-fecha'), null, 'invalida')

console.log(`resend: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
