import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { MOVEMENT_TYPES } from '../db/constants'

// Libro mayor de inventario (append-only). El stock REAL se deriva de aqui;
// `products.stock` es una cache que mantenemos en la misma transaccion para
// poder mostrar existencias al instante sin recalcular sobre 400+ productos.
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
    note = ''
  }) {
    const id = newId()
    const ts = now()
    const delta = Number(qty)
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
        createdAt: ts
      })
      const p = await db.products.get(productId)
      if (p) {
        await db.products.update(productId, {
          stock: Number(p.stock || 0) + delta,
          updatedAt: ts
        })
      }
    })
    return id
  },

  // Ajuste manual de existencia (queda como movimiento con nota, no se borra).
  async adjust({ productId, delta, note, userId, shiftId = null }) {
    return this.record({
      productId,
      qty: delta,
      type: MOVEMENT_TYPES.ADJUSTMENT,
      note,
      userId,
      shiftId
    })
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
