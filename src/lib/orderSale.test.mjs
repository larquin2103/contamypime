// Pruebas PURAS del predicado "esta venta es la de este pedido".
// Sin framework: ejecutar con  `node src/lib/orderSale.test.mjs`.
//
// QUE CAZA: el candado de la auditoria Burger Premium (H1). La verdad de "esta
// mesa ya se cobro" vive en la VENTA (append-only), no en order.status (LWW).
import { isLiveSaleOf, shouldReconcileClosed, createGate, ticketTime } from './orderSale.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}

eq(isLiveSaleOf({ orderId: 'o1', voided: false }, 'o1'), true, 'venta viva del pedido')
eq(isLiveSaleOf({ orderId: 'o1' }, 'o1'), true, 'voided ausente = viva')
eq(isLiveSaleOf({ orderId: 'o1', voided: true }, 'o1'), false, 'venta anulada no cuenta')
eq(isLiveSaleOf({ orderId: 'o2', voided: false }, 'o1'), false, 'otro pedido')
eq(isLiveSaleOf({ orderId: null, voided: false }, 'o1'), false, 'venta de mostrador')
eq(isLiveSaleOf({ voided: false }, 'o1'), false, 'sin orderId')
eq(isLiveSaleOf({ orderId: 'o1' }, ''), false, 'pedido sin id')
eq(isLiveSaleOf({ orderId: 'o1' }, null), false, 'pedido nulo')
eq(isLiveSaleOf(null, 'o1'), false, 'venta nula')
// Control negativo: un predicado que siempre diga true debe fallar aqui.
eq([{ orderId: 'x' }, { orderId: 'y', voided: true }].some((s) => isLiveSaleOf(s, 'y')), false,
  'control negativo: ninguna viva de y')

// H2: reparar la cabecera SOLO si dice open y hay venta viva de ESE pedido.
const V = { id: 'v1', orderId: 'o1', voided: false }
eq(shouldReconcileClosed({ id: 'o1', status: 'open' }, V), true, 'open + venta viva -> reparar')
eq(shouldReconcileClosed({ id: 'o1', status: 'open' }, null), false, 'open sin venta -> no')
eq(shouldReconcileClosed({ id: 'o1', status: 'open' }, { ...V, voided: true }), false, 'venta anulada -> no')
eq(shouldReconcileClosed({ id: 'o1', status: 'closed', saleId: 'v1' }, V), false, 'ya cerrada -> no')
eq(shouldReconcileClosed({ id: 'o1', status: 'voided' }, V), false, 'anulada: no se regresa ningun estado')
eq(shouldReconcileClosed({ id: 'o1', status: 'reserved' }, V), false, 'reservada -> no')
eq(shouldReconcileClosed({ id: 'o1', status: 'open' }, { ...V, orderId: 'o2' }), false, 'venta de otro pedido')
eq(shouldReconcileClosed(null, V), false, 'pedido nulo')

// Revision de la rama, hallazgo 7: doble toque en "Cobrar". setBusy de React
// se aplica en el SIGUIENTE render, asi que dos toques seguidos pasaban los dos;
// el cerrojo es sincrono y descarta el segundo mientras el primero sigue en vuelo.
{
  const gate = createGate()
  let calls = 0
  let release
  const slow = () => { calls++; return new Promise((r) => { release = r }) }
  const a = gate.run(slow)
  const b = gate.run(slow) // segundo toque, con el primero en vuelo
  eq(calls, 1, 'gate: el segundo toque no ejecuta')
  eq(await b, undefined, 'gate: el segundo toque vuelve sin hacer nada')
  release('ok')
  eq(await a, 'ok', 'gate: el primero devuelve su resultado')
  await gate.run(async () => { calls++ })
  eq(calls, 2, 'gate: terminado el primero, se puede volver a cobrar')
  let threw = false
  try { await gate.run(async () => { throw new Error('x') }) } catch { threw = true }
  eq(threw, true, 'gate: el error del cobro se propaga')
  await gate.run(async () => { calls++ })
  eq(calls, 3, 'gate: un cobro fallido libera el cerrojo')
}

// Revision de la rama, hallazgo 5: hora del ticket. La mesa reparada por
// reconcileClosed no tiene closedAt (a proposito: cuenta en syncTs), asi que el
// ticket reimpreso salia con la hora de AHORA. La hora real del cobro es la de la venta.
eq(ticketTime({ closedAt: 'C' }, { createdAt: 'V' }, 'N'), 'C', 'ticket: con closedAt, el de siempre')
eq(ticketTime({ closedAt: 'C' }, null, 'N'), 'C', 'ticket: con closedAt y sin venta cargada')
eq(ticketTime({}, { createdAt: 'V' }, 'N'), 'V', 'ticket: mesa reparada -> hora de la venta')
eq(ticketTime({}, null, 'N'), 'N', 'ticket: sin nada -> ahora (cobro recien hecho)')
eq(ticketTime(null, undefined, 'N'), 'N', 'ticket: sin pedido no lanza')

console.log(`orderSale: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
