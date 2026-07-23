import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { MOVEMENT_TYPES, WAREHOUSE } from '../db/constants'

// Conversion de productos en una ubicacion (almacen central -> mayorista; o el
// centro de elaboracion). Se CONSUMEN uno o VARIOS insumos (una receta: pan +
// carne + condimentos...) y se da de alta OTRO producto con su propio codigo (ej.
// hamburguesas). Es append-only y atomica: genera un CONVERSION_OUT (-) por cada
// insumo y un CONVERSION_IN (+) del producto resultante, todos en esa ubicacion.
// El stock de cada producto se deriva de la suma del libro mayor (como siempre),
// asi que no toca la logica de stock existente.
//
// Costo: el VALOR consumido (suma de cantidad x costo de cada insumo) se traslada
// al producto resultante por PROMEDIO PONDERADO con su existencia previa, para que
// la ganancia siga saliendo correcta. El precio de venta del destino no se toca.
export const conversionsRepo = {
  // Acepta `inputs: [{ productId, qty }]` (receta), o la firma antigua de un solo
  // insumo `fromProductId/fromQty` (compatibilidad con la conversion mayorista).
  async create({ inputs, fromProductId, fromQty, toProductId, toQty, byUserId, note = '', location = WAREHOUSE }) {
    // Normaliza los insumos y suma cantidades si un producto se repite.
    const raw = (inputs && inputs.length)
      ? inputs
      : (fromProductId ? [{ productId: fromProductId, qty: fromQty }] : [])
    const merged = {}
    for (const x of raw) {
      const pid = x.productId
      const q = Math.abs(Number(x.qty) || 0)
      if (!pid || q <= 0) continue
      merged[pid] = round2((merged[pid] || 0) + q)
    }
    const ins = Object.entries(merged).map(([productId, qty]) => ({ productId, qty }))
    const tq = Math.abs(Number(toQty) || 0)
    if (!ins.length) throw new Error('Elige al menos un producto a consumir (con cantidad)')
    if (!toProductId) throw new Error('Elige el producto resultante')
    if (ins.some((x) => x.productId === toProductId)) throw new Error('El producto resultante no puede ser uno de los insumos')
    if (tq <= 0) throw new Error('Indica la cantidad resultante (mayor que 0)')

    // Ubicacion donde ocurre la conversion (almacen central o centro de elaboracion).
    const loc = location || WAREHOUSE
    const id = newId()
    const ts = now()
    let result = null

    await db.transaction('rw', db.conversions, db.stockMovements, db.products, async () => {
      // 1) Valida existencia de cada insumo en la ubicacion y acumula el valor.
      const inProducts = []
      let movedValue = 0
      for (const x of ins) {
        const p = await db.products.get(x.productId)
        if (!p) throw new Error('Un producto insumo no existe')
        const avail = p.stockByLocation?.[loc] != null
          ? Number(p.stockByLocation[loc])
          : Number(p.stock || 0)
        if (x.qty > avail) {
          throw new Error(`No hay suficiente "${p.name}" (disponible ${avail})`)
        }
        movedValue = round2(movedValue + x.qty * Number(p.cost || 0))
        inProducts.push({ p, qty: x.qty })
      }

      const to = await db.products.get(toProductId)
      if (!to) throw new Error('El producto resultante no existe')

      // 2) Costo del destino por promedio ponderado con su existencia previa.
      const unitCostTo = round2(movedValue / tq)
      const prevQtyTo = Number(to.stock || 0)
      const prevCostTo = Number(to.cost || 0)
      const newQtyTo = round2(prevQtyTo + tq)
      const newCostTo = newQtyTo > 0
        ? round2((prevQtyTo * prevCostTo + movedValue) / newQtyTo)
        : prevCostTo

      // 3) Salida (-) de cada insumo + actualizacion de su cache de stock.
      for (const { p, qty } of inProducts) {
        await db.stockMovements.add({
          id: newId(), productId: p.id, qty: -qty,
          type: MOVEMENT_TYPES.CONVERSION_OUT, refType: 'conversion', refId: id,
          unitCost: Number(p.cost || 0), shiftId: null, userId: byUserId, note: '',
          location: loc, createdAt: ts
        })
        const byLoc = { ...(p.stockByLocation || {}) }
        byLoc[loc] = round2(Number(byLoc[loc] || 0) - qty)
        await db.products.update(p.id, {
          stock: round2(Number(p.stock || 0) - qty),
          stockByLocation: byLoc,
          updatedAt: ts
        })
      }

      // 4) Entrada (+) del producto resultante + actualizacion de stock y costo.
      await db.stockMovements.add({
        id: newId(), productId: toProductId, qty: tq,
        type: MOVEMENT_TYPES.CONVERSION_IN, refType: 'conversion', refId: id,
        unitCost: unitCostTo, shiftId: null, userId: byUserId, note: '',
        location: loc, createdAt: ts
      })
      const toByLoc = { ...(to.stockByLocation || {}) }
      toByLoc[loc] = round2(Number(toByLoc[loc] || 0) + tq)
      await db.products.update(toProductId, {
        stock: newQtyTo,
        stockByLocation: toByLoc,
        cost: newCostTo,
        updatedAt: ts
      })

      // 5) Registro append-only de la conversion (con todos los insumos).
      await db.conversions.add({
        id,
        inputs: inProducts.map(({ p, qty }) => ({
          productId: p.id, name: p.name, unit: p.unit, qty, unitCost: Number(p.cost || 0)
        })),
        // Compat. de lectura: el primer insumo en los campos "from*".
        fromProductId: inProducts[0].p.id,
        fromName: inProducts[0].p.name,
        fromUnit: inProducts[0].p.unit,
        fromQty: inProducts[0].qty,
        toProductId, toName: to.name, toUnit: to.unit, toQty: tq,
        unitCostTo,
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
