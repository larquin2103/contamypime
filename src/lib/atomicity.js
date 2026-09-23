// ---------------------------------------------------------------------------
// Diagnostico de atomicidad (auditoria Burger Premium, H3-b). PURO, solo lee.
//
// Varios repos escriben el documento y sus movimientos del libro mayor en UNA
// transaccion Dexie (kitchenRepo.produce, purchasesRepo.create,
// transfersRepo.create, salesRepo.create, ordersRepo.voidItem). En un solo
// aparato no puede existir uno sin el otro: nadie borra de esas tablas. Si aqui
// aparece, la sincronizacion partio la transaccion (cursores por coleccion).
// ---------------------------------------------------------------------------
const arr = (x) => (Array.isArray(x) ? x : [])

function pairs(docs, movs, refType, docKind) {
  const out = []
  const docIds = new Set(docs.map((d) => d.id))
  const withMov = new Set(movs.filter((m) => m.refType === refType).map((m) => m.refId))
  for (const d of docs) {
    if (!withMov.has(d.id)) out.push({ kind: `${docKind}-sin-mov`, id: d.id, at: d.createdAt || '', detail: '' })
  }
  const seen = new Set()
  for (const m of movs) {
    if (m.refType !== refType || docIds.has(m.refId) || seen.has(m.refId)) continue
    seen.add(m.refId)
    out.push({ kind: `mov-sin-${docKind}`, id: m.refId, at: m.createdAt || '', detail: '' })
  }
  return out
}

export function findAtomicityBreaks(tables = {}) {
  const movs = arr(tables.stockMovements)
  // Ventas que DEBEN mover stock: vivas y sin orderId (las de mesa nacen con
  // skipStock y su stock lo mueven las lineas con refType 'order'). Un
  // movimiento 'sale' de una venta excluida tampoco es "movimiento sin venta".
  const allSales = arr(tables.sales)
  const excluded = new Set(allSales.filter((s) => s.voided || s.orderId).map((s) => s.id))
  const sales = allSales.filter((s) => !excluded.has(s.id) && arr(s.items).length)
  const saleMovs = movs.filter((m) => !(m.refType === 'sale' && excluded.has(m.refId)))
  const out = [
    ...pairs(arr(tables.productions), movs, 'production', 'production'),
    ...pairs(arr(tables.purchases), movs, 'purchase', 'purchase'),
    ...pairs(arr(tables.transfers), movs, 'transfer', 'transfer'),
    ...pairs(sales, saleMovs, 'sale', 'sale')
  ]
  // Anulacion de linea de mesa: voidItem sella la linea (voidedAt) y su
  // devolucion (createdAt) con el MISMO ts. Esa igualdad es la firma.
  const voids = movs.filter((m) => m.refType === 'order_void')
  const voidKey = (orderId, ts) => `${orderId}|${ts}`
  const movKeys = new Set(voids.map((m) => voidKey(m.refId, m.createdAt)))
  const lineKeys = new Set()
  for (const it of arr(tables.orderItems)) {
    if (!it.voided || !it.voidedAt) continue
    const k = voidKey(it.orderId, it.voidedAt)
    lineKeys.add(k)
    if (!movKeys.has(k)) out.push({ kind: 'anulacion-sin-mov', id: it.id, at: it.voidedAt, detail: it.orderId })
  }
  for (const m of voids) {
    if (!lineKeys.has(voidKey(m.refId, m.createdAt)))
      out.push({ kind: 'mov-anulacion-sin-linea', id: m.id, at: m.createdAt, detail: m.refId })
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}
