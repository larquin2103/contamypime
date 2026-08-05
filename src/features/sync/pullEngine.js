import { db } from '../../db/db'
import { WAREHOUSE } from '../../db/constants'
import { cleanQty } from '../../lib/qty'
import { LOCAL_CONFIG_KEYS, syncTs } from './collections'

// ---------------------------------------------------------------------------
// Fase 4 - Bloque 24: motor de BAJADA (pull).
//
// Fusiona en Dexie los documentos que llegan de Firestore con "ultima
// escritura gana" (LWW) por marca de sync. Tras fusionar movimientos o
// productos, RECALCULA products.stock desde el libro mayor (stockMovements),
// de modo que dos vendedores vendiendo en paralelo offline no se pisen el
// stock: se fusionan los movimientos y el stock sale de la suma.
// ---------------------------------------------------------------------------

// Fusiona una tanda de documentos de una coleccion. Devuelve el set de
// productos afectados (para recalcular su stock).
export async function mergeIncoming(col, docs) {
  const table = db[col.name]
  if (!table || !docs.length) return new Set()

  let items = docs.filter((d) => d && d[col.pk] != null)
  if (col.name === 'config') items = items.filter((d) => !LOCAL_CONFIG_KEYS.has(d.key))
  if (!items.length) return new Set()

  const ids = items.map((d) => d[col.pk])
  const locals = await table.bulkGet(ids)
  const localById = {}
  locals.forEach((l, i) => { if (l) localById[ids[i]] = l })

  const toPut = []
  const affected = new Set()
  for (const incoming of items) {
    const id = incoming[col.pk]
    const local = localById[id]
    // LWW: escribe solo si lo entrante es mas nuevo (o no existia local).
    if (!local || syncTs(incoming) > syncTs(local)) toPut.push(incoming)
    if (col.name === 'stockMovements') affected.add(incoming.productId)
    if (col.name === 'products') affected.add(incoming.id)
  }
  if (toPut.length) await table.bulkPut(toPut)
  return affected
}

// Recalcula products.stock (total) y stockByLocation (por ubicacion) como la
// suma de su libro mayor. NO toca updatedAt (el stock es un valor derivado:
// cada dispositivo lo deriva igual del mismo libro, asi que no debe re-subirse
// ni provocar rebote entre dispositivos).
export async function recomputeStock(productIds) {
  const ids = [...productIds].filter(Boolean)
  if (!ids.length) return
  for (const pid of ids) {
    const movs = await db.stockMovements.where('productId').equals(pid).toArray()
    let total = 0
    const byLoc = {}
    for (const m of movs) {
      const q = Number(m.qty || 0)
      const loc = m.location || WAREHOUSE
      total += q
      byLoc[loc] = Number(byLoc[loc] || 0) + q
    }
    // La suma de fracciones (pesos) deja residuos de punto flotante: se limpian
    // a 3 decimales para que un 0 real no quede como 2.66e-15 ni un 2.5 como
    // 2.4999999996. Es un valor DERIVADO: no toca updatedAt (no rebota la sync).
    total = cleanQty(total)
    for (const loc of Object.keys(byLoc)) byLoc[loc] = cleanQty(byLoc[loc])
    const p = await db.products.get(pid)
    if (p && (Number(p.stock) !== total ||
        JSON.stringify(p.stockByLocation || {}) !== JSON.stringify(byLoc))) {
      await db.products.update(pid, { stock: total, stockByLocation: byLoc })
    }
  }
}
