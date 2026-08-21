import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'

// Custodia de efectivo (modulo 'remesas') — LIBRO PROPIO Y AISLADO. Es la misma
// idea que la tesoreria (`accountsRepo`): un libro append-only del que se DERIVA
// el saldo (nunca se guarda). Pero vive en SU tabla (`custodyMovements`) y NO
// toca `accounts` ni `accountsRepo`: asi la tesoreria del negocio (modulo
// 'cuentas'), sus pantallas, el traspaso de turno y los reportes quedan
// EXACTAMENTE igual. El "tenedor" (holder) del efectivo es la caja central
// (REMESA_CENTRAL) o el userId de un mensajero; el saldo se lleva por
// tenedor+moneda (como el cuadre lleva el efectivo por moneda).
//
// Convenio: credit = entra efectivo a la custodia del tenedor; debit = sale.
//  - Ingreso (cobro al remitente): credit a la caja central.
//  - Asignar a un mensajero: debit central + credit mensajero (neto cero).
//  - Entregar al beneficiario: debit al mensajero.
//  - Devolver: debit mensajero + credit central.
export const custodyRepo = {
  // Movimiento crudo. SIN transaccion propia: pensado para llamarse DENTRO de una
  // transaccion que ya incluya db.custodyMovements (igual que addAccountMovementRaw).
  // El id puede pasarse DETERMINISTA para que dos dispositivos que registren el
  // MISMO evento antes de sincronizar generen el MISMO doc y la sync no duplique.
  async addMovementRaw({
    id = null,
    holder,
    direction, // 'credit' (entra a la custodia del tenedor) | 'debit' (sale)
    amount,
    currency = 'MN',
    type,
    refType = '',
    refId = null,
    byUserId = null,
    createdAt = null
  }) {
    const amt = round2(Number(amount) || 0)
    if (amt <= 0) return null
    if (!holder) throw new Error('Custodia sin tenedor')
    const movId = id || newId()
    await db.custodyMovements.add({
      id: movId,
      holder,
      direction,
      amount: amt,
      currency,
      type,
      refType,
      refId,
      byUserId,
      createdAt: createdAt || now()
    })
    return movId
  },

  // Saldos de TODOS los tenedores de una vez: { holder: { currency: monto } }.
  // Deriva de los movimientos (credit suma, debit resta), como accountsRepo.balances.
  async balances() {
    const rows = await db.custodyMovements.toArray()
    const map = {}
    for (const m of rows) {
      const sign = m.direction === 'debit' ? -1 : 1
      const h = m.holder
      const c = m.currency || 'MN'
      if (!map[h]) map[h] = {}
      map[h][c] = round2((map[h][c] || 0) + sign * Number(m.amount || 0))
    }
    return map
  },

  // Saldo de UN tenedor: { currency: monto }.
  async balanceOf(holder) {
    const rows = await db.custodyMovements.where('holder').equals(holder).toArray()
    const bal = {}
    for (const m of rows) {
      const sign = m.direction === 'debit' ? -1 : 1
      const c = m.currency || 'MN'
      bal[c] = round2((bal[c] || 0) + sign * Number(m.amount || 0))
    }
    return bal
  },

  async movements(holder) {
    const rows = await db.custodyMovements.where('holder').equals(holder).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async allMovements() {
    const rows = await db.custodyMovements.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
