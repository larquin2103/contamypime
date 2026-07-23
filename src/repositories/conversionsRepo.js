import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { MOVEMENT_TYPES, WAREHOUSE } from '../db/constants'

// Conversion de productos en el ALMACEN central (modulo mayorista). Se CONSUME un
// producto (ej. un saco de azucar) y se da de alta OTRO con su propio codigo (ej.
// jabas fraccionadas). Es append-only y atomica: genera un CONVERSION_OUT (-) en
// el origen y un CONVERSION_IN (+) en el destino, ambos en el almacen. El stock
// de cada producto se deriva de la suma del libro mayor (como siempre), asi que
// no toca la logica de stock existente.
//
// Costo: el VALOR consumido del origen (cantidad x costo) se traslada al destino
// por PROMEDIO PONDERADO con su existencia previa, para que la ganancia siga
// saliendo correcta en los reportes. El precio de venta del destino no se toca
// (lo fija el dueño en el catalogo).
export const conversionsRepo = {
  async create({ fromProductId, toProductId, fromQty, toQty, byUserId, note = '' }) {
    const fq = Math.abs(Number(fromQty) || 0)
    const tq = Math.abs(Number(toQty) || 0)
    if (!fromProductId || !toProductId) throw new Error('Elige el producto de origen y el de destino')
    if (fromProductId === toProductId) throw new Error('El origen y el destino deben ser productos distintos')
    if (fq <= 0 || tq <= 0) throw new Error('Indica las cantidades de origen y destino (mayores que 0)')

    const loc = WAREHOUSE
    const id = newId()
    const ts = now()
    let result = null

    await db.transaction('rw', db.conversions, db.stockMovements, db.products, async () => {
      const from = await db.products.get(fromProductId)
      const to = await db.products.get(toProductId)
      if (!from) throw new Error('El producto de origen no existe')
      if (!to) throw new Error('El producto de destino no existe')

      // Existencia del origen en el almacen (lo que no hay no se puede convertir).
      const availFrom = from.stockByLocation?.[loc] != null
        ? Number(from.stockByLocation[loc])
        : Number(from.stock || 0)
      if (fq > availFrom) {
        throw new Error(`No hay suficiente "${from.name}" en el almacén (disponible ${availFrom})`)
      }

      // Costo: valor consumido del origen -> costo del destino (promedio ponderado).
      const fromCost = Number(from.cost || 0)
      const movedValue = round2(fq * fromCost)
      const unitCostTo = round2(movedValue / tq)
      const prevQtyTo = Number(to.stock || 0)
      const prevCostTo = Number(to.cost || 0)
      const newQtyTo = round2(prevQtyTo + tq)
      const newCostTo = newQtyTo > 0
        ? round2((prevQtyTo * prevCostTo + movedValue) / newQtyTo)
        : prevCostTo

      // Salida del origen (-) en el almacen.
      await db.stockMovements.add({
        id: newId(), productId: fromProductId, qty: -fq,
        type: MOVEMENT_TYPES.CONVERSION_OUT, refType: 'conversion', refId: id,
        unitCost: fromCost, shiftId: null, userId: byUserId, note: '',
        location: loc, createdAt: ts
      })
      // Entrada del destino (+) en el almacen.
      await db.stockMovements.add({
        id: newId(), productId: toProductId, qty: tq,
        type: MOVEMENT_TYPES.CONVERSION_IN, refType: 'conversion', refId: id,
        unitCost: unitCostTo, shiftId: null, userId: byUserId, note: '',
        location: loc, createdAt: ts
      })

      // Caches de stock (mismo patron que stockRepo.record): total + por ubicacion.
      const fromByLoc = { ...(from.stockByLocation || {}) }
      fromByLoc[loc] = round2(Number(fromByLoc[loc] || 0) - fq)
      await db.products.update(fromProductId, {
        stock: round2(Number(from.stock || 0) - fq),
        stockByLocation: fromByLoc,
        updatedAt: ts
      })
      const toByLoc = { ...(to.stockByLocation || {}) }
      toByLoc[loc] = round2(Number(toByLoc[loc] || 0) + tq)
      await db.products.update(toProductId, {
        stock: newQtyTo,
        stockByLocation: toByLoc,
        cost: newCostTo,
        updatedAt: ts
      })

      // Registro append-only de la conversion (para trazabilidad e informes).
      await db.conversions.add({
        id,
        fromProductId, toProductId,
        fromName: from.name, toName: to.name,
        fromUnit: from.unit, toUnit: to.unit,
        fromQty: fq, toQty: tq,
        unitCostFrom: fromCost, unitCostTo,
        location: loc,
        byUserId,
        note: String(note || '').trim(),
        createdAt: ts
      })

      result = { id, unitCostTo, newCostTo, movedValue }
    })

    return result
  },

  async listAll() {
    const rows = await db.conversions.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
