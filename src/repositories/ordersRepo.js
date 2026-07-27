import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { MOVEMENT_TYPES, ORDER_STATUS } from '../db/constants'

// ---------------------------------------------------------------------------
// Modulo 'mesas': cuentas abiertas por mesa dentro de un area (cafeteria).
//
// Reglas de diseno (coherentes con el resto del proyecto):
//  - APPEND-ONLY: cada consumo es una fila de `orderItems`. Quitar un item NO
//    lo borra: lo marca `voided` y genera el movimiento de compensacion. Asi
//    dos dispositivos (camarero y caja) pueden atender la misma mesa sin
//    pisarse, porque la sincronizacion fusiona filas (no arrays).
//  - EL STOCK SE REBAJA AL AGREGAR cada item (control en vivo): si el area no
//    tiene existencia, no se puede agregar. Al cobrar NO se vuelve a mover el
//    stock (la venta se crea con skipStock).
//  - SIEMPRE desde el AREA del turno. Una mesa nunca vende del almacen central:
//    aqui no existe ese camino.
//  - El precio se congela en la linea, igual que en una venta normal.
// ---------------------------------------------------------------------------

// Existencia de un producto en una ubicacion (derivada del libro mayor, que es
// la fuente de verdad; la cache de products puede ir por detras tras una sync).
async function stockAtLoc(productId, location) {
  const movs = await db.stockMovements
    .where('[productId+location]').equals([productId, location]).toArray()
  return movs.reduce((a, m) => a + Number(m.qty || 0), 0)
}

export const ordersRepo = {
  // Pedidos abiertos de todo el local (para el panel del manager) o de un area.
  async listOpen(area = null) {
    const rows = await db.orders.where('status').equals(ORDER_STATUS.OPEN).toArray()
    const list = area ? rows.filter((o) => o.area === area) : rows
    return list.sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1))
  },

  async get(id) {
    return db.orders.get(id)
  },

  // Pedido abierto de una mesa concreta (o null si la mesa esta libre).
  async getOpenFor(area, table) {
    const rows = await db.orders.where('status').equals(ORDER_STATUS.OPEN).toArray()
    return rows.find((o) => o.area === area && o.table === table) || null
  },

  // Lineas de un pedido (las anuladas se conservan, marcadas).
  async items(orderId) {
    const rows = await db.orderItems.where('orderId').equals(orderId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  },

  // Lineas vivas (no anuladas): las que se cobran.
  async liveItems(orderId) {
    const rows = await this.items(orderId)
    return rows.filter((i) => !i.voided)
  },

  // Abre la cuenta de una mesa. Si ya habia una abierta, devuelve esa (evita
  // duplicar si dos dispositivos abren a la vez la misma mesa).
  async open({ area, table, shiftId, userId }) {
    const a = String(area || '').trim()
    const t = String(table || '').trim()
    const existing = await this.getOpenFor(a, t)
    if (existing) return existing.id
    const id = newId()
    const ts = now()
    await db.orders.add({
      id,
      area: a,
      table: t,
      status: ORDER_STATUS.OPEN,
      shiftId,
      openedBy: userId,
      openedAt: ts,
      updatedAt: ts,
      closedAt: null,
      closedBy: null,
      saleId: null
    })
    return id
  },

  // Agrega un consumo a la mesa y REBAJA el stock del area en el acto. Lanza si
  // no hay existencia suficiente (evita prometer al cliente lo que no hay).
  async addItem({ orderId, product, qty, userId, shiftId = null }) {
    const q = Math.abs(Number(qty))
    if (!(q > 0)) throw new Error('Cantidad no valida')
    const order = await db.orders.get(orderId)
    if (!order) throw new Error('El pedido no existe')
    if (order.status !== ORDER_STATUS.OPEN) throw new Error('El pedido ya no esta abierto')
    const loc = order.area // una mesa SIEMPRE consume del area de su turno

    const available = await stockAtLoc(product.id, loc)
    if (available < q) {
      throw new Error(`Solo hay ${available} ${product.unit} de ${product.name} en el area`)
    }

    const id = newId()
    const ts = now()
    const unitPrice = Number(product.price) || 0
    await db.transaction('rw', db.orderItems, db.orders, db.stockMovements, db.products, async () => {
      await db.orderItems.add({
        id,
        orderId,
        productId: product.id,
        name: product.name, // snapshot: el nombre del ticket no cambia despues
        unit: product.unit,
        qty: q,
        unitPrice, // precio CONGELADO en la linea
        unitCost: Number(product.cost) || 0,
        lineTotal: round2(q * unitPrice),
        area: loc,
        createdBy: userId,
        voided: false,
        createdAt: ts,
        updatedAt: ts
      })
      // Salida del libro mayor ligada al PEDIDO. Se usa SALE_OUT porque es
      // consumo vendido: asi el submayor y los reportes de inventario lo
      // clasifican como venta sin necesidad de tocar su logica.
      await db.stockMovements.add({
        id: newId(),
        productId: product.id,
        qty: -q,
        type: MOVEMENT_TYPES.SALE_OUT,
        refType: 'order',
        refId: orderId,
        unitCost: Number(product.cost) || 0,
        shiftId: shiftId || order.shiftId,
        userId,
        note: `Mesa ${order.table}`,
        location: loc,
        createdAt: ts
      })
      const p = await db.products.get(product.id)
      if (p) {
        const byLoc = { ...(p.stockByLocation || {}) }
        byLoc[loc] = Number(byLoc[loc] || 0) - q
        await db.products.update(product.id, {
          stock: Number(p.stock || 0) - q,
          stockByLocation: byLoc,
          updatedAt: ts
        })
      }
      await db.orders.update(orderId, { updatedAt: ts })
    })
    return id
  },

  // Quita una linea ANTES de cobrar: no se borra (append-only), se marca
  // anulada y se DEVUELVE el stock con un movimiento de compensacion.
  async voidItem({ itemId, userId, note = '' }) {
    const item = await db.orderItems.get(itemId)
    if (!item) throw new Error('La linea no existe')
    if (item.voided) return
    const order = await db.orders.get(item.orderId)
    if (!order) throw new Error('El pedido no existe')
    if (order.status !== ORDER_STATUS.OPEN) throw new Error('El pedido ya no esta abierto')
    const ts = now()
    const loc = item.area
    await db.transaction('rw', db.orderItems, db.orders, db.stockMovements, db.products, async () => {
      await db.orderItems.update(itemId, {
        voided: true,
        voidedBy: userId,
        voidedAt: ts,
        voidNote: String(note || '').trim(),
        updatedAt: ts
      })
      // Compensacion: SALE_OUT en POSITIVO (devolucion). Al ser el mismo tipo,
      // el neto de "Ventas" del submayor queda exacto sin tocar los reportes.
      await db.stockMovements.add({
        id: newId(),
        productId: item.productId,
        qty: item.qty,
        type: MOVEMENT_TYPES.SALE_OUT,
        refType: 'order_void',
        refId: item.orderId,
        unitCost: item.unitCost ?? null,
        shiftId: order.shiftId,
        userId,
        note: `Anulada mesa ${order.table}`,
        location: loc,
        createdAt: ts
      })
      const p = await db.products.get(item.productId)
      if (p) {
        const byLoc = { ...(p.stockByLocation || {}) }
        byLoc[loc] = Number(byLoc[loc] || 0) + item.qty
        await db.products.update(item.productId, {
          stock: Number(p.stock || 0) + item.qty,
          stockByLocation: byLoc,
          updatedAt: ts
        })
      }
      await db.orders.update(item.orderId, { updatedAt: ts })
    })
  },

  // Totales de la cuenta: consumo + cargo por servicio del area.
  // `waived` = el mando eximio el cargo para esta mesa.
  async totals(orderId, { servicePct = 0, waived = false } = {}) {
    const items = await this.liveItems(orderId)
    const subtotal = round2(items.reduce((a, i) => a + Number(i.lineTotal || 0), 0))
    const pct = waived ? 0 : Math.max(0, Number(servicePct) || 0)
    const service = round2(subtotal * (pct / 100))
    return {
      items,
      count: items.length,
      subtotal,
      servicePct: pct,
      service,
      total: round2(subtotal + service)
    }
  },

  // Marca el pedido como cobrado y lo enlaza con la venta ya creada. La venta
  // la crea la pantalla via salesRepo.create({ skipStock: true, ... }) para
  // reutilizar TODA la logica de cobro existente (mixto, cuentas, consignacion).
  async markClosed({ orderId, saleId, userId }) {
    const ts = now()
    await db.orders.update(orderId, {
      status: ORDER_STATUS.CLOSED,
      saleId,
      closedBy: userId,
      closedAt: ts,
      updatedAt: ts
    })
  },

  // Anula la mesa completa SIN cobrar (el cliente se fue, cortesia): devuelve
  // el stock de todas las lineas vivas y deja el pedido marcado con su motivo.
  async voidOrder({ orderId, userId, note = '' }) {
    const live = await this.liveItems(orderId)
    for (const it of live) {
      await this.voidItem({ itemId: it.id, userId, note: 'Pedido anulado' })
    }
    const ts = now()
    await db.orders.update(orderId, {
      status: ORDER_STATUS.VOIDED,
      closedBy: userId,
      closedAt: ts,
      voidNote: String(note || '').trim(),
      updatedAt: ts
    })
  },

  // Pedidos de un turno (para el cuadre y los reportes de cierre).
  async byShift(shiftId) {
    const rows = await db.orders.where('shiftId').equals(shiftId).toArray()
    return rows.sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))
  },

  async listAll() {
    const rows = await db.orders.toArray()
    return rows.sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))
  }
}
