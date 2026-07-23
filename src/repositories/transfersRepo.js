import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { MOVEMENT_TYPES, WAREHOUSE, locationLabel } from '../db/constants'

// Traspasos entre ubicaciones (Bloque 20 + módulo elaboración). Es un traspaso
// append-only: cada producto genera un TRANSFER_OUT en el origen (-cant) y un
// TRANSFER_IN en el destino (+cant). El total del producto no cambia; solo se
// mueve entre ubicaciones. Valida que el origen tenga existencia suficiente.
export const transfersRepo = {
  // Traspaso general de UNA ubicacion a OTRA. El clasico "almacen -> area" es un
  // caso particular (ver create). Con el modulo de elaboracion se usa tambien
  // para almacen -> elaboracion y elaboracion -> area.
  // items: [{ productId, name, unit, qty }]
  async move({ fromLocation = WAREHOUSE, toLocation, items, byUserId, note = '' }) {
    const from = String(fromLocation || WAREHOUSE)
    const to = String(toLocation || '').trim()
    if (!to) throw new Error('Indica la ubicación de destino')
    if (from === to) throw new Error('El origen y el destino deben ser distintos')
    const clean = (items || [])
      .map((it) => ({ ...it, qty: Math.abs(Number(it.qty) || 0) }))
      .filter((it) => it.productId && it.qty > 0)
    if (!clean.length) throw new Error('Agrega al menos un producto con cantidad')

    const id = newId()
    const ts = now()
    await db.transaction('rw', db.transfers, db.stockMovements, db.products, async () => {
      // Validación previa: el ORIGEN debe tener existencia suficiente de cada
      // producto (no se puede sacar lo que no hay). Aborta toda la transacción.
      for (const it of clean) {
        const p = await db.products.get(it.productId)
        const avail = Number(p?.stockByLocation?.[from] ?? (from === WAREHOUSE ? p?.stock : 0) ?? 0)
        if (it.qty > avail) {
          throw new Error(`No hay suficiente "${it.name || 'producto'}" en ${locationLabel(from)} (disponible ${avail})`)
        }
      }

      await db.transfers.add({
        id,
        fromLocation: from,
        toArea: to, // se conserva el nombre `toArea` (compat. con byArea y reportes)
        items: clean.map((it) => ({
          productId: it.productId,
          name: it.name || '',
          unit: it.unit || '',
          qty: it.qty
        })),
        byUserId,
        note: String(note || '').trim(),
        createdAt: ts
      })

      for (const it of clean) {
        // Salida del origen.
        await db.stockMovements.add({
          id: newId(),
          productId: it.productId,
          qty: -it.qty,
          type: MOVEMENT_TYPES.TRANSFER_OUT,
          refType: 'transfer',
          refId: id,
          userId: byUserId,
          note: '',
          location: from,
          createdAt: ts
        })
        // Entrada al destino.
        await db.stockMovements.add({
          id: newId(),
          productId: it.productId,
          qty: it.qty,
          type: MOVEMENT_TYPES.TRANSFER_IN,
          refType: 'transfer',
          refId: id,
          userId: byUserId,
          note: '',
          location: to,
          createdAt: ts
        })
        // Caché por ubicación: el total no cambia, solo se mueve origen -> destino.
        const p = await db.products.get(it.productId)
        if (p) {
          const byLoc = { ...(p.stockByLocation || {}) }
          byLoc[from] = round2(Number(byLoc[from] || 0) - it.qty)
          byLoc[to] = round2(Number(byLoc[to] || 0) + it.qty)
          await db.products.update(it.productId, { stockByLocation: byLoc, updatedAt: ts })
        }
      }
    })
    return id
  },

  // Salida del ALMACEN central hacia un AREA (Bloque 20). Envoltura del traspaso
  // general con origen = almacén: comportamiento idéntico al de producción.
  async create({ toArea, items, byUserId, note = '' }) {
    const area = String(toArea || '').trim()
    if (!area) throw new Error('Indica el área de destino')
    return this.move({ fromLocation: WAREHOUSE, toLocation: area, items, byUserId, note })
  },

  async listAll() {
    const rows = await db.transfers.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async byArea(area) {
    const rows = await db.transfers.where('toArea').equals(area).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
