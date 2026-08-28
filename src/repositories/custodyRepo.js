import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { deriveBalances, deriveHolderBalance } from '../lib/custodyMath'
import { ROLES, CUSTODY_MOVEMENT_TYPES } from '../db/constants'
import { addAccountMovementRaw } from './accountsRepo'

// Custodia de efectivo (modulo 'remesas') — LIBRO PROPIO. Es la misma idea que la
// tesoreria (`accountsRepo`): un libro append-only del que se DERIVA el saldo (nunca
// se guarda). Vive en SU tabla (`custodyMovements`), separada de `accounts`: la
// tesoreria del negocio, sus pantallas, el traspaso de turno y los reportes existentes
// no cambian. El "tenedor" (holder) del efectivo es el userId de un mensajero; el
// saldo se lleva por tenedor+moneda (como el cuadre lleva el efectivo por moneda).
//
// Convenio: credit = entra efectivo a la custodia del tenedor; debit = sale.
//  - Dar fondo:  debit a la CUENTA de tesoreria + credit al mensajero.
//  - Entregar al beneficiario: debit al mensajero (reparte de su fondo).
//  - Devolver fondo: debit al mensajero + credit a la CUENTA de tesoreria.
//
// El unico punto donde este libro toca la tesoreria es el FONDO, porque ese efectivo
// SALE DE LAS CUENTAS DEL NEGOCIO (decision del dueño) y debe verse alli. El cobro al
// remitente lo acredita `remittancesRepo.collect`, no este repo.
//
// La "caja central" (REMESA_CENTRAL) fue un tenedor intermedio en fases anteriores y
// YA NO se usa: el fondo va de la cuenta al mensajero directo. Sus movimientos
// historicos se conservan (append-only) y el panel los sigue mostrando.
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
  // entrega): sale de una CUENTA DE TESORERIA del negocio y entra a su custodia, en
  // UNA transaccion. Es la contraparte del descuento que hace cada entrega al debitar
  // su custodia. NO atado a una entrega concreta.
  //
  // El dinero del fondo SALE DE LAS CUENTAS DEL NEGOCIO (decision del dueño): por eso
  // se DEBITA la cuenta elegida con el mismo helper que ventas y cobros
  // (addAccountMovementRaw, concepto 'fondo'). Antes solo se movia dentro de la
  // custodia y la tesoreria seguia mostrando un efectivo que ya no estaba.
  // La "caja central" (REMESA_CENTRAL) YA NO participa: el fondo va de la cuenta al
  // mensajero directo, asi no queda un tenedor en negativo que nadie cuadra. Los
  // movimientos viejos contra la central se conservan (append-only) y el panel los
  // sigue mostrando.
  // Sin el modulo 'cuentas' (accountId nulo) se dota SIN debitar cuenta, igual que
  // `collect` acredita sin cuenta: degradacion limpia, regularizable despues con el
  // ajuste manual de tesoreria.
  // El id de la operacion se DERIVA del contenido (mensajero + instante), no es
  // aleatorio: un doble toque o un reintento NO puede doblar el debito a la cuenta.
  // Dos dotaciones distintas ocurren en instantes distintos y se registran las dos.
  async provisionFund({ courierId, amount, currency = 'MN', accountId = null, actorId = null }) {
    const amt = round2(Number(amount) || 0)
    if (amt <= 0) throw new Error('El monto del fondo debe ser mayor que cero')
    const ts = now()
    await db.transaction('rw', db.custodyMovements, db.users, db.auditEvents, db.accounts, db.accountMovements, async () => {
      const courier = await db.users.get(courierId)
      if (!courier || courier.role !== ROLES.COURIER || !courier.active) {
        throw new Error('El mensajero no es valido')
      }
      // Cuenta origen (si hay modulo 'cuentas'): manda SU moneda, para que la
      // tesoreria y la custodia del mensajero queden en la misma (cuadre limpio).
      let acc = null
      if (accountId) {
        acc = await db.accounts.get(accountId)
        if (!acc) throw new Error('Cuenta de tesoreria no encontrada')
      }
      const cur = acc ? acc.currency : currency
      const op = `${courierId}:${ts}`
      if (await db.custodyMovements.get(`fund-in:${op}`)) return // ya dotado: idempotente
      if (acc) {
        await addAccountMovementRaw({
          id: `acctmov:fund:${op}`, accountId, direction: 'debit', amount: amt,
          currency: acc.currency, refType: 'fund', concept: 'fondo', refId: courierId,
          note: `Fondo a ${courier.name || 'mensajero'}`, userId: actorId, createdAt: ts
        })
      }
      await custodyRepo.addMovementRaw({
        id: `fund-in:${op}`, holder: courierId, direction: 'credit',
        amount: amt, currency: cur, type: CUSTODY_MOVEMENT_TYPES.FUND,
        refType: 'fund', refId: courierId, byUserId: actorId, createdAt: ts
      })
      await db.auditEvents.add({
        id: newId(), entity: 'custody', entityId: courierId, action: 'fund_provision',
        courierId, amount: amt, currency: cur, accountId: acc ? accountId : null,
        userId: actorId, createdAt: ts
      })
    })
  },

  // Devuelve fondo de un mensajero a la CUENTA de tesoreria elegida (al cerrar el
  // turno o cambiar de mano), en UNA transaccion: es el espejo exacto de la dotacion
  // —debita su custodia y ACREDITA la cuenta—, para que el efectivo que vuelve
  // reaparezca en la tesoreria. Lo que no se devuelve queda en su custodia para el
  // dia siguiente. Sin el modulo 'cuentas' se devuelve sin acreditar cuenta, y el id
  // se deriva del contenido igual que en la dotacion.
  async returnFund({ courierId, amount, currency = 'MN', accountId = null, actorId = null }) {
    const amt = round2(Number(amount) || 0)
    if (amt <= 0) throw new Error('El monto a devolver debe ser mayor que cero')
    const ts = now()
    await db.transaction('rw', db.custodyMovements, db.users, db.auditEvents, db.accounts, db.accountMovements, async () => {
      let acc = null
      if (accountId) {
        acc = await db.accounts.get(accountId)
        if (!acc) throw new Error('Cuenta de tesoreria no encontrada')
      }
      const cur = acc ? acc.currency : currency
      const op = `${courierId}:${ts}`
      if (await db.custodyMovements.get(`fundret-out:${op}`)) return // ya devuelto: idempotente
      await custodyRepo.addMovementRaw({
        id: `fundret-out:${op}`, holder: courierId, direction: 'debit',
        amount: amt, currency: cur, type: CUSTODY_MOVEMENT_TYPES.FUND,
        refType: 'fund', refId: courierId, byUserId: actorId, createdAt: ts
      })
      if (acc) {
        const courier = await db.users.get(courierId)
        await addAccountMovementRaw({
          id: `acctmov:fundret:${op}`, accountId, direction: 'credit', amount: amt,
          currency: acc.currency, refType: 'fund', concept: 'fondo', refId: courierId,
          note: `Devolución de fondo de ${courier?.name || 'mensajero'}`, userId: actorId, createdAt: ts
        })
      }
      await db.auditEvents.add({
        id: newId(), entity: 'custody', entityId: courierId, action: 'fund_return',
        courierId, amount: amt, currency: cur, accountId: acc ? accountId : null,
        userId: actorId, createdAt: ts
      })
    })
  }
}
