import Dexie from 'dexie'

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
