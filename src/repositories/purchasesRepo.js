import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { MOVEMENT_TYPES } from '../db/constants'

// Entradas de mercancia (compras). Aumentan la existencia y dejan el
// movimiento en el libro mayor. Tambien actualizan el costo actual del
// producto al ultimo costo de compra (para el analisis de rentabilidad).
export const purchasesRepo = {
  async create({ items, supplier = '', userId, shiftId = null, note = '' }) {
    const id = newId()
    const ts = now()
    const normItems = items.map((it) => ({
      productId: it.productId,
      name: it.name,
      unit: it.unit,
      qty: Number(it.qty),
      unitCost: Number(it.unitCost) || 0,
      lineTotal: round2(Number(it.qty) * (Number(it.unitCost) || 0))
    }))
    const totalBase = round2(normItems.reduce((a, it) => a + it.lineTotal, 0))

    await db.transaction('rw', db.purchases, db.stockMovements, db.products, async () => {
      await db.purchases.add({
        id,
        createdAt: ts,
        userId,
        shiftId,
        supplier: supplier.trim(),
        items: normItems,
        totalBase,
        note
      })
      for (const it of normItems) {
        const qty = Math.abs(it.qty)
        await db.stockMovements.add({
          id: newId(),
          productId: it.productId,
          qty,
          type: MOVEMENT_TYPES.PURCHASE_IN,
          refType: 'purchase',
          refId: id,
          unitCost: it.unitCost,
          shiftId,
          userId,
          note: '',
          createdAt: ts
        })
        const p = await db.products.get(it.productId)
        if (p) {
          await db.products.update(it.productId, {
            stock: Number(p.stock || 0) + qty,
            cost: it.unitCost, // ultimo costo de compra
            updatedAt: ts
          })
        }
      }
    })
    return id
  }
}
