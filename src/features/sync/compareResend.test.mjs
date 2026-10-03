// Pruebas PURAS del reenvio que compara (spec 2026-09-23-reenvio-comparando-design.md).
// Sin framework: `node src/features/sync/compareResend.test.mjs`.
//
// QUE CAZA: (1) escribir una version que NO es mas nueva que la de la nube (haria
// retroceder a los demas aparatos); (2) colar una coleccion no aprobada; (3) que el
// recuento de candidatos no sea el mismo predicado que usa la subida.
import {
  COMPARE_RESENDABLE, isCompareResendable, candidatesSince, decide, MAX_PER_RUN, summarize,
  compareResendableFor
} from './compareResend.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}

// Alcance exacto (decision del duenio). Turnos y mesas entran el 03-10-2026 para
// reparar la auditoria de Burger: una subida tardia de un aparato pinto en la nube
// la version ABIERTA de un turno y de 7 mesas ya cerrados en otro aparato.
eq(COMPARE_RESENDABLE.join(','), 'products,counts,auditEvents,shifts,orders', 'lista exacta')
for (const n of ['products', 'counts', 'auditEvents', 'shifts', 'orders']) eq(isCompareResendable(n), true, `${n} entra`)
for (const n of ['config', 'sales', 'stockMovements', 'orderItems', 'images', 'x']) eq(isCompareResendable(n), false, `${n} no entra`)

// Sin fugas de licencia (regla 3): las mesas solo se ofrecen con el modulo `mesas`.
eq(compareResendableFor({ mesas: false }).join(','), 'products,counts,auditEvents,shifts', 'sin mesas: no se ofrecen las mesas')
eq(compareResendableFor({ mesas: true }).join(','), 'products,counts,auditEvents,shifts,orders', 'con mesas: si')
eq(compareResendableFor().join(','), 'products,counts,auditEvents,shifts', 'sin decir nada: el lado seguro (oculta)')

// El caso de Burger (auditoria del 03-10-2026). Turno f5feb11c tal como esta en el
// respaldo del PC; el closedAt de la tablet es ilustrativo (no se tiene su respaldo).
const turnoAbierto = { id: 'f5feb11c', sellerId: 'd12b', status: 'open', area: 'Salones', openedAt: '2026-09-25T14:09:52.323Z', closedAt: null }
const turnoCerrado = { ...turnoAbierto, status: 'closed', closedAt: '2026-09-26T02:12:00.000Z', closedBy: 'wisley', forced: true }
eq(decide(turnoCerrado, turnoAbierto), 'escribir', 'Burger: la tablet (cerrado) repara la nube (abierto)')
eq(decide(turnoAbierto, turnoAbierto), 'igual', 'Burger: lanzado por error desde el PC (abierto) NO escribe nada')
eq(decide(turnoAbierto, turnoCerrado), 'nube-mas-nueva', 'y si la nube ya estuviera cerrada, el PC tampoco la toca')
// Mesa reconstruida del respaldo: la nube tiene la cabecera abierta de las 20:48;
// el PC la reparo con reconcileClosed, que NO toca updatedAt ni pone closedAt.
const mesaNube = { id: 'm2', table: 'Mesa 2', status: 'open', openedAt: '2026-09-26T00:39:00.000Z', updatedAt: '2026-09-26T00:48:55.056Z' }
const mesaPC = { ...mesaNube, status: 'closed', saleId: 'v1' }
const mesaTablet = { ...mesaNube, status: 'closed', saleId: 'v1', closedAt: '2026-09-26T01:00:10.000Z', updatedAt: '2026-09-26T01:00:10.000Z' }
eq(decide(mesaTablet, mesaNube), 'escribir', 'Burger: la mesa cerrada de la tablet repara la nube')
eq(decide(mesaPC, mesaNube), 'igual', 'Burger: la mesa reparada en el PC NO se sube (le falta closedAt; no es la buena)')

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

// Candado sobre el FUENTE del panel (no hay pruebas de pantalla): ofrece la lista
// FILTRADA por licencia, no la cruda, y pone nombre legible a turnos y mesas.
{
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const panel = readFileSync(fileURLToPath(new URL('./CloudScreen.jsx', import.meta.url)), 'utf8')
  eq(/compareResendableFor\(\{ mesas: hasModule\(LICENSE_MODULES\.TABLES\) \}\)/.test(panel), true,
    'el panel filtra por la licencia de mesas (sin fugas)')
  eq(/COMPARE_RESENDABLE\.map\(/.test(panel), false, 'y ya no recorre la lista cruda')
  eq(/shifts: 'Turnos'/.test(panel) && /orders: 'Mesas \(cabeceras\)'/.test(panel), true, 'nombres legibles')
}

console.log(`compareResend: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
