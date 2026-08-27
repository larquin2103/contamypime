import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { deriveBalances, deriveHolderBalance } from '../lib/custodyMath'
import { ROLES, REMESA_CENTRAL, CUSTODY_MOVEMENT_TYPES } from '../db/constants'

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
  // La matematica vive en lib/custodyMath (pura y testeada con node).
  async balances() {
    const rows = await db.custodyMovements.toArray()
    return deriveBalances(rows)
  },

  // Saldo de UN tenedor: { currency: monto }.
  async balanceOf(holder) {
    const rows = await db.custodyMovements.where('holder').equals(holder).toArray()
    return deriveHolderBalance(rows, holder)
  },

  async movements(holder) {
    const rows = await db.custodyMovements.where('holder').equals(holder).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async allMovements() {
    const rows = await db.custodyMovements.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Dota un FONDO a un mensajero (el efectivo que repartira en entregas contra
  // entrega): caja central -> mensajero, en UNA transaccion. Es la contraparte del
  // descuento que hace cada entrega al debitar su custodia. NO atado a una entrega
  // concreta. Como una extraccion manual de caja, el id es aleatorio (el candado
  // contra doble envio lo pone la UI); dos dotaciones distintas son eventos distintos.
  async provisionFund({ courierId, amount, currency = 'MN', actorId = null }) {
    const amt = round2(Number(amount) || 0)
    if (amt <= 0) throw new Error('El monto del fondo debe ser mayor que cero')
    const ts = now()
    await db.transaction('rw', db.custodyMovements, db.users, db.auditEvents, async () => {
      const courier = await db.users.get(courierId)
      if (!courier || courier.role !== ROLES.COURIER || !courier.active) {
        throw new Error('El mensajero no es valido')
      }
      const op = newId()
      await custodyRepo.addMovementRaw({
        id: `fund-out:${op}`, holder: REMESA_CENTRAL, direction: 'debit',
        amount: amt, currency, type: CUSTODY_MOVEMENT_TYPES.FUND,
        refType: 'fund', refId: courierId, byUserId: actorId, createdAt: ts
      })
      await custodyRepo.addMovementRaw({
        id: `fund-in:${op}`, holder: courierId, direction: 'credit',
        amount: amt, currency, type: CUSTODY_MOVEMENT_TYPES.FUND,
        refType: 'fund', refId: courierId, byUserId: actorId, createdAt: ts
      })
      await db.auditEvents.add({
        id: newId(), entity: 'custody', entityId: courierId, action: 'fund_provision',
        courierId, amount: amt, currency, userId: actorId, createdAt: ts
      })
    })
  },

  // Devuelve fondo de un mensajero a la caja central (al cerrar el turno o cambiar de
  // mano): mensajero -> central, en UNA transaccion. Lo que no se devuelve queda en su
  // custodia para el dia siguiente (turnos de dos y dos).
  async returnFund({ courierId, amount, currency = 'MN', actorId = null }) {
    const amt = round2(Number(amount) || 0)
    if (amt <= 0) throw new Error('El monto a devolver debe ser mayor que cero')
    const ts = now()
    await db.transaction('rw', db.custodyMovements, db.users, db.auditEvents, async () => {
      const op = newId()
      await custodyRepo.addMovementRaw({
        id: `fundret-out:${op}`, holder: courierId, direction: 'debit',
        amount: amt, currency, type: CUSTODY_MOVEMENT_TYPES.FUND,
        refType: 'fund', refId: courierId, byUserId: actorId, createdAt: ts
      })
      await custodyRepo.addMovementRaw({
        id: `fundret-in:${op}`, holder: REMESA_CENTRAL, direction: 'credit',
        amount: amt, currency, type: CUSTODY_MOVEMENT_TYPES.FUND,
        refType: 'fund', refId: courierId, byUserId: actorId, createdAt: ts
      })
      await db.auditEvents.add({
        id: newId(), entity: 'custody', entityId: courierId, action: 'fund_return',
        courierId, amount: amt, currency, userId: actorId, createdAt: ts
      })
    })
  }
}
