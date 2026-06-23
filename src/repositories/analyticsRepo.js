import { db } from '../db/db'
import { round2 } from '../lib/currency'

function inRange(iso, from, to) {
  const d = (iso || '').slice(0, 10)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

// Analitica para el panel del dueno. Todo se deriva de las ventas (no se
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

    return { salesCount: sales.length, revenue, cost, profit, marginPct, byProduct, byCategory }
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

  // Productos en o por debajo de su stock minimo (o agotados).
  async restock() {
    const products = (await db.products.toArray()).filter((p) => p.active)
    return products
      .filter((p) => (Number(p.minStock) > 0 && p.stock <= p.minStock) || p.stock <= 0)
      .map((p) => ({ productId: p.id, name: p.name, stock: p.stock, minStock: Number(p.minStock) || 0, unit: p.unit }))
      .sort((a, b) => a.stock - b.stock)
  }
}
