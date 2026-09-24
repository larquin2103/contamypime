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
  consumoOtroDia: 'cobrada este día con consumo de otro día',
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
    // CONCILIACION POR GRUPO (revision final, C1/I1-I3). La diferencia del dia se
    // descompone en grupos -cada mesa (pedido) y cada venta directa- con sus movimientos
    // de VENTA del libro y sus ventas cobradas: la suma de los grupos ES la diferencia,
    // por construccion. A cada grupo se le asigna su causa por su ESTADO real, con su
    // importe, y lo que no se pueda asignar queda como "sin explicar".
    const groups = new Map()
    const G = (k) => {
      if (!groups.has(k)) groups.set(k, { k, ledger: 0, sale: 0, ledgerUnits: 0, saleUnits: 0, orphan: 0, voidAfter: 0, postVoid: 0, consUnits: 0, preVoidUnits: 0, preOrphan: 0, preOrphanUnits: 0, dupSale: 0, dupUnits: 0 })
      return groups.get(k)
    }
    const prior = new Map() // pedido -> { units, money } de dias anteriores (neto de anulaciones)
    for (const pid of pids) {
      const precio = byId.get(pid) ? round2(priceOf(byId.get(pid))) : 0
      for (const m of byProd.get(pid)) {
        if (classify(m) !== 'ventas') continue
        const dm = dayOf(m.createdAt)
        if (dm < day && (m.refType === 'order' || m.refType === 'order_void')) {
          const x = prior.get(m.refId) || { units: 0, money: 0 }
          x.units -= Number(m.qty || 0)
          x.money -= Number(m.qty || 0) * precio
          prior.set(m.refId, x)
        }
        if (dm !== day) continue
        const q = -Number(m.qty || 0) // unidades vendidas (positivo); una anulacion resta
        const k = m.refType === 'order' || m.refType === 'order_void' ? 'O:' + m.refId : m.refType === 'sale' ? 'S:' + m.refId : 'X:' + m.id
        const g = G(k)
        g.ledger += q * precio
        g.ledgerUnits += q
        if (m.refType === 'order') g.consUnits += q
        if (orphanIds.has(m.id)) g.orphan += q * precio
        else if (m.refType === 'order_void') {
          const sl = liveSaleByOrder.get(m.refId)
          if (sl && sl.createdAt < m.createdAt) g.voidAfter += q * precio
        }
        // Para la mesa cobrada: TODA anulacion (huerfana o no) partida por el instante del
        // cobro. El detector de atomicidad empareja por instante, y una anulacion legitima
        // anterior al cobro sale "huerfana" si su linea quedo sellada con una hora posterior
        // (dato real de Burger, mesa 143f3098): lo que decide es si la venta la refleja.
        if (m.refType === 'order_void') {
          const sl = liveSaleByOrder.get(m.refId)
          if (sl && sl.createdAt < m.createdAt) g.postVoid += q * precio
          else {
            g.preVoidUnits -= q
            if (orphanIds.has(m.id)) { g.preOrphan += q * precio; g.preOrphanUnits -= q }
          }
        }
      }
    }
    for (const s of daySales) {
      const g = G(s.orderId ? 'O:' + s.orderId : 'S:' + s.id)
      const dup = s.orderId && liveSaleByOrder.get(s.orderId)?.id !== s.id
      for (const it of s.items || []) {
        if (!inCat(it.productId)) continue
        const amt = Number(it.lineTotal ?? (Number(it.unitPrice || 0) * Number(it.qty || 0)))
        g.sale += amt
        g.saleUnits += Number(it.qty || 0)
        if (dup) { g.dupSale += amt; g.dupUnits += Number(it.qty || 0) }
      }
    }
    let consumo = 0
    for (const g of groups.values()) consumo += g.sale
    consumo = round2(consumo)
    const diferencia = round2(totals.importe - consumo)
    const det = new Map()
    // Ningun importe se descarta (auditoria pre-main, I1): antes, los restos de menos de
    // medio centavo por grupo -pesadas cobradas redondeadas linea a linea- se perdian y
    // acumulados salian como "Sin explicar". Ahora se suman a su causa; el contador solo
    // cuenta los casos de al menos medio centavo.
    const add = (key, amount) => {
      if (!amount) return
      const x = det.get(key) || { key, label: CAUSE_LABELS[key], amount: 0, n: 0 }
      x.amount += amount
      if (Math.abs(amount) >= 0.005) x.n += 1
      det.set(key, x)
    }
    for (const g of groups.values()) {
      let gap = g.ledger - g.sale
      // I2: lo cobrado de mas por una venta duplicada del mismo pedido es su propia causa;
      // el resto del grupo se juzga como si solo existiera la venta valida.
      if (g.dupSale) { add('cobroDuplicado', -g.dupSale); gap += g.dupSale; g.saleUnits -= g.dupUnits }
      if (Math.abs(gap) < 0.005) { add('redondeo', gap); continue }
      const tipo = g.k.slice(0, 1)
      const id = g.k.slice(2)
      if (tipo === 'O') {
        const o = orderById.get(id)
        const sl = liveSaleByOrder.get(id)
        if (sl && dayOf(sl.createdAt) === day) {
          // Cobrada ESTE dia: lo devuelto tras cobrar es su propia causa; el resto se juzga
          // en UNIDADES -consumo menos anulaciones previas al cobro, frente a lo cobrado- y
          // el SIGNO dice cual de las dos cosas paso.
          add('anulTrasCobro', g.postVoid)
          // I4: el consumo de dias anteriores (de ESTA ubicacion y categoria) explica SU
          // parte, unidades x precio; el resto sigue el arbol normal.
          const pr = prior.get(id)
          const pu = pr && pr.units > 0.0005 ? pr.units : 0
          const pm = pu ? pr.money : 0
          add('consumoOtroDia', -pm)
          const rest = gap - g.postVoid + pm
          const du = g.consUnits - g.preVoidUnits + pu - g.saleUnits
          if (Math.abs(rest) < 0.005) add('redondeo', rest)
          else if (du >= 0.0005) add('consumoNoCobrado', rest)
          else if (du <= -0.0005) {
            // El libro registra MENOS consumo neto que lo cobrado. Dos causas posibles: una
            // anulacion duplicada (la delata el detector: huerfana previa al cobro, dato real
            // de la mesa 180a7687) o un consumo sin su movimiento. La huerfana explica
            // primero -todo el resto si sus unidades lo cubren, si no su propio importe-.
            if (g.preOrphanUnits >= -du - 0.0005) add('anulSinLinea', rest)
            else { add('anulSinLinea', g.preOrphan); add('lineaSinMov', rest - g.preOrphan) }
          } else add('precio', rest)
          continue
        }
        add('anulSinLinea', g.orphan)
        add('anulTrasCobro', g.voidAfter)
        const rest = gap - g.orphan - g.voidAfter
        if (Math.abs(rest) < 0.005) { add('redondeo', rest); continue }
        if (!sl) {
          const st = o?.status
          add(st === ORDER_STATUS.OPEN || st === ORDER_STATUS.RESERVED ? 'abierta' : st === ORDER_STATUS.VOIDED ? 'anuladaSinCobro' : 'sinVentaViva', rest)
        } else {
          add('cobradaOtroDia', rest)
        }
      } else if (tipo === 'S') {
        const sl = saleById.get(id)
        if (!sl || sl.voided) add('sinVentaViva', gap)
        else if (dayOf(sl.createdAt) !== day) add('cobradaOtroDia', gap)
        // Sin NINGUN movimiento de venta en el libro, la causa es la falta de movimiento
        // aunque las unidades "coincidan" (una linea sin qty daria 0 = 0).
        else if (Math.abs(g.ledgerUnits) < 0.0005 || Math.abs(g.ledgerUnits - g.saleUnits) >= 0.0005) add('sinMov', gap)
        else add('precio', gap)
      } else {
        add('otros', gap)
      }
    }
    // La diferencia impresa se redondea al centavo y las causas tambien: si lo que queda sin
    // asignar no llega a medio centavo es redondeo de los propios totales, y el redondeo
    // absorbe ese resto para que las causas IMPRESAS sumen la diferencia impresa. Lo que
    // supere medio centavo sin asignar sigue saliendo como "Sin explicar": es un fallo.
    let crudo = 0
    for (const x of det.values()) crudo += x.amount
    const resto = diferencia - crudo
    const causasDet = [...det.values()].filter((x) => x.key !== 'redondeo')
      .map((x) => ({ ...x, amount: round2(x.amount) })).filter((x) => x.amount !== 0)
    if (Math.abs(resto) <= 0.005 + 1e-9) {
      const red = round2(diferencia - causasDet.reduce((a, x) => a + x.amount, 0))
      if (red !== 0) causasDet.push({ key: 'redondeo', label: CAUSE_LABELS.redondeo, amount: red, n: det.get('redondeo')?.n || 0 })
    } else if (det.has('redondeo') && round2(det.get('redondeo').amount) !== 0) {
      causasDet.push({ ...det.get('redondeo'), amount: round2(det.get('redondeo').amount) })
    }
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
