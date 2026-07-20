import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { MOVEMENT_TYPES, PARTNER_MOVEMENT_TYPES, PARTNER_TYPES, WAREHOUSE } from '../db/constants'

// Terceros del negocio (Bloque C, modulo 'cuentas'): proveedores que dejan
// mercancia en consignacion y acreedores/terceros a los que se les entrega
// mercancia. El libro de movimientos es append-only y el SALDO se deriva de
// los movimientos (nunca se guarda), igual que el stock del libro mayor.
//
// Convenio de saldo (siempre positivo = hay deuda viva):
//  - PROVEEDOR: saldo = consignment_due - payment_out  -> cuanto LE DEBEMOS.
//  - TERCERO:   saldo = goods_out - payment_in         -> cuanto NOS DEBE.
export const partnersRepo = {
  async list() {
    const all = await db.partners.toArray()
    return all.sort((a, b) => a.name.localeCompare(b.name))
  },

  async listActive(type = null) {
    const all = await this.list()
    return all.filter((p) => p.active && (type ? p.type === type : true))
  },

  async get(id) {
    return db.partners.get(id)
  },

  async create({ name, type, phone = '', note = '' }) {
    const clean = String(name || '').trim()
    if (!clean) throw new Error('El nombre es obligatorio')
    if (!Object.values(PARTNER_TYPES).includes(type)) throw new Error('Tipo de tercero no valido')
    const id = newId()
    const ts = now()
    await db.partners.add({
      id,
      name: clean,
      type,
      phone: String(phone || '').trim(),
      note: String(note || '').trim(),
      active: true,
      createdAt: ts,
      updatedAt: ts
    })
    return id
  },

  async update(id, fields) {
    const patch = { updatedAt: now() }
    if (fields.name != null) patch.name = String(fields.name).trim()
    if (fields.phone != null) patch.phone = String(fields.phone).trim()
    if (fields.note != null) patch.note = String(fields.note).trim()
    if (fields.active != null) patch.active = !!fields.active
    await db.partners.update(id, patch)
  },

  async movements(partnerId) {
    const rows = await db.partnerMovements.where('partnerId').equals(partnerId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async allMovements() {
    const rows = await db.partnerMovements.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Signo de un movimiento sobre el saldo (deuda viva).
  _sign(type) {
    return type === PARTNER_MOVEMENT_TYPES.PAYMENT_OUT || type === PARTNER_MOVEMENT_TYPES.PAYMENT_IN
      ? -1
      : 1
  },

  // Saldo de todos los terceros de una vez: { partnerId: saldo }.
  async balances() {
    const rows = await db.partnerMovements.toArray()
    const map = {}
    for (const m of rows) {
      map[m.partnerId] = round2((map[m.partnerId] || 0) + this._sign(m.type) * Number(m.amount || 0))
    }
    return map
  },

  async balance(partnerId) {
    const rows = await db.partnerMovements.where('partnerId').equals(partnerId).toArray()
    return round2(rows.reduce((a, m) => a + this._sign(m.type) * Number(m.amount || 0), 0))
  },

  // Pago a un proveedor o cobro a un tercero (rebaja la deuda viva). El
  // enganche con la cuenta de tesoreria (accountId) llega en el Bloque D.
  async addPayment({ partnerId, type, amount, note = '', userId = null, accountId = null }) {
    if (type !== PARTNER_MOVEMENT_TYPES.PAYMENT_OUT && type !== PARTNER_MOVEMENT_TYPES.PAYMENT_IN) {
      throw new Error('Tipo de pago no valido')
    }
    const amt = round2(Number(amount) || 0)
    if (amt <= 0) throw new Error('El monto debe ser mayor que cero')
    const id = newId()
    await db.partnerMovements.add({
      id,
      partnerId,
      type,
      amount: amt,
      currency: 'MN',
      refType: 'payment',
      refId: null,
      accountId,
      note: String(note || '').trim(),
      userId,
      createdAt: now()
    })
    return id
  },

  // Entrega de mercancia del ALMACEN a un tercero (acreedor): rebaja el stock
  // del almacen (libro mayor, PARTNER_OUT) y deja la deuda del tercero en un
  // solo movimiento de cuenta. Todo en una transaccion (valida y atomica).
  async deliverGoods({ partnerId, items, note = '', userId = null }) {
    const lines = (items || [])
      .map((it) => ({
        productId: it.productId,
        name: it.name,
        unit: it.unit,
        qty: Number(it.qty) || 0,
        unitValue: round2(Number(it.unitValue) || 0)
      }))
      .filter((it) => it.qty > 0)
    if (!lines.length) throw new Error('No hay productos que entregar')

    const movementId = newId()
    const ts = now()
    const total = round2(lines.reduce((a, it) => a + it.qty * it.unitValue, 0))

    await db.transaction('rw', db.partnerMovements, db.stockMovements, db.products, async () => {
      // Validacion de existencia en el almacen ANTES de rebajar nada.
      for (const it of lines) {
        const p = await db.products.get(it.productId)
        const avail = Number(p?.stockByLocation?.[WAREHOUSE] ?? p?.stock ?? 0)
        if (avail < it.qty) {
          throw new Error(`No hay existencia en el almacén de ${it.name} (hay ${avail}, pides ${it.qty})`)
        }
      }
      for (const it of lines) {
        await db.stockMovements.add({
          id: newId(),
          productId: it.productId,
          qty: -it.qty,
          type: MOVEMENT_TYPES.PARTNER_OUT,
          refType: 'partnerMovement',
          refId: movementId,
          unitCost: null,
          shiftId: null,
          userId,
          note: `Entrega a tercero`,
          location: WAREHOUSE,
          createdAt: ts
        })
        const p = await db.products.get(it.productId)
        const byLoc = { ...(p.stockByLocation || {}) }
        byLoc[WAREHOUSE] = Number(byLoc[WAREHOUSE] || 0) - it.qty
        await db.products.update(it.productId, {
          stock: Number(p.stock || 0) - it.qty,
          stockByLocation: byLoc,
          updatedAt: ts
        })
      }
      await db.partnerMovements.add({
        id: movementId,
        partnerId,
        type: PARTNER_MOVEMENT_TYPES.GOODS_OUT,
        amount: total,
        currency: 'MN',
        refType: 'delivery',
        refId: null,
        items: lines, // snapshot de lo entregado (producto, cantidad, valor)
        note: String(note || '').trim(),
        userId,
        createdAt: ts
      })
    })
    return movementId
  }
}
