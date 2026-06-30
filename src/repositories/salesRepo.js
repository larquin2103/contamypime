import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { MOVEMENT_TYPES, WAREHOUSE } from '../db/constants'

// Ventas de mostrador. Cada venta congela el precio y el costo de cada linea
// (snapshot), por lo que cambiar el precio mas tarde NO altera ventas previas.
// El descuento de inventario y el movimiento del libro mayor ocurren en la
// misma transaccion que la venta.
export const salesRepo = {
  async create({
    shiftId,
    sellerId,
    area = '', // area del turno donde se cobro la venta
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
    transferSms = '',
    transferExpected = 0 // lo que se debia cobrar en la moneda de la transferencia
  }) {
    const id = newId()
    const ts = now()
    const isCash = paymentMethod === 'cash'
    // Diferencia entre lo recibido por transferencia y lo que debia cobrarse.
    const transferDiff = isCash ? 0 : round2(Number(transferAmount || 0) - Number(transferExpected || 0))
    const shiftArea = String(area || '').trim()
    // Bloque 20: con stock por area, un vendedor solo vende lo asignado a SU
    // area; la "venta cruzada" queda retirada (hasCrossArea solo como dato
    // historico de ventas previas). El area del producto se guarda informativa.
    const hasCrossArea = false
    await db.transaction('rw', db.sales, db.stockMovements, db.products, async () => {
      await db.sales.add({
        id,
        shiftId,
        sellerId,
        area: shiftArea,
        hasCrossArea,
        createdAt: ts,
        items, // [{ productId, name, unit, qty, unitPrice, unitCost, lineTotal, area }]
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
        transferExpected: isCash ? 0 : round2(Number(transferExpected || 0)),
        transferDiff,
        voided: false
      })
      // La venta rebaja el stock del AREA donde se cobro (su ubicacion). Sin
      // areas configuradas, la ubicacion es el almacen (comportamiento clasico).
      const loc = shiftArea || WAREHOUSE
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
          location: loc,
          createdAt: ts
        })
        const p = await db.products.get(it.productId)
        if (p) {
          const byLoc = { ...(p.stockByLocation || {}) }
          byLoc[loc] = Number(byLoc[loc] || 0) - qty
          await db.products.update(it.productId, {
            stock: Number(p.stock || 0) - qty,
            stockByLocation: byLoc,
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
  },

  async listAll() {
    const rows = await db.sales.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
