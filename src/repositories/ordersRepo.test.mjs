// Prueba CON BASE (fake-indexeddb) del candado H1. No corre con node directo
// porque los repos importan sin extension: se empaqueta con el esbuild de Vite.
//   npx esbuild src/repositories/ordersRepo.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/ordersRepo.test.bundle.mjs && node <scratch>/...
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { ordersRepo } from './ordersRepo'
import { ORDER_STATUS } from '../db/constants'
import { syncTs } from '../features/sync/collections'
import { mergeIncoming, recomputeStock } from '../features/sync/pullEngine'
import { MOVEMENT_TYPES } from '../db/constants'

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
// R2-carrera: retirada en la revision 2. addItem ya no comprueba ANTES de la
// transaccion (menor 1), asi que no queda ventana entre las dos que simular: la
// unica comprobacion va dentro, y IndexedDB serializa el bulkPut de la sync con
// ella. Lo cubre R2 (arriba): sin la comprobacion de dentro, R2 falla.
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

// Revision 2, menor 1: addItem es el toque MAS usado del servicio. Sin venta
// debe consultar las ventas UNA sola vez (la de dentro de la transaccion).
{
  await seed({ withSale: false })
  await conStock()
  const orig = ordersRepo.saleOf
  let n = 0
  ordersRepo.saleOf = async function (o) { n++; return orig.call(this, o) }
  try { await ordersRepo.addItem({ orderId: 'o1', product: prod, qty: 1, userId: 'u' }) }
  finally { ordersRepo.saleOf = orig }
  ok(n === 1, `M1: addItem sin venta consulta la venta 1 vez (fueron ${n})`)
}
// Revision 2, menor 4: si la reparacion FALLA, el mensaje no promete que la
// mesa quedo cerrada.
{
  await seed()
  const orig = ordersRepo.reconcileClosed
  ordersRepo.reconcileClosed = async () => { throw new Error('disco lleno') }
  let msg = ''
  try { await ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }) } catch (e) { msg = e.message }
  finally { ordersRepo.reconcileClosed = orig }
  ok(/ya se cobró/.test(msg) && !/Queda cerrada/.test(msg), `M4: sin reparacion no promete cierre: ${msg}`)
  let code = ''
  await seed()
  try { await ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }) } catch (e) { code = e.code }
  ok(code === 'charged', 'M4: el rechazo sigue marcado con code charged')
}

// DOBLE ANULACION (auditoria del respaldo de Burger del 25-09-2026). Contando producto a
// producto, el libro devolvio 10 u de mas en 3 pedidos, por DOS mecanismos: (a) doble toque
// en un aparato -dos llamadas a 7-10 ms que pasaban las dos la comprobacion de FUERA de la
// transaccion- y (b) una linea que el aparato veia viva aunque ya estaba anulada (su
// actualizacion no llego por la sync, su movimiento si) y se anulo otra vez horas despues.
// Libro base: +5 de entrada y -1 del consumo de la linea i1 (asi recomputeStock mide algo).
async function seedLibro(extraLines = []) {
  await seed({ withSale: false })
  await db.stockMovements.bulkPut([
    { id: 'in0', productId: 'p1', qty: 5, type: 'transfer_in', location: 'Salon', createdAt: T },
    { id: 'c0', productId: 'p1', qty: -1, type: MOVEMENT_TYPES.SALE_OUT, refType: 'order', refId: 'o1', location: 'Salon', createdAt: T }
  ])
  for (const l of extraLines) await db.orderItems.put({ orderId: 'o1', productId: 'p1', qty: 1, area: 'Salon', voided: false, createdAt: T, updatedAt: T, ...l })
  await db.products.update('p1', { stock: 4, stockByLocation: { Salon: 4 } })
}
const voids = async () => (await db.stockMovements.toArray()).filter((m) => m.refType === 'order_void')
// D1. Dos anulaciones SIMULTANEAS de la misma linea (el doble toque): una sola devolucion.
await seedLibro()
await Promise.all([ordersRepo.voidItem({ itemId: 'i1', userId: 'u' }), ordersRepo.voidItem({ itemId: 'i1', userId: 'u' })])
ok((await voids()).length === 1, `D1 doble toque: una sola devolucion (${(await voids()).length})`)
ok((await db.products.get('p1')).stockByLocation.Salon === 5, `D1: el stock sube UNA vez (${(await db.products.get('p1')).stockByLocation.Salon})`)
ok((await db.orderItems.get('i1')).voided === true, 'D1: linea anulada')
// D2. El id de la devolucion es DETERMINISTA por linea, y la devolucion es la de siempre.
{
  const [m] = await voids()
  const it = await db.orderItems.get('i1')
  ok(m.id === 'order-void:i1', `D2: id determinista (${m.id})`)
  ok(m.qty === 1 && m.type === MOVEMENT_TYPES.SALE_OUT && m.refId === 'o1' && m.location === 'Salon' && m.userId === 'u', 'D2: mismos campos que antes')
  ok(m.createdAt === it.voidedAt, 'D2: su instante es el de la anulacion de la linea (el detector los empareja)')
}
// D3. Dos "-" simultaneos sobre dos lineas de una unidad: nunca una devolucion de mas.
await seedLibro([{ id: 'i2', createdAt: '2026-09-21T19:41:00.000Z' }])
await db.stockMovements.put({ id: 'c1', productId: 'p1', qty: -1, type: MOVEMENT_TYPES.SALE_OUT, refType: 'order', refId: 'o1', location: 'Salon', createdAt: T })
await Promise.all([ordersRepo.decrementOne({ orderId: 'o1', productId: 'p1', userId: 'u' }), ordersRepo.decrementOne({ orderId: 'o1', productId: 'p1', userId: 'u' })])
{
  const anuladas = (await db.orderItems.toArray()).filter((i) => i.voided).length
  ok((await voids()).length === anuladas, `D3: devoluciones = lineas anuladas (${(await voids()).length} / ${anuladas})`)
}
// D4. La sync trajo la devolucion pero NO la anulacion de la linea (mecanismo b): anularla
// otra vez NO devuelve el stock de nuevo; solo repara la linea, con el instante y el autor
// del movimiento que ya existe (asi el detector los empareja).
await seedLibro()
await db.stockMovements.put({ id: 'order-void:i1', productId: 'p1', qty: 1, type: MOVEMENT_TYPES.SALE_OUT, refType: 'order_void', refId: 'o1', location: 'Salon', userId: 'otro', createdAt: '2026-09-21T19:50:00.000Z' })
await recomputeStock(['p1'])
const stockAntes = (await db.products.get('p1')).stockByLocation.Salon
await ordersRepo.voidItem({ itemId: 'i1', userId: 'u' })
{
  const it = await db.orderItems.get('i1')
  ok((await voids()).length === 1, `D4: ninguna devolucion nueva (${(await voids()).length})`)
  ok((await db.products.get('p1')).stockByLocation.Salon === stockAntes, `D4: el stock no se mueve (${stockAntes} -> ${(await db.products.get('p1')).stockByLocation.Salon})`)
  ok(it.voided === true && it.voidedAt === '2026-09-21T19:50:00.000Z' && it.voidedBy === 'otro', 'D4: la linea queda anulada con el instante y el autor del movimiento')
  ok(it.updatedAt > T, 'D4: la reparacion SI sella updatedAt (tiene que subir a la nube)')
}
// D5. Dos aparatos anulan la misma linea sin haberse visto: tras la fusion real de la sync
// queda UNA devolucion y el stock derivado del libro es el correcto.
await seedLibro()
await ordersRepo.voidItem({ itemId: 'i1', userId: 'u' })
{
  const suyo = { id: 'order-void:i1', productId: 'p1', qty: 1, type: MOVEMENT_TYPES.SALE_OUT, refType: 'order_void', refId: 'o1', location: 'Salon', userId: 'otro', createdAt: '2026-09-21T23:59:00.000Z' }
  const afectados = await mergeIncoming({ name: 'stockMovements', pk: 'id' }, [suyo])
  await recomputeStock(afectados)
  ok((await voids()).length === 1, `D5: una sola devolucion tras la fusion (${(await voids()).length})`)
  ok((await db.products.get('p1')).stockByLocation.Salon === 5, `D5: stock derivado del libro = 5 - 1 + 1 (${(await db.products.get('p1')).stockByLocation.Salon})`)
}

// D6. "-" doble sobre una linea de VARIAS unidades: decrementOne anula y recarga el resto. Si
// el segundo toque encuentra la linea ya anulada, NO puede recargar el resto otra vez (eso
// duplicaria consumo). El libro de la mesa tiene que casar con sus lineas vivas.
await seedLibro()
await db.orderItems.update('i1', { qty: 3 })
await db.stockMovements.update('c0', { qty: -3 })
await Promise.all([ordersRepo.decrementOne({ orderId: 'o1', productId: 'p1', userId: 'u' }), ordersRepo.decrementOne({ orderId: 'o1', productId: 'p1', userId: 'u' })])
{
  const vivas = (await db.orderItems.toArray()).filter((i) => !i.voided).reduce((a, i) => a + i.qty, 0)
  const neto = (await db.stockMovements.toArray()).filter((m) => m.refId === 'o1').reduce((a, m) => a - m.qty, 0)
  ok(neto === vivas, `D6: el libro de la mesa casa con sus lineas vivas (neto ${neto}, vivas ${vivas})`)
  ok(vivas >= 1 && vivas <= 2, `D6: nunca mas consumo que el que habia (${vivas})`)
}

// D7 (auditoria previa a main, menor 1). El aparato B hizo "-" sobre i1 (3 u): anulo i1 y
// recargo 2 u en una linea nueva. A este aparato solo le llego la devolucion de B. Si aqui se
// toca "-", la reparacion de i1 NO es una anulacion de esta llamada: recargar el resto otra vez
// dejaria la mesa con 4 u cuando llegue la linea de B (se le cobrarian 2 de mas al cliente).
await seedLibro()
await db.orderItems.update('i1', { qty: 3 })
await db.stockMovements.update('c0', { qty: -3 })
await db.stockMovements.put({ id: 'order-void:i1', productId: 'p1', qty: 3, type: MOVEMENT_TYPES.SALE_OUT, refType: 'order_void', refId: 'o1', location: 'Salon', userId: 'B', createdAt: '2026-09-21T19:45:00.000Z' })
ok((await ordersRepo.voidItem({ itemId: 'i1', userId: 'A' })) === false, 'D7: reparar no cuenta como anular en esta llamada')
await db.orderItems.update('i1', { voided: false })
await ordersRepo.decrementOne({ orderId: 'o1', productId: 'p1', userId: 'A' })
await db.orderItems.put({ id: 'L2', orderId: 'o1', productId: 'p1', qty: 2, area: 'Salon', voided: false, createdAt: '2026-09-21T19:45:00.001Z', updatedAt: '2026-09-21T19:45:00.001Z' })
{
  const vivas = (await db.orderItems.toArray()).filter((i) => !i.voided).reduce((a, i) => a + i.qty, 0)
  ok(vivas === 2, `D7: al llegar la linea de B la mesa queda en 2 u, no en 4 (${vivas})`)
  ok((await voids()).length === 1, `D7: una sola devolucion (${(await voids()).length})`)
}

console.log(`ordersRepo: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
