import { round2, formatMoney } from './currency.js'
import { cleanQty } from './qty.js'
import { findAtomicityBreaks } from './atomicity.js'
import { WAREHOUSE, ORDER_STATUS } from '../db/constants.js'

// ---------------------------------------------------------------------------
// Control de Ventas Diarias (Burger Premium; spec
// docs/superpowers/specs/2026-09-24-control-ventas-diarias-design.md). PURO.
//
// Es el documento PRIMARIO del cliente: todo sale del LIBRO MAYOR (stockMovements),
// nunca de la cache. Cada movimiento se clasifica con el ledgerKey de reportsService,
// que se INYECTA (`classify`): una sola fuente de verdad. La fila cuadra por
// construccion y el dia siguiente arranca donde acabo el anterior. El reporte imprime
// sus controles: dinero, cache e integridad del libro.
// ---------------------------------------------------------------------------
export const MAX_DAYS = 31
export const HEAD = ['Producto', 'Saldo inicio', 'Entrada', 'Salida', 'Merma', 'Venta', 'Ajuste', 'Precio', 'Importe', 'Saldo final']
const KEYS = ['compras', 'traspIn', 'producido', 'ventas', 'traspOut', 'consumo', 'deuda', 'terceros', 'merma', 'cargaIni', 'ajustes']
const emptyG = () => Object.fromEntries([...KEYS, 'otros'].map((k) => [k, 0]))
const locOf = (m) => m.location || WAREHOUSE // el criterio del submayor y de recomputeStock
const saleLocOf = (s) => s.sourceLocation || s.area || WAREHOUSE
const folioOf = (id) => String(id || '').slice(-6).toUpperCase()
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const dayMs = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))

export function daysBetween(from, to) {
  if (!DAY_RE.test(from || '')) throw new Error('Elige la fecha «Desde».')
  const end = to || from
  if (!DAY_RE.test(end)) throw new Error('La fecha «Hasta» no es válida.')
  if (end < from) throw new Error('«Hasta» es anterior a «Desde».')
  const out = []
  for (let t = dayMs(from); t <= dayMs(end); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
    if (out.length > MAX_DAYS) throw new Error(`El rango pasa de ${MAX_DAYS} días: acórtalo.`)
  }
  return out
}

function columnsOf(g) {
  return {
    entrada: cleanQty(g.compras + g.traspIn + g.producido),
    salida: cleanQty(-(g.traspOut + g.consumo + g.deuda + g.terceros)),
    merma: cleanQty(-g.merma),
    venta: cleanQty(-g.ventas),
    ajuste: cleanQty(g.ajustes + g.cargaIni + g.otros)
  }
}
const ZERO = { entrada: 0, salida: 0, merma: 0, venta: 0, ajuste: 0 }

export function buildDailyControl({
  products = [], movements = [], sales = [], shifts = [], users = [], orders = [], priceChanges = [],
  productions = [], purchases = [], transfers = [], orderItems = [],
  location, categoryId = '', from, to, classify, priceOf, dayOf, today = ''
} = {}) {
  if (!location) throw new Error('Elige la ubicación.')
  if (typeof classify !== 'function' || typeof priceOf !== 'function' || typeof dayOf !== 'function') {
    throw new Error('Faltan dependencias del reporte')
  }
  const days = daysBetween(from, to)
  const first = days[0]
  const last = days[days.length - 1]
  const byId = new Map(products.map((p) => [p.id, p]))
  const inCat = (pid) => !categoryId || byId.get(pid)?.categoryId === categoryId
  const nameOf = (pid) => byId.get(pid)?.name || `(producto ${String(pid).slice(0, 8)})`

  // Movimientos de ESTA ubicacion (y categoria), por producto.
  const byProd = new Map()
  for (const m of movements) {
    if (locOf(m) !== location || !inCat(m.productId)) continue
    if (!byProd.has(m.productId)) byProd.set(m.productId, [])
    byProd.get(m.productId).push(m)
  }
  const pids = [...byProd.keys()].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'es') || (a < b ? -1 : 1))

  let unclassified = 0
  const state = new Map() // pid -> { saldo (al empezar el rango), perDay: Map(dia -> g) }
  for (const pid of pids) {
    let saldo = 0
    const perDay = new Map()
    for (const m of byProd.get(pid)) {
      const q = Number(m.qty || 0)
      const d = dayOf(m.createdAt)
      if (d < first) { saldo += q; continue }
      if (d > last) continue
      if (!perDay.has(d)) perDay.set(d, emptyG())
      const g = perDay.get(d)
      const k = classify(m)
      if (KEYS.includes(k)) g[k] += q
      else { g.otros += q; unclassified++ }
    }
    state.set(pid, { saldo: cleanQty(saldo), perDay })
  }

  // Integridad del libro (lo aprendido en Burger/La Patrona): se reutiliza atomicity.js.
  const breaks = findAtomicityBreaks({ stockMovements: movements, sales, productions, purchases, transfers, orderItems })
    .filter((b) => { const d = b.at ? dayOf(b.at) : ''; return d >= first && d <= last })
  const counts = {}
  for (const b of breaks) counts[b.kind] = (counts[b.kind] || 0) + 1
  const saleById = new Map(sales.map((s) => [s.id, s]))
  const saleSinMovByDay = new Map()
  const movById = new Map(movements.map((m) => [m.id, m]))
  const orphanVoidByDay = new Map()
  for (const b of breaks) {
    if (b.kind !== 'mov-anulacion-sin-linea') continue
    const m = movById.get(b.id)
    if (!m || locOf(m) !== location || !inCat(m.productId)) continue
    const d = dayOf(m.createdAt)
    orphanVoidByDay.set(d, (orphanVoidByDay.get(d) || 0) + Number(m.qty || 0))
  }
  const liveSaleByOrder = new Map()
  for (const s of sales) if (s.orderId && !s.voided) liveSaleByOrder.set(s.orderId, s)
  for (const b of breaks) {
    if (b.kind !== 'sale-sin-mov') continue
    const s = saleById.get(b.id)
    if (!s || saleLocOf(s) !== location) continue
    const d = dayOf(s.createdAt)
    saleSinMovByDay.set(d, (saleSinMovByDay.get(d) || 0) + 1)
  }

  const userName = new Map(users.map((u) => [u.id, u.name]))
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const outDays = []
  for (const day of days) {
    const rows = []
    const totals = { entrada: 0, salida: 0, merma: 0, venta: 0, ajuste: 0, importe: 0 }
    for (const pid of pids) {
      const st = state.get(pid)
      const g = st.perDay.get(day)
      const inicio = st.saldo
      const c = g ? columnsOf(g) : ZERO
      const final = cleanQty(inicio + c.entrada - c.salida - c.merma - c.venta + c.ajuste)
      st.saldo = final
      if (inicio === 0 && !g && final === 0) continue
      const p = byId.get(pid)
      const precio = p ? round2(priceOf(p)) : 0
      const importe = round2(c.venta * precio)
      rows.push({ productId: pid, name: nameOf(pid), unit: p?.unit || '', inicio, ...c, precio, importe, final })
      for (const k of ['entrada', 'salida', 'merma', 'venta', 'ajuste']) totals[k] = cleanQty(totals[k] + c[k])
      totals.importe = round2(totals.importe + importe)
    }

    // Cabecera: turnos de ESTA ubicacion que tocan el dia.
    const dayShifts = shifts
      .filter((s) => (s.area || WAREHOUSE) === location && dayOf(s.openedAt) <= day && (!s.closedAt || dayOf(s.closedAt) >= day))
      .sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1))
    const folios = dayShifts.map((s) => folioOf(s.id))
    const sellers = [...new Set(dayShifts.map((s) => userName.get(s.sellerId) || 'Sin nombre'))]

    // Control de dinero: consumo COBRADO (lineas a precio congelado) vs suma de Importes.
    const daySales = sales.filter((s) => !s.voided && dayOf(s.createdAt) === day && saleLocOf(s) === location)
    let consumo = 0, servicio = 0, descuento = 0, cobrado = 0
    for (const s of daySales) {
      for (const it of s.items || []) if (inCat(it.productId)) consumo += Number(it.lineTotal || 0)
      servicio += Number(s.serviceChargeAmount || 0)
      descuento += Number(s.discountAmount || 0)
      cobrado += Number(s.totalBase || 0)
    }
    consumo = round2(consumo)
    const diferencia = round2(totals.importe - consumo)
    const causas = []
    if (diferencia !== 0) {
      // Precio: SOLO si alguna linea se cobro a un precio unitario distinto del de la
      // ficha (revision con el dato real de Burger: un cambio de precio que no produce
      // diferencia no se nombra, porque la explicacion seria enganosa).
      const priceDiff = new Set()
      for (const s of daySales) for (const it of s.items || []) {
        const p = byId.get(it.productId)
        if (!p || !inCat(it.productId) || !(Number(it.qty) > 0)) continue
        if (round2(Number(it.lineTotal || 0) / Number(it.qty)) !== round2(priceOf(p))) priceDiff.add(it.productId)
      }
      if (priceDiff.size) causas.push(`precio cobrado distinto del de la ficha en ${priceDiff.size} producto(s): el Importe usa el precio de la ficha de hoy`)
      // Lineas de mesa anuladas DESPUES de cobrar (el H1 de Burger): el libro devolvio
      // esas unidades al stock pero la venta sigue cobrada. Se cuentan el dia de la anulacion.
      let tras = 0
      const mesasTras = new Set()
      for (const it of orderItems) {
        if (!it.voided || !it.voidedAt || dayOf(it.voidedAt) !== day || !inCat(it.productId)) continue
        const o = orderById.get(it.orderId)
        if (!o || (o.area || WAREHOUSE) !== location) continue
        const sale = liveSaleByOrder.get(it.orderId)
        if (sale && sale.createdAt < it.voidedAt) { tras += Number(it.qty || 0); mesasTras.add(it.orderId) }
      }
      if (tras) causas.push(`${cleanQty(tras)} unidad(es) anulada(s) después de cobrar en ${mesasTras.size} mesa(s): el libro las devolvió al stock y la venta sigue cobrada`)
      // Movimientos de anulacion sin su linea anulada (atomicity.js), de este dia y ubicacion.
      const huerf = orphanVoidByDay.get(day) || 0
      if (huerf) causas.push(`movimiento de anulación sin línea: ${cleanQty(huerf)} unidad(es) devueltas al stock sin su línea anulada`)
      const cruzadas = daySales.filter((s) => s.orderId && orderById.get(s.orderId) && dayOf(orderById.get(s.orderId).openedAt) !== day).length
      const pendientes = orders.filter((o) => (o.area || WAREHOUSE) === location && dayOf(o.openedAt) === day && o.closedAt && dayOf(o.closedAt) > day).length
      if (cruzadas) causas.push(`${cruzadas} mesa(s) cobrada(s) este día con consumo de otro día`)
      if (pendientes) causas.push(`${pendientes} mesa(s) con consumo de este día cobrada(s) otro día`)
      if (day === today) {
        const abiertas = orders.filter((o) => o.status === ORDER_STATUS.OPEN && (o.area || WAREHOUSE) === location).length
        if (abiertas) causas.push(`${abiertas} mesa(s) abierta(s) ahora: consumo aún sin cobrar`)
      }
      const sm = saleSinMovByDay.get(day) || 0
      if (sm) causas.push(`${sm} venta(s) sin movimiento de stock en este aparato: la Venta del libro sale corta`)
    }
    outDays.push({
      day, folios, sellers, rows, totals,
      money: { importe: totals.importe, consumo, diferencia, cuadra: diferencia === 0, servicio: round2(servicio), descuento: round2(descuento), cobrado: round2(cobrado), causas }
    })
  }

  // Control de la cache: existencia actual segun el libro (todo el historial) vs cache.
  const diffs = []
  for (const pid of pids) {
    const libro = cleanQty(byProd.get(pid).reduce((a, m) => a + Number(m.qty || 0), 0))
    const cache = cleanQty(Number(byId.get(pid)?.stockByLocation?.[location] ?? 0))
    if (libro !== cache) diffs.push({ name: nameOf(pid), libro, cache })
  }

  return {
    days: outDays,
    cacheCheck: { ok: diffs.length === 0, diffs },
    integrity: { ok: breaks.length === 0, counts },
    unclassified
  }
}

// Formato para exportExcel/exportPdf: una sola tabla con un separador por dia,
// el total del dia y las lineas de control. 10 celdas por fila siempre.
export function dailyControlReport(result, { locationName = '', categoryName = '', from = '', to = '' } = {}) {
  // Lineas de texto A LO ANCHO (colSpan): no ensanchan la columna Producto del PDF.
  const pad = (text) => [{ content: text, colSpan: HEAD.length }]
  const fm = (n) => formatMoney(n)
  const rows = []
  for (const d of result.days) {
    rows.push(pad(`${d.day} · ID de venta: ${d.folios.join(', ') || '—'} · Entregado por: ${d.sellers.join(', ') || '—'}`))
    if (!d.rows.length) rows.push(pad('Sin existencias ni movimientos en esta ubicación'))
    for (const r of d.rows) rows.push([r.name, r.inicio, r.entrada, r.salida, r.merma, r.venta, r.ajuste, fm(r.precio), fm(r.importe), r.final])
    const t = d.totals
    rows.push(['TOTAL DEL DÍA', '', t.entrada, t.salida, t.merma, t.venta, t.ajuste, '', fm(t.importe), ''])
    const m = d.money
    rows.push(pad(`Control de dinero: Importe ${fm(m.importe)} · consumo cobrado ${fm(m.consumo)} · ${m.cuadra ? 'CUADRA' : 'NO CUADRA, diferencia ' + fm(m.diferencia)}`))
    rows.push(pad(`Cobrado total ${fm(m.cobrado)} (incluye servicio ${fm(m.servicio)} y descuentos ${fm(m.descuento)})`))
    for (const c of m.causas) rows.push(pad(`  Causa: ${c}`))
  }
  const cc = result.cacheCheck
  rows.push(pad(cc.ok ? 'Control de la caché: CUADRA (la caché coincide con el libro)' : `Control de la caché: ${cc.diffs.length} producto(s) con la caché distinta del libro (el reporte usa el libro)`))
  for (const x of cc.diffs) rows.push(pad(`  ${x.name}: libro ${x.libro} · caché ${x.cache}`))
  const it = result.integrity
  rows.push(pad(it.ok ? 'Integridad del libro: CUADRA' : `Integridad del libro: NO CUADRA — ${Object.entries(it.counts).map(([k, n]) => `${k} ${n}`).join(', ')}`))
  if (result.unclassified) rows.push(pad(`Movimientos sin clasificar (sumados en Ajuste): ${result.unclassified}`))
  const range = to && to !== from ? `${from} a ${to}` : from
  return {
    title: 'Control de Ventas Diarias',
    subtitle: `${locationName}${categoryName ? ' · ' + categoryName : ''} · ${range}`,
    head: HEAD,
    rows,
    filename: 'control_ventas_diarias',
    orientation: 'landscape'
  }
}
