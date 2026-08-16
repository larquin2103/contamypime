import { db } from '../db/db'
import { round2 } from '../lib/currency'
import { localDay } from '../lib/dates'
import { parseTxnId } from '../lib/sms'
import { SHIFT_STATUS } from '../db/constants'

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

    // Por area de venta (Bloque 20). Se agrupa por el AREA DONDE SE COBRO la
    // venta (s.area), que es donde rebaja el stock. Las "ventas cruzadas" quedan
    // retiradas: solo se cuentan las ventas previas marcadas (dato historico).
    const users = await db.users.toArray()
    const nameOf = Object.fromEntries(users.map((u) => [u.id, u.name]))
    const areaAgg = {}
    const crossBySeller = {}
    let crossRevenue = 0
    let crossCount = 0
    for (const s of sales) {
      const saleArea = String(s.area || '')
      const key = saleArea || '__none'
      const e = areaAgg[key] || (areaAgg[key] = { area: saleArea, revenue: 0, profit: 0, qty: 0 })
      let saleRev = 0
      for (const it of s.items || []) {
        const lineRev = Number(it.lineTotal ?? it.unitPrice * it.qty)
        const lineCost = Number((it.unitCost || 0) * it.qty)
        e.revenue += lineRev
        e.profit += lineRev - lineCost
        e.qty += Number(it.qty)
        saleRev += lineRev
      }
      // Solo ventas previas explicitamente marcadas como cruzadas (legado).
      if (s.hasCrossArea) {
        crossCount++
        crossRevenue += saleRev
        const cs = crossBySeller[s.sellerId] ||
          (crossBySeller[s.sellerId] = { sellerId: s.sellerId, seller: nameOf[s.sellerId] || 'vendedor', revenue: 0, qty: 0 })
        cs.revenue += saleRev
        cs.qty += 1
      }
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
      if (s.paymentMethod === 'mixed' && Array.isArray(s.payments)) {
        // Pago mixto (Bloque H): cada parte reparte a su metodo (en base).
        for (const p of s.payments) {
          const ab = Number(p.amountBase ?? p.amount ?? 0)
          if (p.method === 'transfer') byMethod.transfer += ab
          else byMethod.cash += ab
        }
      } else if (s.paymentMethod === 'transfer') byMethod.transfer += t
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
  },

  // ---------------------------------------------------------------------------
  // Auditoria de cuadre (Bloque 2). Todo SOLO LECTURA: deriva de ventas/turnos,
  // no muta ni escribe nada. Alimenta la pestaña "Auditoria" del panel del dueño.
  // ---------------------------------------------------------------------------

  // 1) Transferencias: lo que se DEBIO cobrar (transferExpected) vs lo CONTABILIZADO
  //    (transferAmount, leido del SMS), por moneda, en el rango. Lista las ventas con
  //    diferencia (transferDiff != 0) para ubicar el descuadre.
  async transferReconciliation({ from = null, to = null } = {}) {
    const users = await db.users.toArray()
    const nameOf = Object.fromEntries(users.map((u) => [u.id, u.name]))
    const sales = (await db.sales.toArray()).filter(
      (s) => !s.voided && s.paymentMethod === 'transfer' && inRange(s.createdAt, from, to)
    )
    const cur = {}
    const mismatches = []
    for (const s of sales) {
      const c = s.transferCurrency || 'MN'
      const e = cur[c] || (cur[c] = { currency: c, expected: 0, received: 0, count: 0 })
      e.expected += Number(s.transferExpected || 0)
      e.received += Number(s.transferAmount || 0)
      e.count += 1
      if (Math.abs(Number(s.transferDiff || 0)) >= 0.01) {
        mismatches.push({
          id: s.id,
          createdAt: s.createdAt,
          seller: nameOf[s.sellerId] || 'vendedor',
          items: (s.items || []).map((it) => `${it.qty}x ${it.name}`).join(', '),
          currency: c,
          expected: round2(Number(s.transferExpected || 0)),
          received: round2(Number(s.transferAmount || 0)),
          diff: round2(Number(s.transferDiff || 0))
        })
      }
    }
    const byCurrency = Object.values(cur).map((e) => ({
      currency: e.currency,
      expected: round2(e.expected),
      received: round2(e.received),
      diff: round2(e.received - e.expected),
      count: e.count
    }))
    mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    return { byCurrency, mismatches }
  },

  // 2) Duplicados por Nº de Transaccion del banco: el MISMO comprobante (mismo Nº en
  //    el SMS) reusado en 2+ ventas => el dinero entro una sola vez. Barre TODO el
  //    historial (no depende del rango) para no perder pares en fechas distintas.
  //    Marca "suspicious" la venta cuyo recibido != total vendido (comprobante ajeno).
  async duplicateTransfers() {
    const users = await db.users.toArray()
    const nameOf = Object.fromEntries(users.map((u) => [u.id, u.name]))
    const sales = (await db.sales.toArray()).filter(
      (s) => !s.voided && s.paymentMethod === 'transfer'
    )
    const groups = {}
    for (const s of sales) {
      const txn = parseTxnId(s.transferSms)
      if (!txn) continue
      if (!groups[txn]) groups[txn] = []
      groups[txn].push(s)
    }
    const out = []
    for (const [txn, arr] of Object.entries(groups)) {
      if (arr.length < 2) continue
      arr.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      out.push({
        txn,
        currency: arr[0].transferCurrency || 'MN',
        amount: round2(Number(arr[0].transferAmount || 0)),
        sales: arr.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          seller: nameOf[s.sellerId] || 'vendedor',
          items: (s.items || []).map((it) => `${it.qty}x ${it.name}`).join(', '),
          expected: round2(Number(s.transferExpected || 0)),
          received: round2(Number(s.transferAmount || 0)),
          // Sospechosa: lo recibido NO coincide con lo esperado (mismo comprobante, otra venta).
          suspicious: Math.abs(Number(s.transferAmount || 0) - Number(s.transferExpected || 0)) >= 0.01
        }))
      })
    }
    out.sort((a, b) => b.amount - a.amount)
    return out
  },

  // 3) Efectivo: esperado vs declarado por TURNO CERRADO en el rango (los abiertos aun
  //    no tienen conteo declarado). Devuelve todos con su semaforo; la UI resalta los
  //    que no cuadran. Deriva del registro del turno (no muta).
  async cashReconciliation({ from = null, to = null } = {}) {
    const users = await db.users.toArray()
    const nameOf = Object.fromEntries(users.map((u) => [u.id, u.name]))
    const shifts = (await db.shifts.toArray()).filter(
      (s) => s.status === SHIFT_STATUS.CLOSED && inRange(s.closedAt, from, to)
    )
    return shifts
      .map((s) => ({
        shiftId: s.id,
        closedAt: s.closedAt,
        seller: nameOf[s.sellerId] || 'vendedor',
        area: s.area || '',
        expected: round2(s.expectedCash?.MN ?? 0),
        declared: round2(s.declaredCash?.MN ?? 0),
        diff: round2(s.difference?.MN ?? 0),
        semaphore: s.semaphore || null,
        forced: !!s.forced,
        countSkipped: !!s.countSkipped
      }))
      .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))
  },

  // 4) Integridad: ventas ANULADAS, cierres FORZADOS y ventas POST-CIERRE en el rango.
  //    Misma derivacion que los reportes homonimos de reportsService (solo lectura).
  async integrityFlags({ from = null, to = null } = {}) {
    const users = await db.users.toArray()
    const nameOf = Object.fromEntries(users.map((u) => [u.id, u.name]))
    const allSales = await db.sales.toArray()
    const shiftsById = {}
    for (const sh of await db.shifts.toArray()) shiftsById[sh.id] = sh

    const voided = allSales
      .filter((s) => s.voided && inRange(s.createdAt, from, to))
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        seller: nameOf[s.sellerId] || 'vendedor',
        items: (s.items || []).map((it) => `${it.qty}x ${it.name}`).join(', '),
        total: round2(Number(s.totalBase || 0))
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

    const forced = (await db.shifts.toArray())
      .filter((s) => s.status === SHIFT_STATUS.CLOSED && s.forced === true && inRange(s.closedAt, from, to))
      .map((s) => ({
        shiftId: s.id,
        closedAt: s.closedAt,
        seller: nameOf[s.sellerId] || 'vendedor',
        closedBy: (s.closedBy && nameOf[s.closedBy]) || 'mando',
        area: s.area || '',
        diff: round2(s.difference?.MN ?? 0),
        semaphore: s.semaphore || null
      }))
      .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))

    const postClose = []
    for (const s of allSales) {
      if (s.voided || !inRange(s.createdAt, from, to)) continue
      const sh = shiftsById[s.shiftId]
      if (!sh || sh.status !== SHIFT_STATUS.CLOSED || !sh.closedAt) continue
      if (!(s.createdAt > sh.closedAt)) continue
      postClose.push({
        id: s.id,
        createdAt: s.createdAt,
        seller: nameOf[s.sellerId] || 'vendedor',
        area: s.area || '',
        total: round2(Number(s.totalBase || 0)),
        shiftClosedAt: sh.closedAt
      })
    }
    postClose.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

    return { voided, forced, postClose }
  }
}
