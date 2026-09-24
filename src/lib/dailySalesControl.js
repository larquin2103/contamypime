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

// Causas del control de dinero (conciliacion por grupo). El importe de cada una es
// (Venta del libro x precio de la ficha) - (lo cobrado), del grupo que la origina.
export const CAUSE_LABELS = {
  anulSinLinea: 'anulación sin línea: movimiento de anulación sin su línea anulada',
  anulTrasCobro: 'anulado después de cobrar: el libro lo devolvió al stock y la venta sigue cobrada',
  abierta: 'mesa abierta: consumo aún sin cobrar',
  anuladaSinCobro: 'mesa anulada sin cobrar: su consumo salió del libro un día y volvió otro',
  sinVentaViva: 'venta del libro sin su venta viva (anulada o no recibida en este aparato)',
  cobradaOtroDia: 'consumo de este día cobrado otro día',
  consumoOtroDia: 'consumo de otro día de esta mesa, cobrado o anulado este día',
  lineaSinMov: 'cobrado más de lo que el libro registra consumido (falta un movimiento de consumo en este aparato)',
  consumoNoCobrado: 'consumo registrado en el libro que no entró en el cobro de su mesa',
  precio: 'precio cobrado distinto del de la ficha',
  sinMov: 'venta sin movimiento de stock (libro incompleto en este aparato)',
  otros: 'movimiento de venta sin referencia',
  cobroDuplicado: 'cobro duplicado: la misma mesa cobrada más de una vez',
  redondeo: 'redondeo al centavo (líneas cobradas redondeadas, p. ej. pesadas)'
}

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
  const outDays = []
  for (const day of days) {
    const rows = []
    const totals = { entrada: 0, salida: 0, merma: 0, venta: 0, ajuste: 0, importe: 0 }
    let importeRaw = 0
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
    // CONCILIACION EXACTA POR GRUPO Y PRODUCTO (tercera version, tras dos revisiones
    // independientes). Cada linea cobrada se descompone SIN resto:
    //   lineTotal = qty x ficha - qty x (ficha - precio cobrado) - (qty x precio cobrado - lineTotal)
    // asi que, por grupo (mesa 'O:', venta directa 'S:', movimiento suelto 'X:') y producto,
    //   libro x ficha - cobrado = PRECIO (por linea) + REDONDEO (por linea)
    //                            + (unidades del libro - unidades cobradas) x ficha.
    // El precio y el redondeo salen de cada LINEA (no dependen de cuantas tenga la venta);
    // solo el descuadre de UNIDADES se interpreta segun el estado de la mesa o la venta.
    const priceP = (pid) => (byId.get(pid) ? round2(priceOf(byId.get(pid))) : 0)
    const groups = new Map()
    const G = (k) => {
      if (!groups.has(k)) groups.set(k, { k, prods: new Map(), cases: new Set(), sale: 0, check: 0 })
      return groups.get(k)
    }
    const GP = (g, pid) => {
      if (!g.prods.has(pid)) g.prods.set(pid, { P: priceP(pid), ledger: 0, cons: 0, voids: 0, preVoid: 0, postVoid: 0, orphan: 0, preOrphan: 0, sold: 0, dupList: [] })
      return g.prods.get(pid)
    }
    const prior = new Map() // pedido -> Map(producto -> unidades netas de dias ANTERIORES)
    for (const pid of pids) {
      for (const m of byProd.get(pid)) {
        if (classify(m) !== 'ventas') continue
        const dm = dayOf(m.createdAt)
        const q = -Number(m.qty || 0) // unidades vendidas (positivo); una anulacion resta
        const isOrder = m.refType === 'order' || m.refType === 'order_void'
        if (dm < day && isOrder) {
          const mp = prior.get(m.refId) || new Map()
          mp.set(pid, (mp.get(pid) || 0) + q)
          prior.set(m.refId, mp)
          continue
        }
        if (dm !== day) continue
        const k = isOrder ? 'O:' + m.refId : m.refType === 'sale' ? 'S:' + m.refId : 'X:' + m.id
        const x = GP(G(k), pid)
        x.ledger += q
        if (m.refType === 'order') x.cons += q
        else if (m.refType === 'order_void') {
          const v = -q
          const orphan = orphanIds.has(m.id)
          x.voids += v
          if (orphan) x.orphan += v
          // Partidas por el instante del COBRO valido de la mesa: el detector de atomicidad
          // empareja por instante, y una anulacion legitima previa al cobro sale "huerfana"
          // si su linea quedo sellada con una hora posterior (mesa 143f3098 de Burger).
          const sl = liveSaleByOrder.get(m.refId)
          if (sl && sl.createdAt < m.createdAt) x.postVoid += v
          else { x.preVoid += v; if (orphan) x.preOrphan += v }
        }
      }
    }
    const det = new Map()
    const addG = (g, key, amount, isCase) => {
      if (!amount && !isCase) return
      const x = det.get(key) || { key, label: CAUSE_LABELS[key], amount: 0, n: 0 }
      x.amount += amount
      det.set(key, x)
      g.check += amount
      if (isCase) g.cases.add(key)
    }
    for (const s of daySales) {
      const g = G(s.orderId ? 'O:' + s.orderId : 'S:' + s.id)
      const dup = !!s.orderId && liveSaleByOrder.get(s.orderId)?.id !== s.id
      for (const it of s.items || []) {
        if (!inCat(it.productId)) continue
        const x = GP(g, it.productId)
        const qty = Number(it.qty || 0)
        const lt = Number(it.lineTotal ?? (Number(it.unitPrice || 0) * qty))
        g.sale += lt
        x.sold += qty
        if (dup) x.dupList.push(qty)
        if (!qty) { addG(g, 'sinMov', -lt, true); continue } // linea sin cantidad: nada que casar
        // Sin precio unitario (en los respaldos reales no falta nunca): si el cobro es el de la
        // ficha redondeado al centavo, el precio es el de la ficha; si no, el efectivo.
        const up = it.unitPrice != null ? Number(it.unitPrice) : Math.abs(lt - round2(qty * x.P)) <= 0.005 + 1e-9 ? x.P : lt / qty
        const dr = qty * up - lt
        // Si la linea no es qty x precio redondeado al centavo, la diferencia no es redondeo:
        // se cobro a otro precio efectivo.
        const redondeo = Math.abs(dr) <= 0.005 + 1e-9
        const dp = qty * (x.P - up) + (redondeo ? 0 : dr)
        addG(g, 'precio', dp, Math.abs(up - x.P) >= 0.005 || !redondeo)
        if (redondeo) addG(g, 'redondeo', dr, false)
      }
    }
    for (const g of groups.values()) {
      const tipo = g.k.slice(0, 1)
      const id = g.k.slice(2)
      // Lo cobrado DOS veces es el SOLAPE de cada venta duplicada con la valida, por producto
      // y cantidad (lo que la duplicada cobre de mas es un cobro valido de lo agregado).
      const valid = tipo === 'O' ? liveSaleByOrder.get(id) : null
      const validQty = (pid) => (valid?.items || []).reduce((a, it) => a + (it.productId === pid ? Number(it.qty || 0) : 0), 0)
      for (const [pid, x] of g.prods) {
        const u = (key, units) => { if (Math.abs(units) >= 0.0005) addG(g, key, units * x.P, true) }
        const vq = x.dupList.length ? validQty(pid) : 0
        const dupU = x.dupList.reduce((a, q) => a + Math.min(q, vq), 0)
        if (tipo === 'O') {
          const sl = liveSaleByOrder.get(id)
          const sd = sl ? dayOf(sl.createdAt) : ''
          if (sl && sd === day) {
            // Cobrada ESTE dia. N = lo consumido y no anulado hasta el cobro, contando los
            // dias anteriores de ESTA ubicacion y categoria; lo cobrado deberia ser N.
            const pr = prior.get(id)?.get(pid) || 0
            const priorU = pr > 0.0005 ? pr : 0
            u('anulTrasCobro', -x.postVoid)
            u('consumoOtroDia', -priorU)
            const N = priorU + x.cons - x.preVoid
            u('cobroDuplicado', -dupU)
            const r = N - (x.sold - dupU)
            if (r >= 0.0005) u('consumoNoCobrado', r)
            else if (r <= -0.0005) {
              // Menos consumo neto que lo cobrado: una anulacion duplicada (huerfana previa al
              // cobro, mesa 180a7687) o un consumo sin su movimiento.
              const o = Math.min(x.preOrphan, -r)
              u('anulSinLinea', -o)
              u('lineaSinMov', r + o)
            }
          } else if (sl && sd < day) {
            // Cobrada un dia ANTERIOR: lo de hoy son agregados o anulaciones tras el cobro, y
            // cualquier venta de hoy es un duplicado.
            const net = x.cons - x.voids
            u('cobroDuplicado', -dupU)
            const r = net - (x.sold - dupU)
            if (r >= 0.0005) u('consumoNoCobrado', r)
            else if (r <= -0.0005) {
              const o = Math.min(x.orphan, -r)
              u('anulSinLinea', -o)
              u('anulTrasCobro', r + o)
            }
          } else {
            // Sin cobro todavia (se cobra otro dia) o sin venta viva.
            u('anulSinLinea', -x.orphan)
            const rest = x.ledger + x.orphan - x.sold
            if (sl) u('cobradaOtroDia', rest)
            else {
              const st = orderById.get(id)?.status
              u(st === ORDER_STATUS.OPEN || st === ORDER_STATUS.RESERVED ? 'abierta' : st === ORDER_STATUS.VOIDED ? 'anuladaSinCobro' : 'sinVentaViva', rest)
            }
          }
        } else if (tipo === 'S') {
          const sl = saleById.get(id)
          const du = x.ledger - x.sold
          if (!sl || sl.voided) u('sinVentaViva', du)
          else if (dayOf(sl.createdAt) !== day) u('cobradaOtroDia', du)
          else u('sinMov', du)
        } else {
          u('otros', x.ledger - x.sold)
        }
      }
    }
    // Comprobacion de construccion: en cada grupo, la suma de sus partes TIENE que ser su
    // diferencia. Si no, es un fallo de esta logica y sale como "Sin explicar".
    let descuadre = 0
    for (const g of groups.values()) {
      let gap = -g.sale
      for (const x of g.prods.values()) gap += x.ledger * x.P
      descuadre += gap - g.check
      for (const key of g.cases) det.get(key).n += 1
    }
    let consumo = 0
    for (const g of groups.values()) consumo += g.sale
    consumo = round2(consumo)
    const diferencia = round2(totals.importe - consumo)
    // Impresion al centavo: toda causa con casos se imprime aunque sume 0 (hallazgo 1 de la
    // segunda revision). El redondeo absorbe el de los totales y el de las causas impresas,
    // para que las causas IMPRESAS sumen la diferencia impresa; lo que la comprobacion de
    // construccion no cuadre queda como "Sin explicar".
    const causasDet = [...det.values()].filter((x) => x.key !== 'redondeo')
      .map((x) => ({ ...x, amount: round2(x.amount) })).filter((x) => x.n > 0 || x.amount !== 0)
    const red = round2(diferencia - descuadre - causasDet.reduce((a, x) => a + x.amount, 0))
    if (red !== 0) causasDet.push({ key: 'redondeo', label: CAUSE_LABELS.redondeo, amount: red, n: 0 })
    const explicado = causasDet.reduce((a, x) => a + x.amount, 0)
    const sinExplicar = round2(diferencia - explicado)
    const causas = causasDet.map((x) => x.key === 'redondeo' ? x.label + ': ' + formatMoney(x.amount) : x.label + ': ' + x.n + ' caso(s), ' + formatMoney(x.amount))
    if (Math.abs(sinExplicar) >= 0.01) causas.push('Sin explicar: ' + formatMoney(sinExplicar))
    outDays.push({
      day, folios, sellers, rows, totals,
      money: { importe: totals.importe, consumo, diferencia, cuadra: diferencia === 0, servicio: round2(servicio), descuento: round2(descuento), cobrado: round2(cobrado), causas, causasDet, sinExplicar }
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
  rows.push(pad(it.ok ? 'Integridad del libro (todo el aparato): CUADRA' : `Integridad del libro (todo el aparato): NO CUADRA — ${Object.entries(it.counts).map(([k, n]) => `${k} ${n}`).join(', ')}`))
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
