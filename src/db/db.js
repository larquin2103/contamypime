import Dexie from 'dexie'
import { WAREHOUSE } from './constants'

// ---------------------------------------------------------------------------
// Base de datos local (IndexedDB via Dexie).
//
// Principios de diseno (ver plan Fase 1):
//  - Claves primarias = UUID string  -> migracion limpia a Firestore/RxDB (Fase 4)
//  - Nada se borra: borrado logico (deletedAt / voided) + ajustes append-only
//  - El stock real se deriva de `stockMovements` (libro mayor). `products.stock`
//    es solo una cache para mostrar rapido.
//
// El string de cada store lista SOLO los indices. La PK es el primer campo.
// `*campo` = indice multiEntry (para arrays, p.ej. searchTokens).
// ---------------------------------------------------------------------------

export const db = new Dexie('mypicuadre')

db.version(1).stores({
  users: 'id, role, active',
  config: 'key',
  exchangeRates: 'id, currency, effectiveFrom',
  categories: 'id, order, active',
  products: 'id, code, categoryId, active, *searchTokens',
  priceChanges: 'id, productId, shiftId, createdAt',
  shifts: 'id, sellerId, status, openedAt',
  sales: 'id, shiftId, sellerId, createdAt, voided',
  stockMovements: 'id, productId, type, shiftId, refId, createdAt',
  purchases: 'id, shiftId, createdAt',
  cashMovements: 'id, shiftId, type, createdAt',
  internalDebts: 'id, shiftId, userId, productId, settled, createdAt',
  auditEvents: 'id, entity, entityId, createdAt'
})

// Fase 3 - Bloque 16: conteo fisico de inventario.
db.version(2).stores({
  counts: 'id, status, createdAt'
})

// Fase 4 - Bloque 23: estado de sincronizacion (cursores por coleccion).
// `key` = p.ej. "push:products" -> guarda la marca de agua ya subida.
db.version(3).stores({
  syncState: 'key'
})

// Fase 6 - Bloque 19: areas de venta dentro de un mismo punto. Cada producto
// pertenece a un area; el indice `area` permite filtrar/agrupar el catalogo.
// Los turnos guardan su `area` (caja independiente por area) y las ventas el
// area en que se cobraron (para detectar ventas "cruzadas" entre areas).
db.version(4).stores({
  products: 'id, code, categoryId, active, area, *searchTokens'
})

// Bloque 20: inventario por UBICACION (almacen central + cada area). Cada
// movimiento del libro mayor lleva `location`; el indice compuesto permite
// sumar el stock de un producto en una ubicacion concreta. `transfers` guarda
// las salidas almacen->area (append-only). Migracion: todo movimiento previo
// (sin ubicacion) y el stock actual quedan en el ALMACEN central.
db.version(5).stores({
  stockMovements: 'id, productId, type, shiftId, refId, location, [productId+location], createdAt',
  transfers: 'id, toArea, byUserId, createdAt'
}).upgrade(async (tx) => {
  await tx.table('stockMovements').toCollection().modify((m) => {
    if (m.location == null) m.location = WAREHOUSE
  })
  await tx.table('products').toCollection().modify((p) => {
    if (!p.stockByLocation) p.stockByLocation = { [WAREHOUSE]: Number(p.stock || 0) }
  })
})

// Fase 7 - Bloque 33: registro local de errores (diagnostico). Es LOCAL de
// cada dispositivo: no se sincroniza a la nube ni viaja en respaldos de turno.
db.version(6).stores({
  errorLog: 'id, createdAt'
})

// Bloque C (modulo 'cuentas'): terceros del negocio — proveedores (nos dejan
// mercancia en consignacion) y acreedores/terceros (les entregamos mercancia)
// — con su libro de movimientos append-only. El SALDO nunca se guarda: se
// deriva de los movimientos (como el stock del libro mayor), para que la
// sincronizacion offline multi-dispositivo no pise saldos. Migracion aditiva:
// solo agrega tablas vacias, no toca datos existentes.
db.version(7).stores({
  partners: 'id, type, active',
  partnerMovements: 'id, partnerId, type, refId, createdAt'
})

// Bloque D (modulo 'cuentas'): cuentas de tesoreria del negocio (Efectivo MN,
// Transferencias MN, Efectivo USD, MLC, ...) y su libro de creditos/debitos
// (append-only). El saldo se deriva de los movimientos. Las cuentas de sistema
// usan ids FIJOS (acc_cash_mn, ...) para que dos dispositivos offline creen la
// MISMA cuenta y la sync no duplique. Migracion aditiva: solo tablas vacias.
db.version(8).stores({
  accounts: 'id, active',
  accountMovements: 'id, accountId, direction, refId, createdAt'
})

// Modulo 'mayorista': conversion de productos en el almacen central. Un producto
// se consume (saco de azucar) y otro con su propio codigo se da de alta (jabas
// fraccionadas). Es append-only y genera dos movimientos en el libro mayor
// (CONVERSION_OUT / CONVERSION_IN); el stock de ambos productos sale de la suma,
// como siempre. Migracion aditiva: solo agrega una tabla vacia.
db.version(9).stores({
  conversions: 'id, fromProductId, toProductId, location, byUserId, createdAt'
})

// Modulo 'mesas': cuentas abiertas por mesa dentro de un area (cafeteria).
// `orders` es la cabecera del pedido (mesa, area, turno, estado) y `orderItems`
// son las lineas, APPEND-ONLY: cada consumo es una fila y las correcciones se
// marcan `voided` con su movimiento de compensacion, nunca se borran. Se modela
// asi (y no como un array dentro del pedido) porque la sincronizacion es
// "ultima escritura gana": con un array, dos dispositivos editando la misma
// mesa se pisarian; con filas, las adiciones se FUSIONAN, igual que el stock
// sale de la suma del libro mayor. Migracion aditiva: solo tablas vacias.
db.version(10).stores({
  orders: 'id, area, table, status, shiftId, openedBy, openedAt',
  orderItems: 'id, orderId, productId, voided, createdAt'
})

// Mermas (deterioro/perdida de mercancia): rebaja de inventario que NO es venta.
// `mermas` guarda el snapshot para el reporte de afectacion (precio de venta y
// costo AL MOMENTO de la merma, que pueden cambiar despues), igual que
// `purchases` acompaña a las entradas; el libro mayor lleva el MERMA_OUT que
// deriva el stock. Migracion aditiva: solo una tabla vacia.
db.version(11).stores({
  mermas: 'id, productId, location, userId, createdAt'
})

// Fase 8 - B3 (modulo 'imagenes'): miniaturas de productos, usuarios y carta de
// mesas. UNA imagen por referencia, con id DETERMINISTA `img:<refType>:<refId>`
// para que dos dispositivos NO la dupliquen; la sync "ultima escritura gana"
// fusiona por `updatedAt`. Guarda un `dataUrl` JPEG <=256px (<40 KB) -> cabe en
// Firestore y sincroniza sin costo (plan gratis). "Quitar" no borra (el delete
// esta prohibido por las reglas): deja `dataUrl` vacio. Los docs de products/
// users NO engordan: la foto vive aparte. Migracion aditiva: solo una tabla vacia.
db.version(12).stores({
  images: 'id, refType, updatedAt'
})

// Fase 7 - modulo 'cocina': recetas y bitacora de elaboracion (produccion).
// `recipes` es la receta que define el dueño (insumos y cantidades por unidad del
// elaborado); sus `items` viven como array dentro del doc porque la edita SOLO el
// dueño (baja concurrencia -> LWW por updatedAt, igual que transfers/sales guardan
// sus items). `productions` es la bitacora APPEND-ONLY de cada elaboracion (un
// snapshot para el reporte, como `mermas`/`purchases` acompañan al libro mayor);
// el stock real lo mueven los CONVERSION_*/TRANSFER_* en stockMovements, que ya
// existen y ya sincronizan. Migracion aditiva: solo agrega dos tablas vacias, no
// toca datos existentes. Sin el modulo quedan vacias y la app es identica a la clasica.
db.version(13).stores({
  recipes: 'id, active, outputProductId, createdAt',
  productions: 'id, recipeId, toArea, byUserId, createdAt'
})

// Fase 9 - Centro de notificaciones (Opcion A: LOCAL por dispositivo). Tabla
// DERIVADA: el motor (features/notifications/notificationService) LEE eventos ya
// existentes (ventas, cierres de turno, ajustes/mermas, traspasos, conteos) y
// MATERIALIZA avisos para el dueño. NO entra en SYNC_COLLECTIONS -> no viaja a la
// nube ni aterriza en el telefono del vendedor; cada dispositivo del dueño deriva
// la suya de los registros fuente que SI sincronizan (sin fugas ni costo de nube).
// Id DETERMINISTA (mc_notif:<type>:<sourceId>) -> re-derivar no duplica. Migracion
// aditiva: solo agrega una tabla vacia; nada existente cambia ni se migra.
db.version(14).stores({
  notifications: 'id, type, status, severity, createdAt, [status+createdAt]'
})

// Modulo 'remesas': gestion de remesas (orden -> pago -> custodia -> entrega ->
// liquidacion). CUATRO tablas NUEVAS y aditivas (solo agrega tablas vacias, no
// toca datos ni esquema existentes; sin `.upgrade()`), igual que v13 (cocina)
// agrego dos tablas vacias:
//  - `remittances`: cabecera de la orden (remitente/beneficiario congelados,
//    monto, estado). La edita el mando; LWW por updatedAt.
//  - `deliveries`: entregas append-only (una fila por intento/resultado); las
//    correcciones se marcan `voided`, nunca se borran (como `orderItems`).
//  - `custodyMovements`: libro append-only del efectivo en custodia. El SALDO por
//    tenedor+moneda se DERIVA de estos movimientos (como el stock sale del libro
//    mayor y el saldo de una cuenta de sus movimientos); nunca se guarda. El
//    indice [holder+currency] permite sumar por mensajero/moneda.
//  - `settlements`: bitacora append-only de cada liquidacion (snapshot teorico/
//    fisico/diferencia), como `mermas`/`productions` acompañan al libro mayor.
// Sin el modulo, las cuatro quedan vacias y la app es identica a la clasica.
// NOTA: NO se agregan a SYNC_COLLECTIONS aqui: cada tabla se registrara para la
// sincronizacion en la fase que empiece a escribirla (junto a su codigo), para
// no tocar la capa de sync mientras estan vacias.
db.version(15).stores({
  remittances: 'id, status, assignedCourierId, createdAt, updatedAt',
  deliveries: 'id, remittanceId, courierId, result, voided, createdAt',
  custodyMovements: 'id, holder, type, refId, createdAt, [holder+currency]',
  settlements: 'id, courierId, settledAt, createdAt'
})

// Modulo 'remesas' (F3): COBROS al remitente de entregas "contra entrega". Snapshot
// append-only (comprobante, pagador, cuenta y monto) que ACOMPAÑA al credito real en
// la tesoreria (accountMovements, concepto 'entrega') — el dinero vive alla, como
// mermas/producciones acompañan al libro mayor. Tabla NUEVA y aditiva (sin upgrade).
// Sin el modulo queda vacia y la app es identica a la clasica.
db.version(16).stores({
  collections: 'id, remittanceId, accountId, createdAt'
})
