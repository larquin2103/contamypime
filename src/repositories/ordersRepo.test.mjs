// Prueba CON BASE (fake-indexeddb) del candado H1. No corre con node directo
// porque los repos importan sin extension: se empaqueta con el esbuild de Vite.
//   npx esbuild src/repositories/ordersRepo.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/ordersRepo.test.bundle.mjs && node <scratch>/...
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { ordersRepo } from './ordersRepo'
import { ORDER_STATUS } from '../db/constants'
import { syncTs } from '../features/sync/collections'

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

// 2. voidOrder con lineas vivas y venta -> rechaza y NO la anula (se repara, R3).
await seed()
await throws(() => ordersRepo.voidOrder({ orderId: 'o1', userId: 'u' }), /ya se cobró/, 'voidOrder con venta')
ok((await db.orders.get('o1')).status === ORDER_STATUS.CLOSED, 'no se anula: queda cerrada con su venta (R3)')

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

// H2-1. open + venta viva -> closed + saleId, SIN tocar updatedAt ni closedAt.
await seed()
const antes = await db.orders.get('o1')
ok((await ordersRepo.reconcileClosed('o1')) === true, 'H2: repara')
const despues = await db.orders.get('o1')
ok(despues.status === ORDER_STATUS.CLOSED && despues.saleId === 'v1', 'H2: closed + saleId')
ok(despues.updatedAt === antes.updatedAt, 'H2: updatedAt intacto')
ok(despues.closedAt === antes.closedAt, 'H2: closedAt intacto (cuenta en syncTs)')
ok(despues.closedBy === antes.closedBy, 'H2: closedBy intacto')
ok(syncTs(despues) === syncTs(antes), 'H2: syncTs intacto -> sin eco de subida')
// H2-2. Idempotente.
ok((await ordersRepo.reconcileClosed('o1')) === false, 'H2: segunda llamada no hace nada')
// H2-3. Sin venta no toca nada.
await seed({ withSale: false })
ok((await ordersRepo.reconcileClosed('o1')) === false, 'H2: sin venta no repara')
ok((await db.orders.get('o1')).status === ORDER_STATUS.OPEN, 'H2: sigue open')
// H2-4. Anulada con venta: NO se regresa.
await seed()
await db.orders.update('o1', { status: ORDER_STATUS.VOIDED })
ok((await ordersRepo.reconcileClosed('o1')) === false, 'H2: anulada no se toca')
ok((await db.orders.get('o1')).status === ORDER_STATUS.VOIDED, 'H2: sigue voided')
// H2-5. Pedido inexistente no lanza.
ok((await ordersRepo.reconcileClosed('nope')) === false, 'H2: inexistente')

// R1 (revision de la rama, hallazgos 1, 3 y 4). Carrera: la venta llega por la
// sync JUSTO despues de la comprobacion previa y antes de la transaccion. Se
// simula dejando que la primera lectura de saleOf devuelva lo que habia (nada) y
// escribiendo la venta acto seguido, como haria el bulkPut del pullEngine.
const ventaTardia = () => {
  const orig = ordersRepo.saleOf
  ordersRepo.saleOf = async function (o) {
    const r = await orig.call(this, o)
    ordersRepo.saleOf = orig
    await db.sales.put({ id: 'v1', orderId: 'o1', shiftId: 's1', voided: false, createdAt: T })
    return r
  }
}
// R1-1. voidItem revalida DENTRO de la transaccion.
await seed({ withSale: false })
ventaTardia()
await throws(() => ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }), /ya se cobró/, 'R1: venta tardia en voidItem')
ok((await db.stockMovements.count()) === 0, 'R1: venta tardia, sin movimiento')
ok((await db.orderItems.get('i1')).voided === false, 'R1: venta tardia, linea intacta')
// R1-2. El cierre final de voidOrder (mesa sin lineas vivas) tambien.
await seed({ withSale: false })
await db.orderItems.update('i1', { voided: true })
ventaTardia()
await throws(() => ordersRepo.voidOrder({ orderId: 'o1', userId: 'u' }), /ya se cobró/, 'R1: venta tardia en voidOrder')
ok((await db.orders.get('o1')).status !== ORDER_STATUS.VOIDED, 'R1: voidOrder no anula una mesa cobrada')
// R3-1. Al rechazar, la mesa se REPARA en el acto (closed + saleId), sin marcas.
await seed()
await throws(() => ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }), /ya se cobró/, 'R3: rechazo voidItem')
const rep = await db.orders.get('o1')
ok(rep.status === ORDER_STATUS.CLOSED && rep.saleId === 'v1', 'R3: voidItem rechazado deja la mesa cerrada')
ok(rep.updatedAt === T && rep.closedAt === undefined, 'R3: la reparacion no sella marcas')
// R3-2. Igual desde voidOrder (el camino de liberar en masa del turno).
await seed()
await db.orderItems.update('i1', { voided: true })
await throws(() => ordersRepo.voidOrder({ orderId: 'o1', userId: 'u' }), /ya se cobró/, 'R3: rechazo voidOrder')
ok((await db.orders.get('o1')).status === ORDER_STATUS.CLOSED, 'R3: voidOrder rechazado deja la mesa cerrada')
// R3-3. Tras la carrera, tambien queda reparada.
await seed({ withSale: false })
ventaTardia()
await throws(() => ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }), /ya se cobró/, 'R3: carrera')
ok((await db.orders.get('o1')).status === ORDER_STATUS.CLOSED, 'R3: tras la carrera la mesa queda cerrada')
// R4. El mensaje ya no manda a "revisar la venta en el turno".
await seed()
await throws(() => ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }), /Queda cerrada con su venta/, 'R4: mensaje nuevo')

// R2 (hallazgo 2): addItem en una mesa cobrada que sigue "open" -> rechaza, no
// rebaja stock ni deja linea huerfana, y repara la mesa en el acto.
const prod = { id: 'p1', name: 'Jugo', unit: 'u', price: 10, cost: 4 }
const conStock = async () => {
  await db.stockMovements.put({ id: 'm0', productId: 'p1', location: 'Salon', qty: 5, type: 'purchase_in', createdAt: T })
}
await seed()
await conStock()
await throws(() => ordersRepo.addItem({ orderId: 'o1', product: prod, qty: 1, userId: 'u' }), /ya se cobró/, 'R2: addItem con venta')
ok((await db.orderItems.count()) === 1, 'R2: sin linea nueva')
ok((await db.stockMovements.count()) === 1, 'R2: sin salida de stock')
ok((await db.orders.get('o1')).status === ORDER_STATUS.CLOSED, 'R2: la mesa queda cerrada con su venta')
// R2-carrera: la venta llega entre la comprobacion y la transaccion.
await seed({ withSale: false })
await conStock()
ventaTardia()
await throws(() => ordersRepo.addItem({ orderId: 'o1', product: prod, qty: 1, userId: 'u' }), /ya se cobró/, 'R2: carrera en addItem')
ok((await db.orderItems.count()) === 1, 'R2: carrera, sin linea nueva')
ok((await db.stockMovements.count()) === 1, 'R2: carrera, sin salida de stock')
// R2-no regresion: sin venta, addItem agrega y rebaja como siempre.
await seed({ withSale: false })
await conStock()
await ordersRepo.addItem({ orderId: 'o1', product: prod, qty: 1, userId: 'u' })
ok((await db.orderItems.count()) === 2, 'R2: sin venta, linea agregada')
ok((await db.stockMovements.count()) === 2, 'R2: sin venta, salida de stock')
ok((await db.products.get('p1')).stockByLocation.Salon === 4, 'R2: sin venta, stock rebajado')
// R4b. El mensaje nombra tambien el "agregar".
await seed()
await throws(() => ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }), /agregar/, 'R4b: el mensaje cubre agregar')

console.log(`ordersRepo: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
