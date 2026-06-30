import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { evalSemaphore } from '../lib/semaphore'
import { COUNT_STATUS, WAREHOUSE } from '../db/constants'
import { configRepo } from './configRepo'
import { stockRepo } from './stockRepo'

// Existencia de un producto en una ubicacion, con respaldo al total cuando es
// el almacen y aun no hay cache por ubicacion (productos previos a la v5).
function stockAtLocation(p, location) {
  const byLoc = p.stockByLocation
  if (byLoc && byLoc[location] != null) return Number(byLoc[location])
  return location === WAREHOUSE ? Number(p.stock || 0) : 0
}

// Conteo fisico interactivo (Fase 3). Snapshot del stock del sistema vs lo
// contado fisicamente; al aprobar, las diferencias se aplican como ajustes
// trazados en el libro mayor (nada se borra).
export const countsRepo = {
  // Borrador en curso. Con areas, cada vendedor cuenta SU area; por eso el
  // borrador se aisla por usuario (si se pasa userId). Asi un vendedor nunca ve
  // el borrador del almacen del dueño ni el de otra area/vendedor.
  async getDraft(userId = null) {
    const rows = await db.counts.where('status').equals(COUNT_STATUS.DRAFT).toArray()
    const mine = userId ? rows.filter((r) => r.createdBy === userId) : rows
    return mine.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] || null
  },

  // Conteo enviado a aprobacion. El dueño/administrativo revisan CUALQUIERA
  // (cola de supervision); un vendedor solo consulta el SUYO (para saber si ya
  // se lo aprobaron), pasando su userId.
  async getPending(userId = null) {
    const rows = await db.counts.where('status').equals(COUNT_STATUS.PENDING).toArray()
    const mine = userId ? rows.filter((r) => r.createdBy === userId) : rows
    return mine.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] || null
  },

  async get(id) {
    return db.counts.get(id)
  },

  async listAll() {
    const rows = await db.counts.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Ultimo conteo de un usuario ya resuelto (aprobado/rechazado), para avisarle.
  async latestResolvedFor(userId) {
    const rows = await db.counts.toArray()
    return (
      rows
        .filter(
          (c) =>
            c.createdBy === userId &&
            (c.status === COUNT_STATUS.APPROVED || c.status === COUNT_STATUS.REJECTED)
        )
        .sort((a, b) => ((a.approvedAt || '') < (b.approvedAt || '') ? 1 : -1))[0] || null
    )
  },

  // Inicia un conteo de UNA ubicacion (almacen o un area): toma una foto del
  // stock de esa ubicacion para cada producto que tiene existencia ahi.
  async startDraft(userId, location = WAREHOUSE) {
    const products = await db.products.toArray()
    const items = products
      .filter((p) => p.active && stockAtLocation(p, location) > 0)
      .map((p) => ({
        productId: p.id,
        name: p.name,
        unit: p.unit,
        categoryId: p.categoryId || null,
        systemStock: stockAtLocation(p, location),
        physicalQty: null,
        note: ''
      }))
    const existing = await this.getDraft(userId)
    if (existing) {
      // Mismo destino: se retoma el borrador en curso.
      if ((existing.location || WAREHOUSE) === location) return existing.id
      // Borrador de OTRA ubicacion (obsoleto: p.ej. del almacen creado antes de
      // tener area): se reconvierte a la ubicacion actual con su foto de stock.
      // No se borra (delete prohibido en la nube): misma fila, nuevo snapshot.
      await db.counts.update(existing.id, { location, items, note: '', updatedAt: now() })
      return existing.id
    }
    const id = newId()
    await db.counts.add({
      id,
      status: COUNT_STATUS.DRAFT,
      location,
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

  // Aprueba: ajusta el stock de la UBICACION contada para que coincida con lo
  // contado fisicamente. El ajuste se calcula contra la existencia ACTUAL de esa
  // ubicacion (no contra la foto), para no pisar ventas/salidas posteriores.
  async approve(id, ownerId) {
    const c = await db.counts.get(id)
    if (!c || c.status !== COUNT_STATUS.PENDING) return
    const loc = c.location || WAREHOUSE
    const locNote = loc === WAREHOUSE ? 'almacén' : loc
    for (const it of c.items) {
      if (!it.counted) continue
      const p = await db.products.get(it.productId)
      if (!p) continue
      const delta = round2(Number(it.physicalQty) - stockAtLocation(p, loc))
      if (delta !== 0) {
        await stockRepo.adjust({
          productId: it.productId,
          delta,
          note: `Ajuste por conteo físico (${locNote})`,
          userId: ownerId,
          location: loc
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
