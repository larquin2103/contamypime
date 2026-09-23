// Pruebas PURAS del predicado "esta venta es la de este pedido".
// Sin framework: ejecutar con  `node src/lib/orderSale.test.mjs`.
//
// QUE CAZA: el candado de la auditoria Burger Premium (H1). La verdad de "esta
// mesa ya se cobro" vive en la VENTA (append-only), no en order.status (LWW).
import { isLiveSaleOf, shouldReconcileClosed } from './orderSale.js'

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

console.log(`orderSale: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
