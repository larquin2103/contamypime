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
