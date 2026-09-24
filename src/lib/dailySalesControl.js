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
  location, categoryId = '', from, to, classify, priceOf, dayOf, today = '', locLabel = (l) => l
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
  const orphanIds = new Set(breaks.filter((b) => b.kind === 'mov-anulacion-sin-linea').map((b) => b.id))
  // Por pedido, la venta VALIDA es la primera viva (por instante, y por id si empatan);
  // cualquier otra viva del mismo pedido es un cobro duplicado (auditoria pre-main, I2).
  const liveSalesByOrder = new Map()
  for (const s of sales) {
    if (!s.orderId || s.voided) continue
    if (!liveSalesByOrder.has(s.orderId)) liveSalesByOrder.set(s.orderId, [])
    liveSalesByOrder.get(s.orderId).push(s)
  }
  const liveSaleByOrder = new Map()
  for (const [oid, l] of liveSalesByOrder) {
    l.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
    liveSaleByOrder.set(oid, l[0])
  }

  const userName = new Map(users.map((u) => [u.id, u.name]))
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const priceP = (pid) => (byId.get(pid) ? round2(priceOf(byId.get(pid))) : 0)
  // Unidades netas de venta por pedido y dia (de ESTA ubicacion y categoria): un hecho.
  const orderDayUnits = new Map()
  for (const pid of pids) {
    for (const m of byProd.get(pid)) {
      if ((m.refType !== 'order' && m.refType !== 'order_void') || classify(m) !== 'ventas') continue
      const mp = orderDayUnits.get(m.refId) || new Map()
      const d = dayOf(m.createdAt)
      mp.set(d, (mp.get(d) || 0) - Number(m.qty || 0))
      orderDayUnits.set(m.refId, mp)
    }
  }
  const unitsInCat = (s) => (s.items || []).reduce((a, it) => a + (inCat(it.productId) ? Number(it.qty || 0) : 0), 0)
  const outDays = []
  for (const day of days) {
    const rows = []
    const totals = { entrada: 0, salida: 0, merma: 0, venta: 0, ajuste: 0, importe: 0 }
    let importeRaw = 0
    const ventaClean = new Map()
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
      importeRaw += c.venta * precio
      ventaClean.set(pid, c.venta)
    }

    totals.importe = round2(importeRaw)

    // Cabecera: turnos de ESTA ubicacion que tocan el dia.
    const dayShifts = shifts
      .filter((s) => (s.area || WAREHOUSE) === location && dayOf(s.openedAt) <= day && (!s.closedAt || dayOf(s.closedAt) >= day))
      .sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1))
    const folios = dayShifts.map((s) => folioOf(s.id))
    const sellers = [...new Set(dayShifts.map((s) => userName.get(s.sellerId) || 'Sin nombre'))]

    // Control de dinero: consumo COBRADO (lineas a precio congelado) vs suma de Importes.
    const daySales = sales.filter((s) => !s.voided && dayOf(s.createdAt) === day && saleLocOf(s) === location)
    let servicio = 0, descuento = 0, cobrado = 0
    for (const s of daySales) {
      servicio += Number(s.serviceChargeAmount || 0)
      descuento += Number(s.discountAmount || 0)
      cobrado += Number(s.totalBase || 0)
    }
    // CONTROL DE DINERO DESCRIPTIVO. Tres revisiones independientes mostraron que inferir la
    // CAUSA desde los totales del libro es ambiguo (cada ronda encontro causas falsas), asi
    // que el control NO interpreta: descompone la diferencia EXACTAMENTE y muestra HECHOS.
    // Cada linea cobrada se parte sin resto:
    //   lineTotal = qty x ficha - qty x (ficha - precio cobrado) - (qty x precio cobrado - lineTotal)
    // y por eso  Importe - consumo cobrado = PRECIO + REDONDEO + Σ (libro - cobrado) x ficha,
    // con el descuadre de unidades listado por mesa o venta y producto, junto a sus hechos.
    const groups = new Map()
    const G = (k) => {
      if (!groups.has(k)) groups.set(k, { k, prods: new Map(), cons: 0, voids: 0, voidsAfter: 0, orphans: 0 })
      return groups.get(k)
    }
    const GP = (g, pid) => {
      if (!g.prods.has(pid)) g.prods.set(pid, { libro: 0, cobrado: 0, sinCantidad: 0 })
      return g.prods.get(pid)
    }
    const rawV = new Map()
    for (const pid of pids) {
      for (const m of byProd.get(pid)) {
        if (dayOf(m.createdAt) !== day || classify(m) !== 'ventas') continue
        const q = -Number(m.qty || 0) // unidades vendidas (positivo); una anulacion resta
        rawV.set(pid, (rawV.get(pid) || 0) + q)
        const isOrder = m.refType === 'order' || m.refType === 'order_void'
        const g = G(isOrder ? 'O:' + m.refId : m.refType === 'sale' ? 'S:' + m.refId : 'X:' + m.id)
        GP(g, pid).libro += q
        if (m.refType === 'order') g.cons += q
        if (m.refType === 'order_void') {
          g.voids -= q
          const first = liveSaleByOrder.get(m.refId)
          if (first && first.createdAt < m.createdAt) g.voidsAfter -= q
          if (orphanIds.has(m.id)) g.orphans -= q
        }
      }
    }
    let precioAmt = 0, redondeoAmt = 0
    const precioDet = new Map()
    for (const s of daySales) {
      const g = G(s.orderId ? 'O:' + s.orderId : 'S:' + s.id)
      for (const it of s.items || []) {
        if (!inCat(it.productId)) continue
        const x = GP(g, it.productId)
        const P = priceP(it.productId)
        const qty = Number(it.qty || 0)
        const lt = Number(it.lineTotal ?? (Number(it.unitPrice || 0) * qty))
        if (!qty) { x.sinCantidad += lt; continue } // cobrado sin cantidad: un hecho de la venta
        x.cobrado += qty
        // Sin precio unitario (en los respaldos reales no falta nunca): si el cobro es el de la
        // ficha redondeado al centavo, el precio es el de la ficha; si no, el efectivo.
        const up = it.unitPrice != null ? Number(it.unitPrice) : Math.abs(lt - round2(qty * P)) <= 0.005 + 1e-9 ? P : lt / qty
        redondeoAmt += qty * up - lt
        if (Math.abs(up - P) >= 0.005) {
          precioAmt += qty * (P - up)
          const dk = it.productId + '|' + up
          const d = precioDet.get(dk) || { productId: it.productId, name: nameOf(it.productId), unitPrice: up, ficha: P, qty: 0, lineas: 0, amount: 0 }
          d.qty = cleanQty(d.qty + qty); d.lineas += 1; d.amount += qty * (P - up)
          precioDet.set(dk, d)
        } else redondeoAmt += qty * (P - up) // el precio congelado difiere de la ficha en menos de medio centavo
      }
    }
    // Las cantidades del Importe van a la milesima (cleanQty); su diferencia con el libro en
    // crudo es redondeo de cantidad.
    for (const [pid, v] of rawV) redondeoAmt += ((ventaClean.get(pid) || 0) - v) * priceP(pid)
    const grupos = []
    let unidadesAmt = 0
    for (const g of groups.values()) {
      const tipo = g.k.slice(0, 1)
      const id = g.k.slice(2)
      let amount = 0
      const productos = []
      for (const [pid, x] of g.prods) {
        const a = (x.libro - x.cobrado) * priceP(pid) - x.sinCantidad
        if (Math.abs(x.libro - x.cobrado) < 0.0005 && !x.sinCantidad) { redondeoAmt += a; continue } // ruido de la milesima
        amount += a
        productos.push({ productId: pid, name: nameOf(pid), libro: cleanQty(x.libro), cobrado: cleanQty(x.cobrado), ...(x.sinCantidad ? { sinCantidad: round2(x.sinCantidad) } : {}) })
      }
      unidadesAmt += amount
      if (!productos.length) continue
      productos.sort((p1, p2) => p1.name.localeCompare(p2.name, 'es'))
      let kind, label, hechos
      if (tipo === 'O') {
        const o = orderById.get(id)
        kind = 'mesa'
        label = o ? `${o.table || 'Mesa ?'} · pedido ${String(id).slice(0, 8)}` : `Pedido ${String(id).slice(0, 8)} (sin cabecera en este aparato)`
        hechos = {
          estado: o?.status || null,
          cobros: (liveSalesByOrder.get(id) || []).map((sl) => ({ id: sl.id, day: dayOf(sl.createdAt), units: cleanQty(unitsInCat(sl)) })),
          hoy: { consumo: cleanQty(g.cons), anuladas: cleanQty(g.voids), anuladasTrasCobro: cleanQty(g.voidsAfter), marcadasSinLinea: cleanQty(g.orphans) },
          otrosDias: [...(orderDayUnits.get(id) || new Map())].filter(([d, u]) => d !== day && Math.abs(u) >= 0.0005).sort((p1, p2) => (p1[0] < p2[0] ? -1 : 1)).map(([d, u]) => ({ day: d, units: cleanQty(u) }))
        }
      } else if (tipo === 'S') {
        const sl = saleById.get(id)
        kind = 'venta'
        label = `Venta ${folioOf(id)}`
        hechos = {
          venta: !sl ? 'no-esta' : sl.voided ? 'anulada' : dayOf(sl.createdAt) !== day ? 'otro-dia' : saleLocOf(sl) !== location ? 'otra-ubicacion' : 'ok',
          dia: sl ? dayOf(sl.createdAt) : null,
          ubicacion: sl ? locLabel(saleLocOf(sl)) : null
        }
      } else {
        kind = 'suelto'
        label = `Movimiento de venta sin pedido ni venta (${String(id).slice(0, 8)})`
        hechos = {}
      }
      grupos.push({ kind, id, label, amount: round2(amount), productos, hechos })
    }
    grupos.sort((g1, g2) => g1.label.localeCompare(g2.label, 'es'))
    let consumo = 0
    for (const s of daySales) for (const it of s.items || []) if (inCat(it.productId)) consumo += Number(it.lineTotal ?? (Number(it.unitPrice || 0) * Number(it.qty || 0)))
    const consumoRaw = consumo
    consumo = round2(consumo)
    const diferencia = round2(totals.importe - consumo)
    // Comprobacion de construccion: las partes en crudo TIENEN que ser la diferencia en crudo.
    // Lo que no cuadre es un fallo de esta logica y sale como "Sin explicar".
    const descuadre = (importeRaw - consumoRaw) - (precioAmt + redondeoAmt + unidadesAmt)
    const precioR = round2(precioAmt)
    const unidadesR = round2(unidadesAmt)
    const sinExplicar = Math.abs(descuadre) >= 0.005 ? round2(descuadre) : 0
    // El redondeo impreso absorbe el de los totales y el de las partes impresas: asi las partes
    // IMPRESAS suman la diferencia impresa.
    const redondeoR = round2(diferencia - sinExplicar - precioR - unidadesR)
    const precio = { n: [...precioDet.values()].reduce((a, d) => a + d.lineas, 0), amount: precioR, detalle: [...precioDet.values()].map((d) => ({ ...d, amount: round2(d.amount) })).sort((d1, d2) => d1.name.localeCompare(d2.name, 'es')) }
    outDays.push({
      day, folios, sellers, rows, totals,
      money: {
        importe: totals.importe, consumo, diferencia, cuadra: diferencia === 0,
        soloRedondeo: diferencia !== 0 && precioR === 0 && unidadesR === 0 && !grupos.length && !precio.n && sinExplicar === 0,
        servicio: round2(servicio), descuento: round2(descuento), cobrado: round2(cobrado), cobradoTodasCategorias: !!categoryId,
        precio, redondeo: redondeoR, unidades: { amount: unidadesR, grupos }, sinExplicar
      }
    })
  }

  // Control de la cache: existencia actual segun el libro (todo el historial) vs cache.
  const diffs = []
  for (const pid of pids) {
    const libro = cleanQty(byProd.get(pid).reduce((a, m) => a + Number(m.qty || 0), 0))
    const cache = cleanQty(Number(byId.get(pid)?.stockByLocation?.[location] ?? 0))
    if (libro !== cache) diffs.push({ name: nameOf(pid), libro, cache })
  }
  // Y los productos con cache en esta ubicacion pero NINGUN movimiento en ella: su libro es 0.
  for (const p of products) {
    if (byProd.has(p.id) || !inCat(p.id)) continue
    const cache = cleanQty(Number(p.stockByLocation?.[location] ?? 0))
    if (cache !== 0) diffs.push({ name: nameOf(p.id), libro: 0, cache })
  }
  diffs.sort((a, b) => a.name.localeCompare(b.name, 'es'))

  return {
    days: outDays,
    cacheCheck: { ok: diffs.length === 0, diffs },
    integrity: { ok: breaks.length === 0, counts },
    unclassified
  }
}

// Lineas del control de dinero de un dia. Solo HECHOS: la descomposicion exacta de la
// diferencia y, por mesa o venta, lo que dice el libro y lo que se cobro. No nombra causas.
const ESTADO = { open: 'ocupada', reserved: 'reservada', closed: 'cobrada', voided: 'anulada' }
const VENTA = { 'no-esta': 'la venta no está en este aparato', anulada: 'venta anulada', 'otro-dia': 'venta de otro día', 'otra-ubicacion': 'venta de otra ubicación', ok: '' }
const u = (n) => `${n} u`
export function moneyLines(m, day) {
  const fm = (n) => formatMoney(n)
  const out = []
  const estado = m.cuadra ? 'CUADRA' : m.soloRedondeo ? `NO CUADRA solo por redondeo al centavo, diferencia ${fm(m.diferencia)}` : `NO CUADRA, diferencia ${fm(m.diferencia)}`
  out.push(`Control de dinero: Importe ${fm(m.importe)} · consumo cobrado ${fm(m.consumo)} · ${estado}`)
  out.push(`Cobrado total ${fm(m.cobrado)} (incluye servicio ${fm(m.servicio)} y descuentos ${fm(m.descuento)})${m.cobradoTodasCategorias ? ' · de las ventas completas, todas las categorías' : ''}`)
  const hay = m.precio.n || m.unidades.grupos.length || m.redondeo !== 0 || m.sinExplicar !== 0
  if (!hay) return out
  out.push('  Desglose exacto de la diferencia (hechos del libro y del cobro, sin interpretar):')
  if (m.precio.n) {
    out.push(`  · Precio distinto de la ficha: ${m.precio.n} línea(s), ${fm(m.precio.amount)}`)
    for (const d of m.precio.detalle) out.push(`      ${d.name}: ${u(d.qty)} cobradas a ${fm(d.unitPrice)} (ficha ${fm(d.ficha)}) → ${fm(d.amount)}`)
  }
  if (m.redondeo !== 0) out.push(`  · Redondeo al centavo: ${fm(m.redondeo)}`)
  if (m.unidades.grupos.length) {
    out.push(`  · Unidades del libro distintas de las cobradas este día (× precio de ficha): ${m.unidades.grupos.length} mesa(s)/venta(s), ${fm(m.unidades.amount)}`)
    for (const g of m.unidades.grupos) {
      const h = g.hechos
      const hechos = []
      if (g.kind === 'mesa') {
        hechos.push(`estado actual: ${h.estado ? ESTADO[h.estado] || h.estado : 'sin cabecera'}`)
        hechos.push(h.cobros.length ? `cobro(s): ${h.cobros.map((c) => `${c.day} (${u(c.units)})`).join(', ')}` : 'sin cobro')
        const hoy = [`consumo ${u(h.hoy.consumo)}`]
        if (h.hoy.anuladas) hoy.push(`anuladas ${u(h.hoy.anuladas)}${h.hoy.anuladasTrasCobro ? ` (${u(h.hoy.anuladasTrasCobro)} después del primer cobro)` : ''}`)
        if (h.hoy.marcadasSinLinea) hoy.push(`${u(h.hoy.marcadasSinLinea)} anuladas que el control de integridad marca sin su línea`)
        hechos.push(`este día: ${hoy.join(', ')}`)
        if (h.otrosDias.length) hechos.push(`otros días en el libro: ${h.otrosDias.map((x) => `${x.day} ${x.units > 0 ? '+' : ''}${u(x.units)}`).join(', ')}`)
      } else if (g.kind === 'venta') {
        if (VENTA[h.venta]) hechos.push(VENTA[h.venta] + (h.venta === 'otro-dia' ? ` (${h.dia})` : h.venta === 'otra-ubicacion' ? ` (${h.ubicacion})` : ''))
      }
      out.push(`      ${g.label} · ${fm(g.amount)}${hechos.length ? ' · ' + hechos.join(' · ') : ''}`)
      for (const p of g.productos) out.push(`        ${p.name}: libro ${p.libro} · cobrado ${p.cobrado}${p.sinCantidad ? ` · cobrado sin cantidad ${fm(p.sinCantidad)}` : ''}`)
    }
  }
  if (m.sinExplicar !== 0) out.push(`  · Sin explicar (fallo del propio control): ${fm(m.sinExplicar)}`)
  return out
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
    for (const l of moneyLines(d.money, d.day)) rows.push(pad(l))
  }
  const cc = result.cacheCheck
  rows.push(pad(cc.ok ? 'Control de la caché: CUADRA (la caché coincide con el libro)' : `Control de la caché: ${cc.diffs.length} producto(s) con la caché distinta del libro (el reporte usa el libro)`))
  for (const x of cc.diffs) rows.push(pad(`  ${x.name}: libro ${x.libro} · caché ${x.cache}`))
  const it = result.integrity
  rows.push(pad(it.ok ? 'Integridad del libro (todas las ubicaciones, en el rango): CUADRA' : `Integridad del libro (todas las ubicaciones, en el rango): NO CUADRA — ${Object.entries(it.counts).map(([k, n]) => `${k} ${n}`).join(', ')}`))
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
