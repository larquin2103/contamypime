import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { MOVEMENT_TYPES } from '../db/constants'

// Ventas de mostrador. Cada venta congela el precio y el costo de cada linea
// (snapshot), por lo que cambiar el precio mas tarde NO altera ventas previas.
// El descuento de inventario y el movimiento del libro mayor ocurren en la
// misma transaccion que la venta.
export const salesRepo = {
  async create({
    shiftId,
    sellerId,
    items,
    totalBase,
    paymentCurrency,
    cashAmount,
    amountPaid,
    change,
    rate = null
  }) {
    const id = newId()
    const ts = now()
    await db.transaction('rw', db.sales, db.stockMovements, db.products, async () => {
      await db.sales.add({
        id,
        shiftId,
        sellerId,
        createdAt: ts,
        items, // [{ productId, name, unit, qty, unitPrice, unitCost, lineTotal }]
        totalBase,
        paymentCurrency,
        // Contrato con shiftsRepo.getSummary: moneda y monto neto que entra a caja.
        cashCurrency: paymentCurrency,
        cashAmount,
        amountPaid,
        change,
        rate,
        voided: false
      })
      for (const it of items) {
        const qty = Math.abs(Number(it.qty))
        await db.stockMovements.add({
          id: newId(),
          productId: it.productId,
          qty: -qty,
          type: MOVEMENT_TYPES.SALE_OUT,
          refType: 'sale',
          refId: id,
          unitCost: it.unitCost ?? null,
          shiftId,
          userId: sellerId,
          note: '',
          createdAt: ts
        })
        const p = await db.products.get(it.productId)
        if (p) {
          await db.products.update(it.productId, {
            stock: Number(p.stock || 0) - qty,
            updatedAt: ts
          })
        }
      }
    })
    return id
  },

  async byShift(shiftId) {
    const rows = await db.sales.where('shiftId').equals(shiftId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
