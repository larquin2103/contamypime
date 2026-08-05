import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { cleanQty } from '../lib/qty'
import { MOVEMENT_TYPES, WAREHOUSE, locationLabel } from '../db/constants'

// Mermas: rebaja de inventario por deterioro/perdida. NO es una venta (no entra
// dinero): solo baja la existencia y deja constancia de la afectacion al COSTO.
//
// Como todo en el proyecto:
//  - APPEND-ONLY: cada merma es un registro nuevo (nunca se edita/borra) mas su
//    movimiento en el libro mayor (MERMA_OUT) que rebaja la existencia real.
//  - SNAPSHOT: se congela el precio de venta y el costo AL MOMENTO de la merma
//    (pueden cambiar despues); asi el reporte de afectacion es fiel al valor de
//    la mercancia perdida, igual que la venta congela su precio por linea.
//  - POR UBICACION: sale de la ubicacion elegida (almacen central o un area),
//    validando que haya existencia suficiente en ella.
export const mermasRepo = {
  async create({ productId, qty, location = WAREHOUSE, reason = '', userId = null }) {
    const q = Math.abs(Number(qty))
    if (!(q > 0)) throw new Error('Cantidad no valida')
    const loc = String(location || WAREHOUSE)
    const id = newId()
    const ts = now()
    await db.transaction('rw', db.mermas, db.stockMovements, db.products, async () => {
      const p = await db.products.get(productId)
      if (!p) throw new Error('Producto no encontrado')
      const avail = Number(p.stockByLocation?.[loc] ?? (loc === WAREHOUSE ? p.stock : 0) ?? 0)
      if (q > avail) {
        throw new Error(`Solo hay ${avail} ${p.unit} de ${p.name} en ${locationLabel(loc)}`)
      }
      const salePrice = Number(p.price) || 0
      const unitCost = Number(p.cost) || 0
      // Snapshot para el reporte de afectacion (append-only).
      await db.mermas.add({
        id,
        productId,
        name: p.name, // el nombre del reporte no cambia despues
        unit: p.unit,
        location: loc,
        qty: q,
        salePrice, // precio al que estaba a la venta (valor no realizable)
        unitCost, // costo unitario (afectacion real al dueño)
        costTotal: round2(q * unitCost), // importe del costo = perdida
        saleTotal: round2(q * salePrice), // precio de venta que se deja de cobrar
        reason: String(reason || '').trim(),
        userId,
        createdAt: ts,
        updatedAt: ts
      })
      // Libro mayor: salida negativa en la ubicacion (deriva el stock real).
      await db.stockMovements.add({
        id: newId(),
        productId,
        qty: -q,
        type: MOVEMENT_TYPES.MERMA_OUT,
        refType: 'merma',
        refId: id,
        unitCost,
        userId,
        note: String(reason || '').trim() || 'Merma',
        location: loc,
        createdAt: ts
      })
      // Cache por ubicacion (se actualiza en la misma transaccion).
      const byLoc = { ...(p.stockByLocation || {}) }
      byLoc[loc] = cleanQty(Number(byLoc[loc] || 0) - q)
      await db.products.update(productId, {
        stock: cleanQty(Number(p.stock || 0) - q),
        stockByLocation: byLoc,
        updatedAt: ts
      })
    })
    return id
  },

  async listAll() {
    const rows = await db.mermas.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
