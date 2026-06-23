import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { buildSearchTokens } from '../lib/search'
import { stockRepo } from './stockRepo'
import { MOVEMENT_TYPES } from '../db/constants'

// Catalogo de productos. El stock no se edita aqui directamente: cambia via
// movimientos (entradas, ventas, ajustes) para mantener el libro mayor coherente.
export const productsRepo = {
  async list() {
    return db.products.toArray()
  },

  async listActive() {
    const all = await db.products.toArray()
    return all.filter((p) => p.active)
  },

  async get(id) {
    return db.products.get(id)
  },

  async getByCode(code) {
    const c = (code || '').trim()
    if (!c) return undefined
    return db.products.where('code').equals(c).first()
  },

  // Crea producto. Si openingStock > 0, registra el movimiento de apertura
  // (queda trazado en el libro mayor, nunca se inyecta el stock "a mano").
  async create({ code, name, categoryId, unit, price, cost, minStock = 0, openingStock = 0, userId = null }) {
    const id = newId()
    const ts = now()
    await db.products.add({
      id,
      code: (code || '').trim(),
      name: name.trim(),
      searchTokens: buildSearchTokens(name, code),
      categoryId: categoryId || null,
      unit,
      price: Number(price) || 0,
      cost: Number(cost) || 0,
      stock: 0,
      minStock: Number(minStock) || 0,
      active: true,
      createdAt: ts,
      updatedAt: ts
    })
    if (Number(openingStock) > 0) {
      await stockRepo.record({
        productId: id,
        qty: Number(openingStock),
        type: MOVEMENT_TYPES.ADJUSTMENT,
        note: 'Existencia inicial',
        userId
      })
    }
    return id
  },

  // Edita datos del producto (no el stock). Recalcula tokens si cambia nombre/codigo.
  async update(id, fields) {
    const patch = { ...fields, updatedAt: now() }
    delete patch.stock // el stock solo cambia via stockRepo
    if (fields.name != null || fields.code != null) {
      const current = await db.products.get(id)
      patch.searchTokens = buildSearchTokens(
        fields.name ?? current?.name,
        fields.code ?? current?.code
      )
    }
    if (fields.price != null) patch.price = Number(fields.price) || 0
    if (fields.cost != null) patch.cost = Number(fields.cost) || 0
    await db.products.update(id, patch)
  },

  async setActive(id, active) {
    await db.products.update(id, { active, updatedAt: now() })
  },

  // Cambia el precio de venta y deja el cambio en el historial (priceChanges).
  // Las ventas ya registradas conservan su precio congelado: NO se tocan.
  // Devuelve true si hubo cambio real.
  async changePrice(id, newPrice, { userId = null, shiftId = null, note = '' } = {}) {
    const np = round2(Number(newPrice) || 0)
    let changed = false
    await db.transaction('rw', db.products, db.priceChanges, async () => {
      const p = await db.products.get(id)
      if (!p) return
      if (round2(p.price) === np) return
      await db.priceChanges.add({
        id: newId(),
        productId: id,
        oldPrice: p.price,
        newPrice: np,
        userId,
        shiftId,
        note,
        createdAt: now()
      })
      await db.products.update(id, { price: np, updatedAt: now() })
      changed = true
    })
    return changed
  },

  async priceHistory(id) {
    const rows = await db.priceChanges.where('productId').equals(id).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
