import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'

// Cuentas de tesoreria (Bloque D, modulo 'cuentas'): donde vive el dinero del
// negocio. Cada venta acredita su cuenta EN TIEMPO REAL (efectivo MN a
// "Efectivo MN", transferencias a "Transferencias", por moneda); extracciones
// y pagos a proveedores la debitan. El libro es append-only y el saldo se
// deriva de los movimientos (nunca se guarda) -> seguro ante sync offline.
//
// Las cuentas de SISTEMA usan ids fijos y deterministas (acc_cash_mn, ...):
// dos dispositivos sin conexion crean la misma cuenta y la sync las fusiona
// sin duplicados.

// Id fijo de la cuenta de sistema para un metodo+moneda.
export function systemAccountId(method, currency) {
  return `acc_${method === 'transfer' ? 'transfer' : 'cash'}_${String(currency || 'MN').toLowerCase()}`
}

export function systemAccountName(method, currency) {
  return method === 'transfer' ? `Transferencias ${currency}` : `Efectivo ${currency}`
}

// Crea (si falta) la cuenta de sistema de un metodo+moneda. Pensada para
// llamarse DENTRO de una transaccion que incluya db.accounts.
export async function ensureSystemAccount(method, currency) {
  const id = systemAccountId(method, currency)
  const existing = await db.accounts.get(id)
  if (!existing) {
    const ts = now()
    await db.accounts.add({
      id,
      name: systemAccountName(method, currency),
      currency,
      system: true,
      active: true,
      createdAt: ts,
      updatedAt: ts
    })
  }
  return id
}

// Movimiento crudo (para usar dentro de transacciones de venta/extraccion).
export async function addAccountMovementRaw({
  accountId,
  direction, // 'credit' (entra dinero) | 'debit' (sale dinero)
  amount,
  currency,
  refType = '',
  refId = null,
  // Concepto del movimiento (Opcion B): de que actividad vino/salio el dinero.
  // 'own' | 'consignment' | 'thirdparty' | 'provider' | 'withdrawal' | 'manual'
  concept = '',
  note = '',
  userId = null,
  createdAt = null
}) {
  const amt = round2(Number(amount) || 0)
  if (amt <= 0) return null
  const id = newId()
  await db.accountMovements.add({
    id,
    accountId,
    direction,
    amount: amt,
    currency,
    refType,
    refId,
    concept,
    note,
    userId,
    createdAt: createdAt || now()
  })
  return id
}

// Etiquetas de concepto de ingreso/egreso (Opcion B).
export const ACCOUNT_CONCEPTS = {
  own: 'Ventas propias',
  consignment: 'Ventas en consignación',
  thirdparty: 'Cobros a terceros',
  provider: 'Pagos a proveedores',
  withdrawal: 'Extracciones de caja',
  manual: 'Ajustes manuales'
}

export const accountsRepo = {
  // Cuentas base del negocio (se crean si faltan; idempotente y sin duplicar
  // entre dispositivos gracias a los ids fijos).
  async ensureDefaults() {
    await db.transaction('rw', db.accounts, async () => {
      await ensureSystemAccount('cash', 'MN')
      await ensureSystemAccount('transfer', 'MN')
      await ensureSystemAccount('cash', 'USD')
      await ensureSystemAccount('transfer', 'MLC')
    })
  },

  async list() {
    const all = await db.accounts.toArray()
    return all
      .filter((a) => a.active)
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async get(id) {
    return db.accounts.get(id)
  },

  // Cuenta nueva definida por el dueño (ademas de las de sistema).
  async create({ name, currency = 'MN' }) {
    const clean = String(name || '').trim()
    if (!clean) throw new Error('El nombre es obligatorio')
    const id = newId()
    const ts = now()
    await db.accounts.add({
      id,
      name: clean,
      currency,
      system: false,
      active: true,
      createdAt: ts,
      updatedAt: ts
    })
    return id
  },

  async movements(accountId) {
    const rows = await db.accountMovements.where('accountId').equals(accountId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async allMovements() {
    const rows = await db.accountMovements.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Saldos de todas las cuentas de una vez: { accountId: saldo } (creditos -
  // debitos, en la moneda de cada cuenta).
  async balances() {
    const rows = await db.accountMovements.toArray()
    const map = {}
    for (const m of rows) {
      const sign = m.direction === 'debit' ? -1 : 1
      map[m.accountId] = round2((map[m.accountId] || 0) + sign * Number(m.amount || 0))
    }
    return map
  },

  // Opcion B: ingresos y egresos agrupados por CONCEPTO (de que actividad vino
  // o salio el dinero), sumado en moneda base MN. Devuelve { credits, debits }
  // como { concepto: monto }. `movs` opcional (para no releer si ya se tienen).
  async byConcept({ from = null, to = null, movs = null } = {}) {
    const rows = movs || (await db.accountMovements.toArray())
    const inRange = (iso) => {
      const d = (iso || '').slice(0, 10)
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    }
    const credits = {}
    const debits = {}
    for (const m of rows) {
      if (!inRange(m.createdAt)) continue
      const c = m.concept || 'own'
      const bag = m.direction === 'debit' ? debits : credits
      bag[c] = round2((bag[c] || 0) + Number(m.amount || 0))
    }
    return { credits, debits }
  },

  // Ajuste manual del dueño/administrativo (correccion append-only con nota).
  async addManual({ accountId, direction, amount, note = '', userId = null }) {
    const acc = await db.accounts.get(accountId)
    if (!acc) throw new Error('Cuenta no encontrada')
    if (direction !== 'credit' && direction !== 'debit') throw new Error('Tipo no valido')
    const amt = round2(Number(amount) || 0)
    if (amt <= 0) throw new Error('El monto debe ser mayor que cero')
    return addAccountMovementRaw({
      accountId,
      direction,
      amount: amt,
      currency: acc.currency,
      refType: 'manual',
      concept: 'manual',
      note: String(note || '').trim(),
      userId
    })
  }
}
