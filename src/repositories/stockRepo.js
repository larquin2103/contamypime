import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { MOVEMENT_TYPES, WAREHOUSE } from '../db/constants'

// Libro mayor de inventario (append-only). El stock REAL se deriva de aqui;
// `products.stock` (total) y `products.stockByLocation` (por ubicacion) son
// caches que mantenemos en la misma transaccion para mostrar al instante sin
// recalcular sobre 400+ productos. Cada movimiento lleva su `location` (almacen
// central o un area); el stock de una ubicacion = suma de sus movimientos.
export const stockRepo = {
  async record({
    productId,
    qty,
    type,
    refType = null,
    refId = null,
    unitCost = null,
    shiftId = null,
    userId = null,
    note = '',
    location = WAREHOUSE
  }) {
    const id = newId()
    const ts = now()
    const delta = Number(qty)
    const loc = location || WAREHOUSE
    await db.transaction('rw', db.products, db.stockMovements, async () => {
      await db.stockMovements.add({
        id,
        productId,
        qty: delta,
        type,
        refType,
        refId,
        unitCost: unitCost != null ? Number(unitCost) : null,
        shiftId,
        userId,
        note,
        location: loc,
        createdAt: ts
      })
      const p = await db.products.get(productId)
      if (p) {
        const byLoc = { ...(p.stockByLocation || {}) }
        byLoc[loc] = Number(byLoc[loc] || 0) + delta
        await db.products.update(productId, {
          stock: Number(p.stock || 0) + delta,
          stockByLocation: byLoc,
          updatedAt: ts
        })
      }
    })
    return id
  },

  // Ajuste manual de existencia en una ubicacion (movimiento con nota, no se borra).
  async adjust({ productId, delta, note, userId, shiftId = null, location = WAREHOUSE }) {
    return this.record({
      productId,
      qty: delta,
      type: MOVEMENT_TYPES.ADJUSTMENT,
      note,
      userId,
      shiftId,
      location
    })
  },

  // Existencia de un producto en una ubicacion concreta (derivada del libro).
  async stockAt(productId, location = WAREHOUSE) {
    const movs = await db.stockMovements
      .where('[productId+location]').equals([productId, location || WAREHOUSE]).toArray()
    return movs.reduce((a, m) => a + Number(m.qty || 0), 0)
  },

  // Mapa { ubicacion: cantidad } de un producto, derivado del libro mayor.
  async stockByLocation(productId) {
    const movs = await db.stockMovements.where('productId').equals(productId).toArray()
    const map = {}
    for (const m of movs) {
      const loc = m.location || WAREHOUSE
      map[loc] = Number(map[loc] || 0) + Number(m.qty || 0)
    }
    return map
  },

  async movements(productId) {
    const rows = await db.stockMovements.where('productId').equals(productId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async listAll() {
    const rows = await db.stockMovements.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
