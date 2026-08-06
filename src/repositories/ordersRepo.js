import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2, foreignToBase, isForeignPriced } from '../lib/currency'
import { cleanQty } from '../lib/qty'
import { ratesRepo } from './ratesRepo'
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
  // Limpia el residuo de punto flotante (pesos): un 0 real no debe quedar como
  // 2.66e-15 y hacer que se "pueda" agregar lo que no hay.
  return cleanQty(movs.reduce((a, m) => a + Number(m.qty || 0), 0))
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

  // Mesas NO libres: ocupadas (open) + reservadas. Una mesa cobrada (closed) o
  // anulada NO aparece aqui: vuelve a estar LIBRE al instante.
  async listActive(area = null) {
    const rows = await db.orders
      .where('status').anyOf(ORDER_STATUS.OPEN, ORDER_STATUS.RESERVED).toArray()
    const list = area ? rows.filter((o) => o.area === area) : rows
    return list.sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1))
  },

  // Pedido vivo (ocupado o reservado) de una mesa concreta.
  async getActiveFor(area, table) {
    const rows = await this.listActive(area)
    return rows.find((o) => o.table === table) || null
  },

  // Reserva una mesa: queda apartada, sin consumo y sin turno asociado todavia.
  async reserve({ area, table, userId, note = '' }) {
    const a = String(area || '').trim()
    const t = String(table || '').trim()
    const existing = await this.getActiveFor(a, t)
    if (existing) return existing.id
    const id = newId()
    const ts = now()
    await db.orders.add({
      id,
      area: a,
      table: t,
      status: ORDER_STATUS.RESERVED,
      shiftId: null,
      openedBy: userId,
      openedAt: ts,
      reservedNote: String(note || '').trim(),
      updatedAt: ts,
      closedAt: null,
      closedBy: null,
      saleId: null
    })
    return id
  },

  // El cliente llega: la reserva pasa a mesa OCUPADA y se ata al turno que la
  // atiende (a partir de aqui ya se le puede agregar consumo).
  async occupy({ orderId, shiftId, userId }) {
    const ts = now()
    await db.orders.update(orderId, {
      status: ORDER_STATUS.OPEN,
      shiftId,
      openedBy: userId,
      openedAt: ts,
      updatedAt: ts
    })
  },

  // Cancela una reserva (la mesa vuelve a estar libre). No se borra: queda
  // anulada con su motivo, como todo en el sistema.
  async cancelReservation({ orderId, userId, note = '' }) {
    const ts = now()
    await db.orders.update(orderId, {
      status: ORDER_STATUS.VOIDED,
      closedBy: userId,
      closedAt: ts,
      voidNote: String(note || '').trim() || 'Reserva cancelada',
      updatedAt: ts
    })
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

    // Modulo 'divisas': si el producto fija su precio en divisa, precio y costo se
    // convierten a la base (MN) con la tasa vigente y se congela (moneda + tasa)
    // en la linea. La tasa se lee AQUI (no en la pantalla) porque decrementOne
    // re-llama a addItem con el producto real. El resto del flujo de mesas opera
    // en MN, igual que siempre. Un producto en la base NO entra por este camino.
    const foreign = isForeignPriced(product)
    let priceRate = 1
    if (foreign) {
      priceRate = await ratesRepo.currentRateFor(product.priceCurrency)
      if (!(priceRate > 0)) {
        throw new Error(`Define la tasa de ${product.priceCurrency} antes de vender productos en esa moneda.`)
      }
    }
    const toMN = (v) => (foreign ? foreignToBase(v, priceRate) : (Number(v) || 0))

    const id = newId()
    const ts = now()
    const unitPrice = toMN(product.price)
    const unitCost = toMN(product.cost)
    await db.transaction('rw', db.orderItems, db.orders, db.stockMovements, db.products, async () => {
      await db.orderItems.add({
        id,
        orderId,
        productId: product.id,
        name: product.name, // snapshot: el nombre del ticket no cambia despues
        unit: product.unit,
        qty: q,
        unitPrice, // precio CONGELADO en la linea (en MN)
        unitCost,
        lineTotal: round2(q * unitPrice),
        area: loc,
        createdBy: userId,
        voided: false,
        createdAt: ts,
        updatedAt: ts,
        // Congelado de divisa (solo productos en divisa): moneda y tasa usadas
        // para derivar el MN; viajan a la venta al cobrar como snapshot.
        ...(foreign ? { priceCurrency: product.priceCurrency, priceRate } : {})
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
        unitCost, // MN (convertido si el producto es en divisa)
        shiftId: shiftId || order.shiftId,
        userId,
        note: `Mesa ${order.table}`,
        location: loc,
        createdAt: ts
      })
      const p = await db.products.get(product.id)
      if (p) {
        const byLoc = { ...(p.stockByLocation || {}) }
        byLoc[loc] = cleanQty(Number(byLoc[loc] || 0) - q)
        await db.products.update(product.id, {
          stock: cleanQty(Number(p.stock || 0) - q),
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
        byLoc[loc] = cleanQty(Number(byLoc[loc] || 0) + item.qty)
        await db.products.update(item.productId, {
          stock: cleanQty(Number(p.stock || 0) + item.qty),
          stockByLocation: byLoc,
          updatedAt: ts
        })
      }
      await db.orders.update(item.orderId, { updatedAt: ts })
    })
  },

  // Quita UNA unidad de un producto (boton "-" de la cuenta). Append-only: anula
  // la ultima linea viva de ese producto y, si esa linea traia mas de una unidad,
  // vuelve a registrar el resto. El stock se devuelve/rebaja en consecuencia.
  async decrementOne({ orderId, productId, userId }) {
    const rows = await db.orderItems.where('orderId').equals(orderId).toArray()
    const lines = rows
      .filter((i) => i.productId === productId && !i.voided)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    const last = lines[lines.length - 1]
    if (!last) return
    const rest = Number(last.qty) - 1
    // Anula la linea completa (devuelve todo su stock)...
    await this.voidItem({ itemId: last.id, userId, note: 'Ajuste de cantidad' })
    if (rest > 0) {
      // ...y vuelve a poner el resto como linea nueva (vuelve a rebajar).
      const p = await db.products.get(productId)
      if (p) await this.addItem({ orderId, product: p, qty: rest, userId })
    }
  },

  // Quita del pedido TODAS las unidades de un producto (boton papelera). Es el
  // atajo de "el cliente ya no lo quiere": anula sus lineas vivas y devuelve
  // todo el stock de una vez, sin tener que restar unidad por unidad.
  async removeProduct({ orderId, productId, userId, note = '' }) {
    const rows = await db.orderItems.where('orderId').equals(orderId).toArray()
    const lines = rows.filter((i) => i.productId === productId && !i.voided)
    for (const l of lines) {
      await this.voidItem({ itemId: l.id, userId, note: note || 'Retirado de la cuenta' })
    }
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
