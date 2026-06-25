import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { MOVEMENT_TYPES } from '../db/constants'

// Deuda interna: retiro de producto sin pago. Descuenta inventario, NO cuenta
// como ingreso y queda como deuda asociada a un usuario registrado.
export const debtsRepo = {
  async create({ shiftId, debtorUserId, registeredBy, authorizedBy = '', productId, qty, unitValue, note = '' }) {
    const id = newId()
    const ts = now()
    const q = Math.abs(Number(qty))
    const valueAtTime = round2(q * (Number(unitValue) || 0))
    await db.transaction('rw', db.internalDebts, db.stockMovements, db.products, async () => {
      await db.internalDebts.add({
        id,
        shiftId,
        userId: debtorUserId, // a quien se le asocia la deuda
        registeredBy,
        authorizedBy,
        productId,
        qty: q,
        valueAtTime,
        note,
        settled: false,
        createdAt: ts
      })
      await db.stockMovements.add({
        id: newId(),
        productId,
        qty: -q,
        type: MOVEMENT_TYPES.INTERNAL_DEBT_OUT,
        refType: 'internal_debt',
        refId: id,
        shiftId,
        userId: registeredBy,
        note,
        createdAt: ts
      })
      const p = await db.products.get(productId)
      if (p) {
        await db.products.update(productId, { stock: Number(p.stock || 0) - q, updatedAt: ts })
      }
    })
    return id
  },

  async byShift(shiftId) {
    const rows = await db.internalDebts.where('shiftId').equals(shiftId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async listAll() {
    const rows = await db.internalDebts.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Liquida (salda) una deuda: no se borra, queda con fecha, quien la saldo y
  // COMO se resolvio (efectivo/transferencia/nomina/condonada) + nota opcional.
  // `settledAt` hace que la sync detecte el cambio (LWW por marca de tiempo).
  async settle(id, byUserId, { method = null, note = '' } = {}) {
    await db.internalDebts.update(id, {
      settled: true,
      settledAt: now(),
      settledBy: byUserId,
      settleMethod: method,
      settleNote: note.trim()
    })
  }
}
