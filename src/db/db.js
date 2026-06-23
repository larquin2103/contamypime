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
