import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { deriveProductBalances, deriveHolderProducts } from '../lib/productCustodyMath'

// Custodia de PRODUCTO del mensajero (modulo 'remesas', F6) — LIBRO PROPIO Y AISLADO
// del inventario general, igual que el efectivo tiene su `custodyMovements`. El
// "tenedor" (holder) es el userId del mensajero; el saldo por producto se DERIVA de
// los movimientos (qty con signo: + al cargar, - al entregar o devolver). NO toca
// products.stock ni stockByLocation (por eso no aparece en el inventario por ubicacion
// ni en el conteo). La matematica vive en lib/productCustodyMath (pura, testeada).
export const productCustodyRepo = {
  // Movimiento crudo. SIN transaccion propia: se llama DENTRO de una transaccion que
  // ya incluya db.productCustody (como custodyRepo.addMovementRaw). El id puede pasarse
  // DETERMINISTA para que dos dispositivos que registren el MISMO evento no dupliquen.
  async addMovementRaw({ id = null, holder, productId, name = '', qty, refType = '', refId = null, byUserId = null, createdAt = null }) {
    const q = Number(qty) || 0
    if (!holder || !productId || q === 0) return null
    const movId = id || newId()
    await db.productCustody.add({
      id: movId,
      holder,
      productId,
      name: String(name || ''),
      qty: q,
      refType,
      refId,
      byUserId,
      createdAt: createdAt || now()
    })
    return movId
  },

  // Saldos de TODOS los mensajeros: { holder: { productId: qty } }.
  async balances() {
    return deriveProductBalances(await db.productCustody.toArray())
  },

  // Productos que carga UN mensajero: { productId: qty }.
  async holderProducts(holder) {
    const rows = await db.productCustody.where('holder').equals(holder).toArray()
    return deriveHolderProducts(rows, holder)
  },

  // Ultimo nombre visto de cada producto en un tenedor (para mostrar sin releer catalogo).
  async holderNames(holder) {
    const rows = await db.productCustody.where('holder').equals(holder).toArray()
    const names = {}
    for (const m of rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) {
      if (m.name) names[m.productId] = m.name
    }
    return names
  },

  async allMovements() {
    const rows = await db.productCustody.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
}
