import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { cleanQty } from '../lib/qty'
import { MOVEMENT_TYPES, locationLabel } from '../db/constants'
import { ledgerQtyAt, resolveSourceLocation } from '../lib/stockLocation'

// Deuda interna: retiro de producto sin pago. Descuenta inventario, NO cuenta
// como ingreso y queda como deuda asociada a un usuario registrado.
export const debtsRepo = {
  async create({ shiftId, debtorUserId, registeredBy, authorizedBy = '', productId, qty, unitValue, note = '', sourceLocation = '' }) {
    const id = newId()
    const ts = now()
    const q = Math.abs(Number(qty))
    const valueAtTime = round2(q * (Number(unitValue) || 0))
    // El producto sale de la ubicacion desde donde se TOMA: por defecto el area
    // del turno (sin area, el almacen) — comportamiento clasico. Con mayorista, la
    // pantalla puede pasar sourceLocation (almacen central) para rebajar de ahi.
    const shift = shiftId ? await db.shifts.get(shiftId) : null
    const loc = resolveSourceLocation(sourceLocation, shift?.area)
    await db.transaction('rw', db.internalDebts, db.stockMovements, db.products, async () => {
      // CANDADO DE EXISTENCIA (F4). Hasta aqui este era el UNICO repo que rebajaba
      // inventario sin comprobar nada: ni contra la cache ni contra el libro. La
      // evidencia esta en los datos del negocio — Refresco Limon quedo en -5 y ese
      // -5 es el UNICO movimiento del producto en toda su vida.
      //
      // Se valida contra el LIBRO MAYOR y no contra la cache (el mismo candado de
      // ultima instancia que `salesRepo`), DENTRO de la transaccion que ya incluia
      // `db.stockMovements`: no hace falta ampliar su alcance. Cuesta UNA consulta
      // por indice, porque una deuda es de un solo producto.
      //
      // Y se valida en TODAS las ubicaciones, incluido el almacen central —a
      // diferencia de `salesRepo`, que lo exime para la venta mayorista—. Aqui no
      // habia ninguna doctrina de excepcion que preservar: no habia control alguno.
      // Ademas el vendedor YA no puede VENDER lo que no hay en su area; no tendria
      // sentido que si pudiera sacarlo como deuda.
      // Por `productId` y NO por el indice compuesto `[productId+location]`: ese
      // indice se salta EN SILENCIO los movimientos sin `location` (pueden llegar
      // por sync o por el JSON de un turno), y aqui eso rechazaria una deuda
      // legitima diciendo que hay 0. `ledgerQtyAt` agrupa igual que la cache.
      const movs = await db.stockMovements.where('productId').equals(productId).toArray()
      const avail = ledgerQtyAt(movs, loc)
      // Los dos lados limpios: restar pesos deja residuos (2.4999999996), y sin esto
      // una deuda de 2.5 kg contra 2.5 kg reales se rechazaria sin motivo.
      if (avail < cleanQty(q)) {
        const p0 = await db.products.get(productId)
        throw new Error(
          `Solo hay ${avail} ${p0?.unit || ''} de ${p0?.name || 'este producto'} en ${locationLabel(loc)}`
            .replace(/\s+/g, ' ')
        )
      }
      await db.internalDebts.add({
        id,
        shiftId,
        userId: debtorUserId, // a quien se le asocia la deuda
        registeredBy,
        authorizedBy,
        productId,
        qty: q,
        valueAtTime,
        note,
        settled: false,
        createdAt: ts
      })
      await db.stockMovements.add({
        id: newId(),
        productId,
        qty: -q,
        type: MOVEMENT_TYPES.INTERNAL_DEBT_OUT,
        refType: 'internal_debt',
        refId: id,
        shiftId,
        userId: registeredBy,
        note,
        location: loc,
        createdAt: ts
      })
      const p = await db.products.get(productId)
      if (p) {
        const byLoc = { ...(p.stockByLocation || {}) }
        byLoc[loc] = cleanQty(Number(byLoc[loc] || 0) - q)
        await db.products.update(productId, {
          stock: cleanQty(Number(p.stock || 0) - q),
          stockByLocation: byLoc,
          updatedAt: ts
        })
      }
    })
    return id
  },

  async byShift(shiftId) {
    const rows = await db.internalDebts.where('shiftId').equals(shiftId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async listAll() {
    const rows = await db.internalDebts.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Liquida (salda) una deuda: no se borra, queda con fecha, quien la saldo y
  // COMO se resolvio (efectivo/transferencia/nomina/condonada) + nota opcional.
  // `settledAt` hace que la sync detecte el cambio (LWW por marca de tiempo).
  async settle(id, byUserId, { method = null, note = '' } = {}) {
    await db.internalDebts.update(id, {
      settled: true,
      settledAt: now(),
      settledBy: byUserId,
      settleMethod: method,
      settleNote: note.trim()
    })
  }
}
