import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { ensureSystemAccount, addAccountMovementRaw } from './accountsRepo'

// Extracciones de caja (separadas de las ventas). Registran monto, moneda,
// motivo y quien autoriza. Restan del efectivo esperado en el cuadre.
export const cashRepo = {
  // `debitAccount` (Bloque D, modulo cuentas): ademas debita la cuenta de
  // tesoreria "Efectivo <moneda>" en tiempo real. Lo decide la pantalla segun
  // la licencia; false = comportamiento clasico.
  async withdraw({ shiftId, userId, amount, currency, reason = '', authorizedBy = '', debitAccount = false }) {
    const id = newId()
    const ts = now()
    const amt = round2(Number(amount) || 0)
    await db.transaction('rw', db.cashMovements, db.accounts, db.accountMovements, async () => {
      await db.cashMovements.add({
        id,
        shiftId,
        userId,
        type: 'withdrawal',
        amount: amt,
        currency,
        reason,
        authorizedBy,
        createdAt: ts
      })
      if (debitAccount && amt > 0) {
        const accId = await ensureSystemAccount('cash', currency)
        await addAccountMovementRaw({
          accountId: accId,
          direction: 'debit',
          amount: amt,
          currency,
          refType: 'withdrawal',
          refId: id,
          note: reason,
          userId,
          createdAt: ts
        })
      }
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
