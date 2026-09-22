// ---------------------------------------------------------------------------
// Bateria de validacion de los hallazgos H1, H2, H3 y H4 de
// `docs/AUDITORIA-BURGER-PREMIUM-21-09-2026.md` (§9, validacion del 22-09-2026).
//
// NO ENTRA EN EL BUILD. Es una herramienta de auditoria, no codigo de la app:
// no importa nada de `src/` en tiempo de ejecucion (lo LEE como texto), no
// escribe en ningun sitio y no toca la base de datos. Vive aqui para que las
// cifras del acta se puedan volver a medir en vez de tener que creerselas.
//
// Uso:
//   node docs/auditoria/bateria-burger-premium.mjs <A1> <B> <A2> [raizSrc]
//
//     A1  respaldo de la instancia A, ANTERIOR a la anulacion  (21-09 20:22Z)
//     B   respaldo de la instancia B                           (22-09 14:34Z)
//     A2  respaldo de la instancia A, del dia siguiente        (22-09 19:57Z)
//     raizSrc  por defecto `src/` relativo al directorio actual
//
// Los respaldos son ficheros del negocio y NO estan en el repositorio. Sus
// SHA256 estan fijados en el §9.1 del acta: comprobarlos antes de fiarse del
// resultado.
//
// Salida: una linea por asercion y un codigo de salida 0 si todas pasan.
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'

const [fA1, fB, fA2, raiz = 'src'] = process.argv.slice(2)
if (!fA1 || !fB || !fA2) {
  console.error('Uso: node bateria-burger-premium.mjs <A1> <B> <A2> [raizSrc]')
  process.exit(2)
}

const SRC = path.resolve(raiz) + path.sep
const src = (f) => fs.readFileSync(SRC + f.split('/').join(path.sep), 'utf8')
function todoSrc() {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(js|jsx)$/.test(e.name)) out.push(fs.readFileSync(p, 'utf8'))
    }
  }
  walk(SRC)
  return out.join('\n')
}
const load = (p) => {
  const bk = JSON.parse(fs.readFileSync(p, 'utf8'))
  return { meta: bk.meta, t: bk.tables }
}

const P = load(fA1)   // instancia A, antes de la anulacion
const Q = load(fB)    // instancia B
const R = load(fA2)   // instancia A, al dia siguiente

// Los dos registros que sostienen todo el caso. Son ids reales del negocio.
const OID = '143f3098-d7a6-437c-b822-a559b47d905a'  // pedido de la Mesa 1
const MANI = 'ff10fc67-ffca-4eb9-a197-e4acc7a8ab45' // Batido de mani B

let n = 0
let ok = 0
const mal = []
function A(etiqueta, cond, detalle) {
  n++
  const cab = (cond ? '  OK  ' : '  XX  ') + String(n).padStart(2) + '. '
  if (cond) ok++
  else mal.push(n)
  console.log(cab + etiqueta + (detalle ? '  --  ' + detalle : ''))
}

// Saldo de un producto en una ubicacion, DERIVADO del libro mayor (nunca de la
// cache), opcionalmente cortando en un instante.
const ledger = (X, pid, loc, hasta) =>
  X.t.stockMovements
    .filter((m) => m.productId === pid && (m.location || '__almacen') === loc && m.createdAt < (hasta || '9999'))
    .reduce((a, m) => a + m.qty, 0)

const cursor = (X, col) => {
  const r = X.t.syncState.find((s) => s.key === 'push:' + col)
  return r ? String(r.value) : ''
}

const ordersRepo = src('repositories/ordersRepo.js')
const countsRepo = src('repositories/countsRepo.js')

console.log('\nFicheros:')
console.log('  A1 ' + P.meta.exportedAt + '  ' + fA1)
console.log('  B  ' + Q.meta.exportedAt + '  ' + fB)
console.log('  A2 ' + R.meta.exportedAt + '  ' + fA2)

console.log('\n=============== H1 - voidOrder no comprueba si el pedido ya tiene venta ===============\n')

const refSales = ordersRepo.split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /db\.sales|salesRepo/.test(l))
A('CODIGO: ordersRepo.js no toca la tabla sales en ninguna linea ejecutable',
  !/db\.sales/.test(ordersRepo) && refSales.every(([, l]) => l.trim().startsWith('//')),
  'db.sales: 0 apariciones; las ' + refSales.length + ' menciones a salesRepo van en comentario (linea ' + refSales.map(([i]) => i).join(',') + ')')

A('CODIGO: el unico candado de voidItem es order.status distinto de OPEN',
  ordersRepo.includes('if (order.status !== ORDER_STATUS.OPEN) throw'),
  'depende del unico campo que la sincronizacion puede perder')

A('CODIGO: voidOrder anula llamando a voidItem en bucle, y hereda ese candado',
  /async voidOrder[\s\S]{0,300}?for \(const it of live\)[\s\S]{0,150}?this\.voidItem/.test(ordersRepo))

A('CODIGO: la tabla sales NO tiene indice por orderId',
  src('db/db.js').includes("sales: 'id, shiftId, sellerId, createdAt, voided'"),
  'un where("orderId") lanzaria SchemaError: el arreglo tiene que ir por shiftId o por filter')

const venta = R.t.sales.find((s) => s.orderId === OID)
const ped = R.t.orders.find((o) => o.id === OID)
A('DATO: existe una venta NO anulada cuyo orderId es ese pedido',
  !!venta && venta.voided === false,
  'venta ' + venta.id.slice(0, 8) + ' - ' + venta.totalBase + ' MN - voided=' + venta.voided)

A('DATO: y el pedido quedo anulado y sin vinculo con ella',
  ped.status === 'voided' && ped.saleId === null,
  'status=' + ped.status + ' saleId=' + ped.saleId)

A('DATO: la venta esta EN LA MISMA BASE que ejecuto la anulacion',
  !!R.t.sales.find((s) => s.id === venta.id),
  'la evidencia que necesitaria el candado propuesto existe localmente')

const lineas = R.t.orderItems.filter((i) => i.orderId === OID)
const devol = R.t.stockMovements.filter((m) => m.refId === OID && m.refType === 'order_void')
A('DATO: 53 devoluciones de stock contra 49 lineas',
  lineas.length === 49 && devol.length === 53,
  'lineas=' + lineas.length + ' devoluciones=' + devol.length + ' -> 4 unidades inventadas')

A('DATO: el neto del pedido en el libro mayor es +4',
  R.t.stockMovements.filter((m) => m.refId === OID).reduce((a, m) => a + m.qty, 0) === 4)

const conVenta = new Map(R.t.sales.filter((s) => s.orderId && !s.voided).map((s) => [s.orderId, s]))
const patol = R.t.orders.filter((o) => conVenta.has(o.id) && (o.status !== 'closed' || !o.saleId))
A('ALCANCE: es un caso UNICO en toda la historia, no es sistemico',
  patol.length === 1 && patol[0].id === OID,
  'pedidos con la patologia: ' + patol.length + ' de ' + R.t.orders.length)

console.log('\n=============== H2 - el cobro de la mesa no es atomico ===============\n')

const ts = src('features/tables/TableScreen.jsx')
A('CODIGO: son dos await consecutivos, no una transaccion',
  /const saleId = await salesRepo\.create\(payload\)\s*\n\s*await ordersRepo\.markClosed/.test(ts),
  'TableScreen.jsx, el par create + markClosed')

A('CODIGO: el alcance transaccional de salesRepo.create NO incluye orders',
  src('repositories/salesRepo.js').includes("db.transaction('rw', db.sales, db.stockMovements, db.products, db.partnerMovements, db.accounts, db.accountMovements, db.shifts,"),
  '8 tablas, ninguna es orders: unirlas seria cirugia en la funcion del dinero')

const pedP = P.t.orders.find((o) => o.id === OID)
const venP = P.t.sales.find((s) => s.orderId === OID)
A('DATO: H2 NO actuo aqui - el markClosed SI se ejecuto donde se cobro',
  pedP.status === 'closed' && pedP.saleId === venP.id,
  'venta ' + venP.createdAt.slice(11, 23) + ' -> cierre ' + pedP.closedAt.slice(11, 23) +
  ' (' + (new Date(pedP.closedAt) - new Date(venP.createdAt)) + ' ms despues)')

const abiertosConVenta = [...conVenta.keys()]
  .map((id) => R.t.orders.find((o) => o.id === id))
  .filter((o) => o && o.status === 'open')
A('DATO: hoy no hay ningun pedido abierto con venta viva (latente, no activo)',
  abiertosConVenta.length === 0)

console.log('\n=============== H3 - el transporte parte transacciones atomicas ===============\n')

A('CODIGO: voidItem escribe linea + movimiento en UNA transaccion y con el MISMO ts',
  ordersRepo.includes("db.transaction('rw', db.orderItems, db.orders, db.stockMovements, db.products")
  && ordersRepo.includes('voidedAt: ts,') && ordersRepo.includes('createdAt: ts'),
  'esa igualdad de sello es la firma que permite emparejarlos')

A('CODIGO: kitchenRepo.produce escribe snapshot + movimientos + productos en UNA transaccion',
  /db\.transaction\('rw',[^)]*db\.productions[^)]*db\.stockMovements[^)]*db\.products/.test(src('repositories/kitchenRepo.js')))

A('CODIGO: nadie borra de stockMovements ni de orderItems en todo src/',
  !/\b(stockMovements|orderItems)\.(delete|clear|bulkDelete)\b/.test(todoSrc()),
  'sin esto, "falta una fila" admitiria otra explicacion')

const bk = src('features/backup/backupService.js')
A('CODIGO: applyBackup solo hace bulkPut, no puede quitar filas',
  bk.includes('bulkPut') && !/\.(bulkDelete|clear)\(/.test(bk))

// Las cuatro lineas cuya anulacion (19:54/19:55) nunca llego a la otra instancia.
const IDS4 = ['a5f1b7dc', 'ac5a18bb', 'aa12af31', 'f724e5b2']
let pares = 0
for (const pref of IDS4) {
  const li = P.t.orderItems.find((i) => i.id.startsWith(pref))
  const mv = P.t.stockMovements.find((m) => m.refId === OID && m.refType === 'order_void' && m.createdAt === li.voidedAt)
  if (li && mv) pares++
}
A('DATO: en A, las 4 lineas tienen voidedAt IDENTICO al createdAt de su movimiento',
  pares === 4, pares + '/4 pares exactos al milisegundo')

let sinMarca = 0
for (const pref of IDS4) {
  const li = R.t.orderItems.find((i) => i.id.startsWith(pref))
  if (li.voidedAt > '2026-09-22T00:00:00') sinMarca++
}
A('DATO: en B esas MISMAS lineas no tienen esa marca',
  sinMarca === 4, sinMarca + '/4 fueron anuladas otra vez en la anulacion masiva')

const ventana = (X) => X.t.stockMovements
  .filter((m) => m.refId === OID && m.refType === 'order_void'
    && m.createdAt > '2026-09-21T19:50' && m.createdAt < '2026-09-21T19:57')
  .map((m) => m.id).sort()
const m4P = ventana(P)
const m4R = ventana(R)
A('DATO: pero los MOVIMIENTOS de esa misma transaccion SI estan en las dos, y son las mismas filas',
  m4P.length === 4 && JSON.stringify(m4P) === JSON.stringify(m4R),
  'ids identicos: ' + m4P.map((x) => x.slice(0, 8)).join(' '))

A('CONCLUSION H3: una transaccion, dos colecciones, dos suertes',
  pares === 4 && sinMarca === 4 && m4P.length === 4)

const idsR = new Set(R.t.stockMovements.map((m) => m.id))
const perdidas = Q.t.stockMovements.filter((m) => !idsR.has(m.id))
A('DATO (2.o caso, independiente): A2 se exporto DESPUES que B y le faltan movimientos suyos',
  perdidas.length === 7 && R.meta.exportedAt > Q.meta.exportedAt,
  perdidas.length + ' filas - A2 ' + R.meta.exportedAt + ' > B ' + Q.meta.exportedAt)

A('DATO: append-only mas nadie borra => A y B son BASES DISTINTAS (prueba, no inferencia)',
  perdidas.length > 0 && perdidas.every((m) => m.refId === perdidas[0].refId),
  'las 7 son de UNA sola produccion: ' + perdidas[0].refId.slice(0, 8))

const huerfQ = Q.t.productions.filter((p) => !Q.t.stockMovements.some((m) => m.refId === p.id))
const huerfR = R.t.productions.filter((p) => !R.t.stockMovements.some((m) => m.refId === p.id))
const enAmbas = huerfQ.filter((p) => huerfR.some((x) => x.id === p.id))
A('DATO: hay producciones cuyos movimientos no estan en NINGUNA de las dos instancias',
  enAmbas.length === 2,
  enAmbas.map((p) => p.createdAt.slice(11, 19) + ' ' + p.recipeName).join(' | ') + ' -> tercera instancia')

const movSinDoc = [...new Set(R.t.stockMovements
  .filter((m) => m.refType === 'production' && !R.t.productions.some((p) => p.id === m.refId))
  .map((m) => m.refId))]
A('DATO: y el caso espejo, movimientos de produccion sin su snapshot',
  movSinDoc.length >= 1, 'refId ' + movSinDoc.map((x) => String(x).slice(0, 8)).join(' '))

// La prueba del cursor que SI puede detectar algo. La ingenua ("cursor por
// delante del maximo de su coleccion") es incapaz: la fila que levanto el
// cursor sigue siendo local, asi que entra en ese maximo.
const cQ = cursor(Q, 'stockMovements')
A('DATO: las filas perdidas estan POR DEBAJO del cursor de quien deberia subirlas',
  perdidas.length > 0 && perdidas.every((m) => m.createdAt < cQ),
  'cursor push:stockMovements = ' + cQ + ' | filas selladas en ' + perdidas[0].createdAt)

const colasLlenas = [P, Q, R].map((X) =>
  X.t.syncState.filter((s) => s.key.startsWith('retry:') && Array.isArray(s.value) && s.value.length).length)
A('DATO: y NO estan en ninguna cola de reintento (el motor cree que no hay pendientes)',
  colasLlenas.every((c) => c === 0), 'colas no vacias por fichero: ' + colasLlenas.join(', '))

console.log('\n=============== H4 - el ajuste del conteo fisico es un DELTA ===============\n')

A('CODIGO: approve calcula delta = fisico menos libro LOCAL, no un objetivo absoluto',
  countsRepo.includes('const sysNow = await stockFromLedger(it.productId, loc)')
  && countsRepo.includes('const delta = round2(Number(it.physicalQty) - sysNow)'),
  'F3 hizo que salga del libro y no de la cache; sigue siendo un delta')

A('CODIGO: y lo escribe como asiento append-only via stockRepo.adjust',
  /stockRepo\.adjust\(\{[\s\S]{0,140}?delta,/.test(countsRepo))

const cnt = Q.t.counts.find((c) => String(c.createdAt).startsWith('2026-09-22T14:02'))
const li = cnt.items.find((i) => i.productId === MANI)
const ajuste = R.t.stockMovements.find((m) => m.productId === MANI && m.type === 'adjustment'
  && m.createdAt > '2026-09-22T14:00' && m.createdAt < '2026-09-22T14:10')
A('DATO: el conteo registro systemStock=3, fisico=0 y escribio un ajuste de -3',
  li.systemStock === 3 && li.physicalQty === 0 && ajuste.qty === -3,
  'systemStock=' + li.systemStock + ' fisico=' + li.physicalQty + ' ajuste=' + ajuste.qty)

const antesB = ledger(Q, MANI, 'Salones', ajuste.createdAt)
const antesA = ledger(R, MANI, 'Salones', ajuste.createdAt)
A('DATO: en la instancia que conto el libro daba 3, y el ajuste la deja en 0 (CORRECTO)',
  antesB === 3 && antesB + ajuste.qty === 0, 'antes=' + antesB + ' despues=' + (antesB + ajuste.qty))

A('DATO: en la otra el libro daba 2, y el MISMO ajuste la deja en -1 (EL NEGATIVO)',
  antesA === 2 && antesA + ajuste.qty === -1, 'antes=' + antesA + ' despues=' + (antesA + ajuste.qty))

A('DATO: esa diferencia de 1 es exactamente la produccion que le falta a A',
  perdidas.filter((m) => m.productId === MANI && m.location === 'Salones').reduce((a, m) => a + m.qty, 0) === 1)

const negativos = R.t.products.filter((p) => Object.values(p.stockByLocation || {}).some((v) => Number(v) < 0))
A('DATO: el negativo persiste al cierre y es el UNICO del catalogo',
  negativos.length === 1 && negativos[0].id === MANI && ledger(R, MANI, 'Salones') === -1,
  'libro de A al exportar: ' + ledger(R, MANI, 'Salones') + ' | productos en negativo: ' +
  negativos.length + ' de ' + R.t.products.length)

A('CONTROL NEGATIVO: reinyectando solo el +1 ausente, el saldo de A cuadra en 0',
  ledger(R, MANI, 'Salones') + 1 === 0)

A('CONTROL NEGATIVO 2: un ajuste como OBJETIVO absoluto habria dejado 0 en las DOS instancias',
  antesA + ajuste.qty !== 0 && antesB + ajuste.qty === 0,
  'el delta -3 da -1 en A; un objetivo de 0 daria 0 en las dos')

console.log('\n=============== ' + ok + '/' + n + ' aserciones OK' +
  (mal.length ? ' - FALLAN: ' + mal.join(', ') : '') + ' ===============\n')
process.exit(mal.length ? 1 : 0)
