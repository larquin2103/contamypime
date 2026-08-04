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
  createdAt = null,
  // Id opcional. Por defecto aleatorio (comportamiento de siempre para ventas y
  // extracciones). El backfill lo pasa DETERMINISTA para que, si dos dispositivos
  // lo corren antes de sincronizar, generen el MISMO doc y la sync no duplique.
  id = null
}) {
  const amt = round2(Number(amount) || 0)
  if (amt <= 0) return null
  const movId = id || newId()
  await db.accountMovements.add({
    id: movId,
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
  return movId
}

// Acredita a la tesoreria el INGRESO de UNA venta (efectivo/transferencia/mixto
// + vuelto), leyendo del registro de venta ya guardado. Reproduce EXACTO la
// misma logica que salesRepo.create usa cuando creditAccounts=true, para que el
// backfill (regularizacion) de las ventas de mesa quede idendico a lo que se
// habria acreditado en su momento. Fecha el movimiento con la fecha ORIGINAL de
// la venta (createdAt) para que caiga en su periodo. Concepto 'own': la venta no
// guarda si fue consignacion (solo afecta la etiqueta del reporte, no el importe).
// Pensada para llamarse DENTRO de una transaccion con db.accounts + db.accountMovements.
async function creditSaleToTreasury(s, { userId = null } = {}) {
  const concept = 'own'
  // Id DETERMINISTA por "pierna" del cobro (bf:<venta>:<n>): si dos dispositivos
  // corren el backfill antes de sincronizar, generan el MISMO doc -> la sync los
  // fusiona (LWW), sin duplicar el ingreso. El orden de las move() es fijo para
  // una misma venta, asi que la numeracion coincide en todos los dispositivos.
  let leg = 0
  const move = async (method, currency, amount, direction = 'credit') => {
    const amt = Number(amount) || 0
    if (amt <= 0) return
    const accId = await ensureSystemAccount(method, currency || 'MN')
    await addAccountMovementRaw({
      id: `bf:${s.id}:${leg++}`,
      accountId: accId,
      direction,
      amount: amt,
      currency: currency || 'MN',
      refType: 'sale',
      refId: s.id,
      concept,
      userId,
      createdAt: s.createdAt
    })
  }
  const chg = round2(Number(s.change) || 0)
  const chgCur = s.changeCurrency || s.paymentCurrency
  if (Array.isArray(s.payments) && s.payments.length) {
    for (const p of s.payments) await move(p.method, p.currency, p.amount, 'credit')
    if (chg > 0) await move('cash', chgCur || 'MN', chg, 'debit') // vuelto por sobrepago
  } else if (s.paymentMethod === 'cash') {
    if (!chgCur || chgCur === s.paymentCurrency) {
      await move('cash', s.paymentCurrency, s.cashAmount, 'credit') // neto
    } else {
      await move('cash', s.paymentCurrency, s.amountPaid, 'credit') // bruto
      await move('cash', chgCur, chg, 'debit') // vuelto en otra moneda
    }
  } else {
    await move('transfer', s.transferCurrency, s.transferAmount, 'credit')
  }
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

  // Cuantos cobros de MESA cobrados NO tienen su ingreso en tesoreria (bug
  // corregido: antes las ventas de mesa no acreditaban las cuentas). Se
  // identifican por tener `orderId`; se consideran pendientes si no existe ya un
  // movimiento de cuenta con su refId (idempotencia).
  async pendingMesaIncomeCount() {
    const sales = await db.sales.toArray()
    const mesa = sales.filter((s) => !s.voided && s.orderId)
    if (!mesa.length) return 0
    const done = new Set((await db.accountMovements.toArray()).map((m) => m.refId))
    return mesa.filter((s) => !done.has(s.id)).length
  },

  // Regulariza (backfill) el INGRESO a tesoreria de las ventas de MESA cobradas
  // ANTES del fix. IDEMPOTENTE: solo acredita una venta de mesa que NO tenga ya
  // su movimiento (por refId), asi que correrlo dos veces no duplica. Reproduce
  // exacto la logica de salesRepo y fecha cada movimiento con la fecha original
  // de su venta. Solo debe ofrecerse con el modulo 'cuentas' activo (lo gatea la
  // pantalla). Devuelve { scanned, credited, skipped }.
  async backfillMesaSaleIncome({ userId = null } = {}) {
    const result = { scanned: 0, credited: 0, skipped: 0 }
    await db.transaction('rw', db.sales, db.accounts, db.accountMovements, async () => {
      const sales = await db.sales.toArray()
      const mesa = sales.filter((s) => !s.voided && s.orderId)
      result.scanned = mesa.length
      const done = new Set((await db.accountMovements.toArray()).map((m) => m.refId))
      for (const s of mesa) {
        if (done.has(s.id)) { result.skipped++; continue }
        await creditSaleToTreasury(s, { userId })
        result.credited++
      }
    })
    return result
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
