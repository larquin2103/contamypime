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
    paymentMethod = 'cash',
    // efectivo
    paymentCurrency = null,
    cashAmount = 0,
    amountPaid = 0,
    change = 0,
    rate = null,
    // transferencia
    transferCurrency = null,
    transferAmount = 0,
    transferReference = '',
    transferSms = ''
  }) {
    const id = newId()
    const ts = now()
    const isCash = paymentMethod === 'cash'
    await db.transaction('rw', db.sales, db.stockMovements, db.products, async () => {
      await db.sales.add({
        id,
        shiftId,
        sellerId,
        createdAt: ts,
        items, // [{ productId, name, unit, qty, unitPrice, unitCost, lineTotal }]
        totalBase,
        paymentMethod,
        // Contrato con shiftsRepo.getSummary: solo el efectivo entra a caja.
        // En transferencia, cashCurrency queda null para no afectar el cuadre de caja.
        paymentCurrency: isCash ? paymentCurrency : null,
        cashCurrency: isCash ? paymentCurrency : null,
        cashAmount: isCash ? cashAmount : 0,
        amountPaid: isCash ? amountPaid : 0,
        change: isCash ? change : 0,
        rate,
        // datos de transferencia (Fase 2)
        transferCurrency: isCash ? null : transferCurrency,
        transferAmount: isCash ? 0 : transferAmount,
        transferReference: isCash ? '' : transferReference,
        transferSms: isCash ? '' : transferSms,
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
