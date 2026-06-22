import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'

// Extracciones de caja (separadas de las ventas). Registran monto, moneda,
// motivo y quien autoriza. Restan del efectivo esperado en el cuadre.
export const cashRepo = {
  async withdraw({ shiftId, userId, amount, currency, reason = '', authorizedBy = '' }) {
    const id = newId()
    await db.cashMovements.add({
      id,
      shiftId,
      userId,
      type: 'withdrawal',
      amount: round2(Number(amount) || 0),
      currency,
      reason,
      authorizedBy,
      createdAt: now()
    })
    return id
  },

  async byShift(shiftId) {
    const rows = await db.cashMovements.where('shiftId').equals(shiftId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async listAll() {
    const rows = await db.cashMovements.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
