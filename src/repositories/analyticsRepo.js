import { db } from '../db/db'
import { round2 } from '../lib/currency'
import { localDay } from '../lib/dates'

// El dia se calcula en hora LOCAL (no UTC) para que "hoy" cuadre con el dia
// calendario del negocio (ver localDay en lib/dates).
function inRange(iso, from, to) {
  const d = localDay(iso)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

// Lista de dias 'YYYY-MM-DD' entre from y to (inclusive), en hora local.
function daysBetween(from, to) {
  const out = []
  const d = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (d <= end) {
    out.push(localDay(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

// Analitica para el panel del dueño. Todo se deriva de las ventas (no se
// guardan agregados): costo vs ganancia, ranking y rotacion.
export const analyticsRepo = {
  async report({ from = null, to = null } = {}) {
    const allSales = await db.sales.toArray()
    const sales = allSales.filter((s) => !s.voided && inRange(s.createdAt, from, to))

    let revenue = 0
    let cost = 0
    const prod = {}
    for (const s of sales) {
      for (const it of s.items || []) {
        const lineRev = Number(it.lineTotal ?? it.unitPrice * it.qty)
        const lineCost = Number((it.unitCost || 0) * it.qty)
        revenue += lineRev
        cost += lineCost
        const p =
          prod[it.productId] ||
          (prod[it.productId] = { productId: it.productId, name: it.name, qty: 0, revenue: 0, cost: 0 })
        p.qty += Number(it.qty)
        p.revenue += lineRev
        p.cost += lineCost
      }
    }
    revenue = round2(revenue)
    cost = round2(cost)
    const profit = round2(revenue - cost)
    const marginPct = revenue ? round2((profit / revenue) * 100) : 0

    const byProduct = Object.values(prod)
      .map((p) => ({ ...p, revenue: round2(p.revenue), cost: round2(p.cost), profit: round2(p.revenue - p.cost) }))
      .sort((a, b) => b.qty - a.qty)

    // Por categoria.
    const products = await db.products.toArray()
    const catOf = {}
    for (const p of products) catOf[p.id] = p.categoryId || '__none'
    const cats = {}
    for (const p of byProduct) {
      const c = catOf[p.productId] || '__none'
      const e = cats[c] || (cats[c] = { categoryId: c, revenue: 0, profit: 0, qty: 0 })
      e.revenue += p.revenue
      e.profit += p.profit
      e.qty += p.qty
    }
    const byCategory = Object.values(cats)
      .map((e) => ({ ...e, revenue: round2(e.revenue), profit: round2(e.profit) }))
      .sort((a, b) => b.revenue - a.revenue)

    // Por area de venta (Fase 6 - Bloque 19). Se agrupa por el area del PRODUCTO
    // (snapshot en la linea) y se detectan las ventas "cruzadas": lineas de un
    // area distinta a la del turno donde se cobraron (sustitucion de vendedor).
    const users = await db.users.toArray()
    const nameOf = Object.fromEntries(users.map((u) => [u.id, u.name]))
    const areaAgg = {}
    const crossBySeller = {}
    let crossRevenue = 0
    let crossCount = 0
    for (const s of sales) {
      const shiftArea = String(s.area || '')
      let saleHasCross = false
      for (const it of s.items || []) {
        const itArea = String(it.area || '')
        const lineRev = Number(it.lineTotal ?? it.unitPrice * it.qty)
        const lineCost = Number((it.unitCost || 0) * it.qty)
        const key = itArea || '__none'
        const e = areaAgg[key] || (areaAgg[key] = { area: itArea, revenue: 0, profit: 0, qty: 0 })
        e.revenue += lineRev
        e.profit += lineRev - lineCost
        e.qty += Number(it.qty)
        if (itArea && itArea !== shiftArea) {
          saleHasCross = true
          crossRevenue += lineRev
          const cs = crossBySeller[s.sellerId] ||
            (crossBySeller[s.sellerId] = { sellerId: s.sellerId, seller: nameOf[s.sellerId] || 'vendedor', revenue: 0, qty: 0 })
          cs.revenue += lineRev
          cs.qty += Number(it.qty)
        }
      }
      if (saleHasCross) crossCount++
    }
    const byArea = Object.values(areaAgg)
      .map((e) => ({ ...e, revenue: round2(e.revenue), profit: round2(e.profit) }))
      .sort((a, b) => b.revenue - a.revenue)
    const crossArea = {
      revenue: round2(crossRevenue),
      count: crossCount,
      bySeller: Object.values(crossBySeller)
        .map((e) => ({ ...e, revenue: round2(e.revenue) }))
        .sort((a, b) => b.revenue - a.revenue)
    }

    // Metodos de pago (efectivo vs transferencia) y serie diaria de ingresos.
    const byMethod = { cash: 0, transfer: 0 }
    const dayTotals = {}
    for (const s of sales) {
      const t = Number(s.totalBase || 0)
      if (s.paymentMethod === 'transfer') byMethod.transfer += t
      else byMethod.cash += t
      const d = localDay(s.createdAt)
      if (d) dayTotals[d] = (dayTotals[d] || 0) + t
    }
    byMethod.cash = round2(byMethod.cash)
    byMethod.transfer = round2(byMethod.transfer)

    let daily
    if (from && to) {
      daily = daysBetween(from, to).map((d) => ({ day: d, total: round2(dayTotals[d] || 0) }))
    } else {
      daily = Object.keys(dayTotals).sort().map((d) => ({ day: d, total: round2(dayTotals[d]) }))
    }
    if (daily.length > 60) daily = daily.slice(-60)

    return {
      salesCount: sales.length,
      revenue,
      cost,
      profit,
      marginPct,
      byProduct,
      byCategory,
      byArea,
      crossArea,
      byMethod,
      daily
    }
  },

  // Productos sin venta en >= `days` dias (o nunca vendidos).
  async lowRotation({ days = 14 } = {}) {
    const products = (await db.products.toArray()).filter((p) => p.active)
    const sales = await db.sales.toArray()
    const lastSale = {}
    for (const s of sales) {
      if (s.voided) continue
      for (const it of s.items || []) {
        if (!lastSale[it.productId] || s.createdAt > lastSale[it.productId]) {
          lastSale[it.productId] = s.createdAt
        }
      }
    }
    const nowMs = Date.now()
    const out = []
    for (const p of products) {
      const last = lastSale[p.id] || null
      const daysSince = last ? Math.floor((nowMs - new Date(last).getTime()) / 86400000) : null
      if (daysSince === null || daysSince >= days) {
        out.push({ productId: p.id, name: p.name, stock: p.stock, unit: p.unit, daysSince, lastSale: last })
      }
    }
    return out.sort((a, b) => (b.daysSince ?? 1e9) - (a.daysSince ?? 1e9))
  },

  // Ventas por transferencia cuyo importe recibido NO coincide con lo que se
  // debia cobrar (transferDiff != 0). Para la alerta del panel del dueño.
  async transferMismatches({ from = null, to = null } = {}) {
    const users = await db.users.toArray()
    const nameOf = Object.fromEntries(users.map((u) => [u.id, u.name]))
    const sales = await db.sales.toArray()
    return sales
      .filter(
        (s) =>
          !s.voided &&
          s.paymentMethod === 'transfer' &&
          Math.abs(Number(s.transferDiff || 0)) >= 0.01 &&
          inRange(s.createdAt, from, to)
      )
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        seller: nameOf[s.sellerId] || 'vendedor',
        currency: s.transferCurrency || 'MN',
        reference: s.transferReference || '',
        expected: round2(Number(s.transferExpected || 0)),
        received: round2(Number(s.transferAmount || 0)),
        diff: round2(Number(s.transferDiff || 0))
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Productos en o por debajo de su stock minimo (o agotados).
  async restock() {
    const products = (await db.products.toArray()).filter((p) => p.active)
    return products
      .filter((p) => (Number(p.minStock) > 0 && p.stock <= p.minStock) || p.stock <= 0)
      .map((p) => ({ productId: p.id, name: p.name, stock: p.stock, minStock: Number(p.minStock) || 0, unit: p.unit }))
      .sort((a, b) => a.stock - b.stock)
  }
}
