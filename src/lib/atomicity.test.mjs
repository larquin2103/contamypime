// Pruebas PURAS del diagnostico de atomicidad (auditoria Burger Premium, H3-b).
// Sin framework: ejecutar con  `node src/lib/atomicity.test.mjs`.
//
// QUE CAZA: documentos que nacieron en UNA transaccion con sus movimientos y
// llegaron a esta base sin ellos (o al reves). En un solo aparato es imposible;
// si aparece, la sync partio la transaccion.
import { findAtomicityBreaks } from './atomicity.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}
const kinds = (t) => findAtomicityBreaks(t).map((b) => b.kind).sort().join(',')
const T = '2026-09-21T19:48:30.000Z'

// Base sana: cada documento con su movimiento. Debe dar 0.
const sana = {
  productions: [{ id: 'pr1', createdAt: T }],
  purchases: [{ id: 'pu1', createdAt: T }],
  transfers: [{ id: 'tr1', createdAt: T }],
  sales: [
    { id: 'v1', createdAt: T, voided: false, items: [{}] },
    { id: 'v2', createdAt: T, voided: false, orderId: 'o1', items: [{}] } // mesa: skipStock
  ],
  orderItems: [{ id: 'i1', orderId: 'o1', voided: true, voidedAt: T }],
  stockMovements: [
    { id: 'm1', refType: 'production', refId: 'pr1' },
    { id: 'm2', refType: 'purchase', refId: 'pu1' },
    { id: 'm3', refType: 'transfer', refId: 'tr1' },
    { id: 'm4', refType: 'sale', refId: 'v1' },
    { id: 'm5', refType: 'order_void', refId: 'o1', createdAt: T }
  ]
}
eq(kinds(sana), '', 'base sana: sin roturas')
eq(kinds({}), '', 'respaldo sin tablas: sin roturas y sin lanzar')

// Cada rotura por separado.
eq(kinds({ ...sana, stockMovements: sana.stockMovements.filter((m) => m.id !== 'm1') }),
  'production-sin-mov', 'produccion huerfana (19:48:30 de Burger)')
eq(kinds({ ...sana, productions: [] }), 'mov-sin-production', 'movimientos sin produccion (05038036)')
eq(kinds({ ...sana, stockMovements: sana.stockMovements.filter((m) => m.id !== 'm2') }),
  'purchase-sin-mov', 'compra sin movimientos')
eq(kinds({ ...sana, stockMovements: sana.stockMovements.filter((m) => m.id !== 'm3') }),
  'transfer-sin-mov', 'traspaso sin movimientos')
eq(kinds({ ...sana, stockMovements: sana.stockMovements.filter((m) => m.id !== 'm4') }),
  'sale-sin-mov', 'venta sin movimiento (La Patrona)')
eq(kinds({ ...sana, sales: sana.sales.filter((s) => s.id !== 'v1') }), 'mov-sin-sale', 'movimiento sin venta')
eq(kinds({ ...sana, stockMovements: sana.stockMovements.filter((m) => m.id !== 'm5') }),
  'anulacion-sin-mov', 'linea anulada sin su devolucion')
eq(kinds({ ...sana, orderItems: [{ ...sana.orderItems[0], voided: false, voidedAt: null }] }),
  'mov-anulacion-sin-linea', 'devolucion sin su marca de anulada (las 4 de Burger)')

// Lo que NO es rotura.
eq(kinds({ ...sana, sales: [{ ...sana.sales[0], voided: true }], stockMovements: sana.stockMovements.filter((m) => m.id !== 'm4') }),
  '', 'venta anulada sin movimiento no cuenta')
// La venta de mesa (v2) no tiene movimiento 'sale' y NO debe salir: ya cubierto en la base sana.

// Multiset (fix round 1): quitar VARIAS unidades del mismo producto de golpe
// (removeProduct/voidOrder) sella varias lineas y varios movimientos con la
// MISMA clave orderId+ts. Emparejar por pertenencia a un Set (en vez de por
// CONTEO) esconde un huerfano real detras de un hermano con esa misma clave:
// es un falso negativo, justo lo que este diagnostico existe para cazar.
eq(kinds({
  orderItems: [
    { id: 'iA', orderId: 'o1', voided: true, voidedAt: T },
    { id: 'iB', orderId: 'o1', voided: true, voidedAt: T }
  ],
  stockMovements: [{ id: 'm1', refType: 'order_void', refId: 'o1', createdAt: T }]
}), 'anulacion-sin-mov', 'multiset: 2 lineas y 1 movimiento con la misma clave -> 1 huerfano')

eq(kinds({
  orderItems: [{ id: 'iA', orderId: 'o1', voided: true, voidedAt: T }],
  stockMovements: [
    { id: 'm1', refType: 'order_void', refId: 'o1', createdAt: T },
    { id: 'm2', refType: 'order_void', refId: 'o1', createdAt: T }
  ]
}), 'mov-anulacion-sin-linea', 'multiset: 2 movimientos y 1 linea con la misma clave -> 1 huerfano')

eq(kinds({
  orderItems: [
    { id: 'iA', orderId: 'o1', voided: true, voidedAt: T },
    { id: 'iB', orderId: 'o1', voided: true, voidedAt: T }
  ],
  stockMovements: [
    { id: 'm1', refType: 'order_void', refId: 'o1', createdAt: T },
    { id: 'm2', refType: 'order_void', refId: 'o1', createdAt: T }
  ]
}), '', 'multiset: 2 lineas y 2 movimientos con la misma clave -> sin roturas')

console.log(`atomicity: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
