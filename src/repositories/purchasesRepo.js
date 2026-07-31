import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { MOVEMENT_TYPES, WAREHOUSE } from '../db/constants'

// Entradas de mercancia (compras). Aumentan la existencia y dejan el
// movimiento en el libro mayor. Tambien actualizan el costo actual del
// producto al ultimo costo de compra (para el analisis de rentabilidad).
export const purchasesRepo = {
  // `location` (opcional): ubicacion a la que ENTRA la mercancia. Por defecto el
  // ALMACEN central (comportamiento clasico e invariante historico). Solo el
  // vendedor con permiso puede pasar el AREA de su turno para entrar directo a
  // ella (se salta el traspaso). El stock real se deriva del libro mayor por
  // ubicacion, asi que la sync lo propaga y recalcula igual en cada dispositivo.
  async create({ items, supplier = '', userId, shiftId = null, note = '', consignmentPartnerId = null, location = WAREHOUSE }) {
    const id = newId()
    const ts = now()
    const loc = String(location || WAREHOUSE)
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
        // Entrada en consignacion (Bloque C): la mercancia es del proveedor;
        // la deuda se acumula al VENDERSE (no al entrar). Solo trazabilidad.
        consignmentPartnerId,
        location: loc, // ubicacion a la que entro (almacen por defecto; o un area)
        note
      })
      // Por defecto la mercancia ingresa al ALMACEN central (de ahi se reparte a
      // las areas con salidas, Bloque 20). Si se indica un area (entrada directa
      // del vendedor a su area), entra alli: el stock de esa ubicacion se deriva
      // igual del libro mayor.
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
          location: loc,
          createdAt: ts
        })
        const p = await db.products.get(it.productId)
        if (p) {
          const byLoc = { ...(p.stockByLocation || {}) }
          byLoc[loc] = Number(byLoc[loc] || 0) + qty
          await db.products.update(it.productId, {
            stock: Number(p.stock || 0) + qty,
            stockByLocation: byLoc,
            cost: it.unitCost, // ultimo costo de compra
            updatedAt: ts
          })
        }
      }
    })
    return id
  }
}
