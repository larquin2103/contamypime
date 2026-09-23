// Prueba CON BASE (fake-indexeddb) del candado H1. No corre con node directo
// porque los repos importan sin extension: se empaqueta con el esbuild de Vite.
//   npx esbuild src/repositories/ordersRepo.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/ordersRepo.test.bundle.mjs && node <scratch>/...
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { ordersRepo } from './ordersRepo'
import { ORDER_STATUS } from '../db/constants'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
const throws = async (fn, re, l) => {
  try { await fn(); fail++; console.error('FAIL (no lanzo)', l) }
  catch (e) { ok(re.test(e.message), `${l}: ${e.message}`) }
}
const T = '2026-09-21T19:40:00.000Z'

async function seed({ shiftId = 's1', withSale = true, saleShift = 's1' } = {}) {
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.products.put({ id: 'p1', name: 'Jugo', stock: 5, stockByLocation: { Salon: 5 }, updatedAt: T })
  await db.orders.put({ id: 'o1', area: 'Salon', table: 1, status: ORDER_STATUS.OPEN, shiftId, updatedAt: T, openedAt: T })
  await db.orderItems.put({ id: 'i1', orderId: 'o1', productId: 'p1', qty: 1, area: 'Salon', voided: false, createdAt: T, updatedAt: T })
  if (withSale) await db.sales.put({ id: 'v1', orderId: 'o1', shiftId: saleShift, voided: false, createdAt: T })
}

// 1. Cabecera "open" + venta viva -> voidItem rechaza y NO mueve nada.
await seed()
await throws(() => ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }), /ya se cobró/, 'voidItem con venta')
ok((await db.stockMovements.count()) === 0, 'sin movimiento de devolucion')
ok((await db.orderItems.get('i1')).voided === false, 'linea intacta')

// 2. voidOrder con lineas vivas y venta -> rechaza, cabecera intacta.
await seed()
await throws(() => ordersRepo.voidOrder({ orderId: 'o1', userId: 'u' }), /ya se cobró/, 'voidOrder con venta')
ok((await db.orders.get('o1')).status === ORDER_STATUS.OPEN, 'cabecera sigue open')

// 3. voidOrder SIN lineas vivas y con venta -> tambien rechaza (hallazgo 1).
await seed()
await db.orderItems.update('i1', { voided: true })
await throws(() => ordersRepo.voidOrder({ orderId: 'o1', userId: 'u' }), /ya se cobró/, 'voidOrder vacio con venta')

// 4. shiftId nulo en local (reservada que otro ocupo) -> cae al filter y rechaza.
await seed({ shiftId: null, saleShift: 's9' })
await throws(() => ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }), /ya se cobró/, 'shiftId nulo')

// 5. NO REGRESION: sin venta, voidItem hace exactamente lo de siempre.
await seed({ withSale: false })
await ordersRepo.voidItem({ itemId: 'i1', userId: 'u' })
ok((await db.orderItems.get('i1')).voided === true, 'sin venta: linea anulada')
ok((await db.stockMovements.count()) === 1, 'sin venta: un movimiento de devolucion')
ok((await db.products.get('p1')).stockByLocation.Salon === 6, 'sin venta: stock devuelto')

// 6. Venta ANULADA no bloquea.
await seed()
await db.sales.update('v1', { voided: true })
await ordersRepo.voidItem({ itemId: 'i1', userId: 'u' })
ok((await db.orderItems.get('i1')).voided === true, 'venta anulada no bloquea')

console.log(`ordersRepo: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
