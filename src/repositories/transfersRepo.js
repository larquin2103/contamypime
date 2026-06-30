import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { MOVEMENT_TYPES, WAREHOUSE } from '../db/constants'

// Salidas del ALMACEN central hacia un AREA (Bloque 20). Es un traspaso
// append-only: cada producto genera un TRANSFER_OUT en el almacen (-cant) y un
// TRANSFER_IN en el area (+cant). El total del producto no cambia; solo se
// mueve entre ubicaciones. Valida que el almacen tenga existencia suficiente.
export const transfersRepo = {
  // items: [{ productId, name, unit, qty }]
  async create({ toArea, items, byUserId, note = '' }) {
    const area = String(toArea || '').trim()
    if (!area) throw new Error('Indica el área de destino')
    const clean = (items || [])
      .map((it) => ({ ...it, qty: Math.abs(Number(it.qty) || 0) }))
      .filter((it) => it.productId && it.qty > 0)
    if (!clean.length) throw new Error('Agrega al menos un producto con cantidad')

    const id = newId()
    const ts = now()
    await db.transaction('rw', db.transfers, db.stockMovements, db.products, async () => {
      // Validación previa: el almacén debe tener existencia suficiente de cada
      // producto (no se puede sacar lo que no hay). Aborta toda la transacción.
      for (const it of clean) {
        const p = await db.products.get(it.productId)
        const inWarehouse = Number(p?.stockByLocation?.[WAREHOUSE] || 0)
        if (it.qty > inWarehouse) {
          throw new Error(`No hay suficiente "${it.name || 'producto'}" en el almacén (disponible ${inWarehouse})`)
        }
      }

      await db.transfers.add({
        id,
        toArea: area,
        items: clean.map((it) => ({
          productId: it.productId,
          name: it.name || '',
          unit: it.unit || '',
          qty: it.qty
        })),
        byUserId,
        note: String(note || '').trim(),
        createdAt: ts
      })

      for (const it of clean) {
        // Salida del almacén.
        await db.stockMovements.add({
          id: newId(),
          productId: it.productId,
          qty: -it.qty,
          type: MOVEMENT_TYPES.TRANSFER_OUT,
          refType: 'transfer',
          refId: id,
          userId: byUserId,
          note: '',
          location: WAREHOUSE,
          createdAt: ts
        })
        // Entrada al área.
        await db.stockMovements.add({
          id: newId(),
          productId: it.productId,
          qty: it.qty,
          type: MOVEMENT_TYPES.TRANSFER_IN,
          refType: 'transfer',
          refId: id,
          userId: byUserId,
          note: '',
          location: area,
          createdAt: ts
        })
        // Caché por ubicación: el total no cambia, solo se mueve almacén -> área.
        const p = await db.products.get(it.productId)
        if (p) {
          const byLoc = { ...(p.stockByLocation || {}) }
          byLoc[WAREHOUSE] = round2(Number(byLoc[WAREHOUSE] || 0) - it.qty)
          byLoc[area] = round2(Number(byLoc[area] || 0) + it.qty)
          await db.products.update(it.productId, { stockByLocation: byLoc, updatedAt: ts })
        }
      }
    })
    return id
  },

  async listAll() {
    const rows = await db.transfers.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async byArea(area) {
    const rows = await db.transfers.where('toArea').equals(area).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
