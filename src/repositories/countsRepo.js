import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { evalSemaphore } from '../lib/semaphore'
import { COUNT_STATUS } from '../db/constants'
import { configRepo } from './configRepo'
import { stockRepo } from './stockRepo'

// Conteo fisico interactivo (Fase 3). Snapshot del stock del sistema vs lo
// contado fisicamente; al aprobar, las diferencias se aplican como ajustes
// trazados en el libro mayor (nada se borra).
export const countsRepo = {
  async getDraft() {
    const rows = await db.counts.where('status').equals(COUNT_STATUS.DRAFT).toArray()
    return rows[0] || null
  },

  async getPending() {
    const rows = await db.counts.where('status').equals(COUNT_STATUS.PENDING).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] || null
  },

  async get(id) {
    return db.counts.get(id)
  },

  async listAll() {
    const rows = await db.counts.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Inicia un conteo: toma una foto del stock actual de cada producto activo.
  async startDraft(userId) {
    const existing = await this.getDraft()
    if (existing) return existing.id
    const products = await db.products.toArray()
    const items = products
      .filter((p) => p.active && Number(p.stock || 0) > 0)
      .map((p) => ({
        productId: p.id,
        name: p.name,
        unit: p.unit,
        categoryId: p.categoryId || null,
        systemStock: Number(p.stock || 0),
        physicalQty: null,
        note: ''
      }))
    const id = newId()
    await db.counts.add({
      id,
      status: COUNT_STATUS.DRAFT,
      createdBy: userId,
      createdAt: now(),
      items,
      note: ''
    })
    return id
  },

  async saveItems(id, items) {
    await db.counts.update(id, { items, updatedAt: now() })
  },

  // Envia el conteo a aprobacion: calcula diferencia y semaforo por producto.
  async submit(id) {
    const c = await db.counts.get(id)
    if (!c) return
    const cfg = await configRepo.getSemaphoreConfig()
    const items = c.items.map((it) => {
      const counted = it.physicalQty !== null && it.physicalQty !== ''
      if (!counted) return { ...it, counted: false, diff: 0, semaphore: null }
      const phys = Number(it.physicalQty)
      const diff = round2(phys - it.systemStock)
      const sem = evalSemaphore(it.systemStock, phys, cfg)
      return { ...it, physicalQty: phys, counted: true, diff, semaphore: sem.color }
    })
    await db.counts.update(id, { items, status: COUNT_STATUS.PENDING, submittedAt: now() })
  },

  // Aprueba: ajusta el stock para que coincida con lo contado fisicamente.
  async approve(id, ownerId) {
    const c = await db.counts.get(id)
    if (!c || c.status !== COUNT_STATUS.PENDING) return
    for (const it of c.items) {
      if (!it.counted) continue
      const p = await db.products.get(it.productId)
      if (!p) continue
      const delta = round2(Number(it.physicalQty) - Number(p.stock || 0))
      if (delta !== 0) {
        await stockRepo.adjust({
          productId: it.productId,
          delta,
          note: 'Ajuste por conteo fisico',
          userId: ownerId
        })
      }
    }
    await db.counts.update(id, {
      status: COUNT_STATUS.APPROVED,
      approvedBy: ownerId,
      approvedAt: now()
    })
  },

  async reject(id, ownerId, reason = '') {
    await db.counts.update(id, {
      status: COUNT_STATUS.REJECTED,
      approvedBy: ownerId,
      approvedAt: now(),
      rejectReason: reason
    })
  }
}
