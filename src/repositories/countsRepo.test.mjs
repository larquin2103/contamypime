// Prueba CON BASE (fake-indexeddb) de la aplicacion UNICA del conteo fisico (auditoria de
// Rikisimo, 06-10-2026). No corre con node directo porque los repos importan sin extension:
//   npx esbuild src/repositories/countsRepo.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/countsRepo.test.bundle.mjs && node <scratch>/countsRepo.test.bundle.mjs
import 'fake-indexeddb/auto'
import { db } from '../db/db'
import { countsRepo } from './countsRepo'
import { COUNT_STATUS, MOVEMENT_TYPES } from '../db/constants'
import { mergeIncoming, recomputeStock } from '../features/sync/pullEngine'

let pass = 0
let fail = 0
const ok = (c, l) => { if (c) pass++; else { fail++; console.error('FAIL', l) } }
const T = '2026-10-01T10:00:00.000Z'
const LOC = 'Rikisimo'

async function seed({ libro = 50, fisico = 40, extra = [] } = {}) {
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.products.put({ id: 'p1', name: 'Keke', unit: 'u', active: true, stock: libro, stockByLocation: { [LOC]: libro }, updatedAt: T })
  await db.stockMovements.put({ id: 'm0', productId: 'p1', qty: libro, type: MOVEMENT_TYPES.TRANSFER_IN, location: LOC, createdAt: T })
  await db.counts.put({
    id: 'c1', status: COUNT_STATUS.PENDING, location: LOC, createdBy: 'u1', createdAt: T, submittedAt: T, updatedAt: T,
    items: [{ productId: 'p1', name: 'Keke', unit: 'u', systemStock: libro, physicalQty: fisico, counted: true, diff: fisico - libro, semaphore: 'red' }, ...extra]
  })
}
const libro = async (pid = 'p1') =>
  (await db.stockMovements.where('productId').equals(pid).toArray())
    .filter((m) => (m.location || '__almacen') === LOC).reduce((a, m) => a + m.qty, 0)
const ajustes = async () => (await db.stockMovements.toArray()).filter((m) => m.type === MOVEMENT_TYPES.ADJUSTMENT)
const ajenoDe = (qty, createdAt) => ({ id: 'count-adj:c1:p1', productId: 'p1', qty, type: MOVEMENT_TYPES.ADJUSTMENT, refType: null, refId: null, unitCost: null, shiftId: null, userId: 'otro', note: `Ajuste por conteo físico (${LOC})`, location: LOC, createdAt })

// C1. NO REGRESION del camino sano: un ajuste con los mismos campos de siempre y el id nuevo.
await seed()
await countsRepo.approve('c1', 'jefe')
{
  const a = await ajustes()
  ok(a.length === 1, `C1: un ajuste (${a.length})`)
  ok(a[0]?.id === 'count-adj:c1:p1', `C1: id determinista (${a[0]?.id})`)
  ok(a[0]?.qty === -10 && a[0]?.location === LOC && a[0]?.userId === 'jefe', 'C1: qty, ubicacion y autor')
  ok(a[0]?.note === `Ajuste por conteo físico (${LOC})` && a[0]?.refType === null && a[0]?.refId === null, 'C1: nota y ref como hoy')
  ok((await libro()) === 40, 'C1: libro = fisico')
  const p = await db.products.get('p1')
  ok(p.stock === 40 && p.stockByLocation[LOC] === 40, `C1: cache = libro (${p.stock}/${p.stockByLocation[LOC]})`)
  const c = await db.counts.get('c1')
  ok(c.status === COUNT_STATUS.APPROVED && c.approvedBy === 'jefe' && !!c.approvedAt && c.updatedAt > T, 'C1: aprobado y sellado')
}

// C2. Delta 0: no escribe ajuste y aprueba igual que hoy.
await seed({ fisico: 50 })
await countsRepo.approve('c1', 'jefe')
ok((await ajustes()).length === 0, 'C2: sin ajuste')
ok((await db.counts.get('c1')).status === COUNT_STATUS.APPROVED, 'C2: aprobado')

// C3 (H-B). Doble toque: dos approve a la vez -> UN ajuste.
await seed()
await Promise.all([countsRepo.approve('c1', 'jefe'), countsRepo.approve('c1', 'jefe')])
ok((await ajustes()).length === 1, `C3: un solo ajuste con doble toque (${(await ajustes()).length})`)
ok((await libro()) === 40, `C3: libro 40 (${await libro()})`)

// C4 (H-A, caso i). Otro aparato aprobo sin verse, mismo libro: su ajuste llega con el MISMO id.
await seed()
await countsRepo.approve('c1', 'jefe')
{
  const af = await mergeIncoming({ name: 'stockMovements', pk: 'id' }, [ajenoDe(-10, '2026-10-01T12:00:00.000Z')])
  await recomputeStock(af)
  ok((await ajustes()).length === 1, 'C4: una sola fila tras la fusion')
  ok((await libro()) === 40 && (await db.products.get('p1')).stockByLocation[LOC] === 40, 'C4: libro y cache 40')
}

// C5 (caso iii). Libros distintos: el otro calculo -7 y su reloj va por delante -> gana su fila.
await seed()
await countsRepo.approve('c1', 'jefe')
{
  const af = await mergeIncoming({ name: 'stockMovements', pk: 'id' }, [ajenoDe(-7, '2099-01-01T00:00:00.000Z')])
  await recomputeStock(af)
  const a = await ajustes()
  ok(a.length === 1 && a[0].qty === -7, `C5: una fila, la de createdAt mayor (${a.map((m) => m.qty)})`)
  ok((await libro()) === 43 && (await db.products.get('p1')).stockByLocation[LOC] === 43, 'C5: cache = libro')
}

// C6 (caso ii). El ajuste del otro llego ANTES de aprobar aqui: no se escribe otro.
await seed()
{
  const af = await mergeIncoming({ name: 'stockMovements', pk: 'id' }, [ajenoDe(-10, T)])
  await recomputeStock(af)
}
await countsRepo.approve('c1', 'jefe')
ok((await ajustes()).length === 1, `C6: sigue habiendo uno (${(await ajustes()).length})`)
ok((await libro()) === 40, 'C6: libro 40')
ok((await db.counts.get('c1')).status === COUNT_STATUS.APPROVED, 'C6: aprobado')

// C7. Conteo ya aprobado en este aparato: no hace nada (como hoy).
await seed()
await db.counts.update('c1', { status: COUNT_STATUS.APPROVED, approvedBy: 'otro' })
await countsRepo.approve('c1', 'jefe')
ok((await ajustes()).length === 0 && (await db.counts.get('c1')).approvedBy === 'otro', 'C7: no toca un aprobado')

// C8. Producto que ya no existe: se salta, como hoy.
await seed({ extra: [{ productId: 'pX', name: 'Borrado', unit: 'u', systemStock: 3, physicalQty: 0, counted: true, diff: -3 }] })
await countsRepo.approve('c1', 'jefe')
ok((await ajustes()).length === 1 && (await ajustes())[0].productId === 'p1', 'C8: solo el producto existente')

// C9. Item no contado: se salta.
await seed({ extra: [{ productId: 'p2', name: 'Otro', unit: 'u', systemStock: 3, physicalQty: null, counted: false, diff: 0 }] })
await db.products.put({ id: 'p2', name: 'Otro', unit: 'u', active: true, stock: 3, stockByLocation: { [LOC]: 3 }, updatedAt: T })
await countsRepo.approve('c1', 'jefe')
ok((await ajustes()).every((m) => m.productId === 'p1'), 'C9: el no contado no se ajusta')

// C10. stockRepo sin id: sigue generando uno aleatorio (cualquier otro llamador queda igual).
await seed()
{
  const { stockRepo } = await import('./stockRepo')
  const id = await stockRepo.adjust({ productId: 'p1', delta: 1, note: 'x', userId: 'u', location: LOC })
  ok(typeof id === 'string' && !id.startsWith('count-adj:') && id.length > 0, `C10: id aleatorio sin id explicito (${id})`)
}

// C11. Un aparato calcula delta 0 (no escribe) y el otro -3: un solo asiento, nunca dos.
await seed({ fisico: 50 })
await countsRepo.approve('c1', 'jefe')
{
  const af = await mergeIncoming({ name: 'stockMovements', pk: 'id' }, [ajenoDe(-3, '2026-10-01T12:00:00.000Z')])
  await recomputeStock(af)
  ok((await ajustes()).length === 1 && (await libro()) === 47, 'C11: un asiento, el del otro aparato')
}

// P1. listPending devuelve TODOS los pendientes, del mas reciente al mas viejo.
await Promise.all(db.tables.map((t) => t.clear()))
for (const [id, t] of [['k1', '2026-10-01T01:00:00.000Z'], ['k2', '2026-10-01T03:00:00.000Z'], ['k3', '2026-10-01T02:00:00.000Z']]) {
  await db.counts.put({ id, status: COUNT_STATUS.PENDING, location: LOC, createdBy: id, createdAt: t, items: [] })
}
await db.counts.put({ id: 'k4', status: COUNT_STATUS.DRAFT, location: LOC, createdBy: 'x', createdAt: T, items: [] })
{
  const l = await countsRepo.listPending()
  ok(l.map((c) => c.id).join() === 'k2,k3,k1', `P1: todos y en orden (${l.map((c) => c.id)})`)
  // P2. getPending sigue devolviendo exactamente el primero de esa lista (no cambia).
  ok((await countsRepo.getPending())?.id === 'k2', 'P2: getPending intacto')
  ok((await countsRepo.getPending('k1'))?.id === 'k1', 'P2: getPending(userId) intacto')
}

{
  // O1. openAt: borradores y pendientes de ESA ubicacion de OTROS usuarios.
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.counts.bulkPut([
    { id: 'a', status: COUNT_STATUS.DRAFT, location: LOC, createdBy: 'yo', createdAt: '2026-10-01T01:00:00.000Z', items: [] },
    { id: 'b', status: COUNT_STATUS.DRAFT, location: LOC, createdBy: 'ana', createdAt: '2026-10-01T02:00:00.000Z', items: [] },
    { id: 'c', status: COUNT_STATUS.PENDING, location: LOC, createdBy: 'eva', createdAt: '2026-10-01T03:00:00.000Z', items: [] },
    { id: 'd', status: COUNT_STATUS.APPROVED, location: LOC, createdBy: 'eva', createdAt: T, items: [] },
    { id: 'e', status: COUNT_STATUS.DRAFT, location: 'Otra', createdBy: 'ana', createdAt: T, items: [] },
    { id: 'f', status: COUNT_STATUS.DRAFT, createdBy: 'ana', createdAt: T, items: [] }
  ])
  ok((await countsRepo.openAt(LOC, 'yo')).map((c) => c.id).join() === 'c,b', 'O1: solo otros, abiertos, de esa ubicacion')
  // O2. Sin location en la fila = almacen (como en todo el repo).
  ok((await countsRepo.openAt('__almacen', 'yo')).map((c) => c.id).join() === 'f', 'O2: sin location = almacen')
}

// F1. Bandera AUSENTE: approve re-deriva como hoy (una venta tras el envio se "deshace").
await seed()
await db.stockMovements.put({ id: 'v1', productId: 'p1', qty: -2, type: MOVEMENT_TYPES.SALE_OUT, location: LOC, createdAt: '2026-10-01T11:00:00.000Z' })
await countsRepo.approve('c1', 'jefe')
ok((await libro()) === 40, `F1: sin bandera, libro = fisico (${await libro()})`)
// F2. Bandera ENCENDIDA: se aplica la diferencia del envio; la venta posterior se respeta.
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: true, updatedAt: T })
await db.stockMovements.put({ id: 'v1', productId: 'p1', qty: -2, type: MOVEMENT_TYPES.SALE_OUT, location: LOC, createdAt: '2026-10-01T11:00:00.000Z' })
await countsRepo.approve('c1', 'jefe')
ok((await libro()) === 38 && (await ajustes())[0].qty === -10, `F2: con bandera, fisico - venta posterior (${await libro()})`)
// F3. Bandera encendida + doble aprobacion: sigue habiendo UN ajuste (la guarda de la tarea 1).
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: true, updatedAt: T })
await Promise.all([countsRepo.approve('c1', 'jefe'), countsRepo.approve('c1', 'jefe')])
ok((await ajustes()).length === 1, 'F3: un ajuste con bandera y doble toque')
// F4. Valor no booleano que llegue por la sync (p.ej. 'si'): se lee como APAGADA.
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: 'si', updatedAt: T })
await countsRepo.approve('c1', 'jefe')
ok((await libro()) === 40, 'F4: solo `true` enciende')
// F4b. Lo mismo CON venta posterior: sin ella 'si' y `true` dan igual (40 en ambos), asi que F4 sola no distingue.
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: 'si', updatedAt: T })
await db.stockMovements.put({ id: 'v1', productId: 'p1', qty: -2, type: MOVEMENT_TYPES.SALE_OUT, location: LOC, createdAt: '2026-10-01T11:00:00.000Z' })
await countsRepo.approve('c1', 'jefe')
ok((await libro()) === 40, `F4b: 'si' con venta posterior se lee como apagada (${await libro()})`)

// Salvaguarda de la bandera (revision final): dos conteos SOLAPADOS de la misma ubicacion.
const conteoGemelo = (id) => ({
  id, status: COUNT_STATUS.PENDING, location: LOC, createdBy: 'u2', createdAt: T, submittedAt: T, updatedAt: T,
  items: [{ productId: 'p1', name: 'Keke', unit: 'u', systemStock: 50, physicalQty: 40, counted: true, diff: -10, semaphore: 'red' }]
})
// F5. Bandera encendida, c1 y c2 con el mismo fisico y diff -10, aprobados en serie: el segundo
// ve el ajuste del primero (posterior al envio) y vuelve al calculo clasico -> libro 40, no 30.
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: true, updatedAt: T })
await db.counts.put(conteoGemelo('c2'))
await countsRepo.approve('c2', 'jefe')
await countsRepo.approve('c1', 'jefe')
ok((await libro()) === 40, `F5: dos conteos solapados con bandera, libro 40 (${await libro()})`)
ok((await ajustes()).length === 1, `F5: un solo ajuste (${(await ajustes()).length})`)
ok((await db.counts.get('c1')).status === COUNT_STATUS.APPROVED, 'F5: el segundo queda aprobado')
// F6. Lo mismo con un ajuste AJENO de id aleatorio (telefono sin actualizar): tambien salta.
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: true, updatedAt: T })
await db.stockMovements.put({ ...ajenoDe(-10, '2026-10-01T12:00:00.000Z'), id: 'a8f3c2e1-viejo' })
await countsRepo.approve('c1', 'jefe')
ok((await libro()) === 40, `F6: ajuste ajeno de id aleatorio, libro 40 (${await libro()})`)
ok((await ajustes()).length === 1, `F6: no se escribe un segundo ajuste (${(await ajustes()).length})`)
// F7. Un ajuste que NO es de conteo, o de conteo pero ANTERIOR al envio, no dispara la
// salvaguarda: se aplica `it.diff` (-10) como con la bandera sin salvaguarda.
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: true, updatedAt: T })
await db.stockMovements.put({ ...ajenoDe(-10, '2026-10-01T12:00:00.000Z'), id: 'otro-ajuste', note: 'Ajuste manual' })
await countsRepo.approve('c1', 'jefe')
{
  const propio = await db.stockMovements.get('count-adj:c1:p1')
  ok(propio?.qty === -10 && (await libro()) === 30, `F7: otra nota no dispara (${propio?.qty} / ${await libro()})`)
}
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: true, updatedAt: T })
await db.stockMovements.put({ ...ajenoDe(-10, '2026-10-01T09:00:00.000Z'), id: 'conteo-anterior' })
await countsRepo.approve('c1', 'jefe')
{
  const propio = await db.stockMovements.get('count-adj:c1:p1')
  ok(propio?.qty === -10 && (await libro()) === 30, `F7: ajuste de conteo anterior al envio no dispara (${propio?.qty} / ${await libro()})`)
}
// Ubicacion distinta: un ajuste de conteo en OTRA ubicacion tampoco dispara.
await seed()
await db.config.put({ key: 'conteoDiferenciaCongelada', value: true, updatedAt: T })
await db.stockMovements.put({ ...ajenoDe(-10, '2026-10-01T12:00:00.000Z'), id: 'conteo-otra-ubi', location: 'Otra' })
// Venta posterior al envio: asi re-derivar (-8) y aplicar `it.diff` (-10) dan cosas distintas.
await db.stockMovements.put({ id: 'v1', productId: 'p1', qty: -2, type: MOVEMENT_TYPES.SALE_OUT, location: LOC, createdAt: '2026-10-01T11:00:00.000Z' })
await countsRepo.approve('c1', 'jefe')
ok((await db.stockMovements.get('count-adj:c1:p1'))?.qty === -10, `F7: ajuste de conteo de otra ubicacion no dispara (${(await db.stockMovements.get('count-adj:c1:p1'))?.qty})`)

console.log(`countsRepo: ${pass} OK / ${fail} fallos`)
if (fail) process.exit(1)
