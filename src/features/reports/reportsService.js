import { db } from '../../db/db'
import { formatDateTime, localDay } from '../../lib/dates'
import { round2, formatMoney, foreignToBase, isForeignPriced } from '../../lib/currency'
import {
  SHIFT_STATUS, COUNT_STATUS, MOVEMENT_TYPES,
  areaLabel, locationLabel, WAREHOUSE, WAREHOUSE_LABEL, ELABORATION
} from '../../db/constants'
import { analyticsRepo } from '../../repositories/analyticsRepo'
import { configRepo } from '../../repositories/configRepo'
import { accountsRepo } from '../../repositories/accountsRepo'
import { ratesRepo } from '../../repositories/ratesRepo'

// Dia LOCAL del negocio (no UTC); ver lib/dates.localDay.
function inRange(iso, from, to) {
  const d = localDay(iso)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

async function userMap() {
  const users = await db.users.toArray()
  const m = {}
  for (const u of users) m[u.id] = u.name
  return m
}

// Mapa id -> producto (para traer precio de venta en entradas/salidas).
async function productMap() {
  const products = await db.products.toArray()
  const m = {}
  for (const p of products) m[p.id] = p
  return m
}

// Moneda en que se COBRO la venta (para los reportes). En efectivo, la moneda
// del efectivo (puede ser USD); en transferencia, la de la transferencia; en
// mixto el total se expresa en la base (MN), porque las partes pueden venir en
// varias monedas.
function payCurrencyOf(s) {
  if (s.paymentMethod === 'transfer') return s.transferCurrency || 'MN'
  if (s.paymentMethod === 'mixed') return 'MN'
  return s.cashCurrency || s.paymentCurrency || 'MN'
}

// Vuelto (dinero devuelto) de una venta, con su moneda. Existe en efectivo
// (cambio normal) y en mixto (exceso por sobrepago, en MN); en transferencia es
// 0. Es lo que el reporte muestra como "se cobró de más / se devolvió".
function changeOf(s) {
  const amount = s.paymentMethod === 'transfer' ? 0 : round2(Number(s.change || 0))
  const currency = s.changeCurrency || payCurrencyOf(s)
  return { amount, currency }
}

// Modulo 'divisas': precio/costo de un producto en MN para los reportes. Si el
// producto fija su precio en divisa, se valora a la TASA VIGENTE (los reportes
// son en MN, base interna); si no, devuelve el numero tal cual -> reportes
// identicos al clasico. Null-safe (producto ausente -> 0). Carga las tasas una
// sola vez por reporte.
async function baseValuer() {
  const rates = await ratesRepo.currentRates()
  const rateFor = (cur) => Number(rates?.[cur]?.rate || 0)
  const mn = (p, field) => {
    if (!p) return 0
    const v = Number(p[field]) || 0
    return isForeignPriced(p) ? foreignToBase(v, rateFor(p.priceCurrency)) : v
  }
  return { price: (p) => mn(p, 'price'), cost: (p) => mn(p, 'cost') }
}

// --- Builders: cada uno devuelve { title, subtitle, head, rows, filename } ---

// Reporte de ventas al DETALLE (una fila por producto vendido): fecha,
// vendedor, area, descripcion, unidades, precio unitario e importe, con el
// metodo de pago. Cada fila repite fecha/vendedor para poder filtrar en Excel.
export async function buildSalesReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const sales = (await db.sales.toArray())
    .filter((s) => !s.voided && inRange(s.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const methodOf = (s) =>
    s.paymentMethod === 'mixed' ? 'Mixto' : s.paymentMethod === 'transfer' ? 'Transferencia' : 'Efectivo'

  const rows = []
  let total = 0
  for (const s of sales) {
    const seller = names[s.sellerId] || 'vendedor'
    const area = areaLabel(s.area)
    const method = methodOf(s)
    const payCur = payCurrencyOf(s) // moneda del cobro (USD/MN/MLC)
    const chg = changeOf(s) // vuelto (efectivo y sobrepago mixto), con su moneda
    ;(s.items || []).forEach((it, i) => {
      const importe = round2(it.lineTotal ?? it.unitPrice * it.qty)
      rows.push([
        formatDateTime(s.createdAt),
        seller,
        area,
        it.name,
        it.unit,
        round2(it.qty),
        round2(it.unitPrice ?? 0),
        importe,
        method,
        payCur,
        // Vuelto solo en la 1.ª línea de la venta (es por venta, no por producto).
        i === 0 && chg.amount > 0 ? formatMoney(chg.amount, chg.currency) : '',
        it.tierMinQty != null ? `Sí (≥${it.tierMinQty})` : ''
      ])
      total += importe
    })
  }
  rows.push(['', '', '', '', '', '', 'TOTAL', round2(total), '', '', '', ''])
  return {
    title: 'Reporte de ventas',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Vendedor', 'Área', 'Descripción', 'U/M', 'Unidades', 'Precio', 'Importe', 'Metodo', 'Moneda', 'Vuelto', 'Mayorista'],
    rows,
    orientation: 'landscape',
    filename: 'ventas'
  }
}

export async function buildInventoryReport() {
  const cats = await db.categories.toArray()
  const catName = {}
  for (const c of cats) catName[c.id] = c.name
  const areas = await configRepo.getAreas()
  const elab = await configRepo.getElaboration()
  const products = (await db.products.toArray())
    .filter((p) => p.active)
    .sort((a, b) => a.name.localeCompare(b.name))

  // Columnas dinamicas: almacen (+ elaboracion si esta activa) + cada area.
  const locCols = [WAREHOUSE, ...(elab.enabled ? [ELABORATION] : []), ...areas]
  const stockAt = (p, loc) => round2(Number(p.stockByLocation?.[loc] || 0))
  // Modulo 'divisas': costo/precio en MN (tasa vigente) si el producto es en divisa.
  const mnv = await baseValuer()
  // Columna extra "Precio USD" SOLO si hay productos en divisa (si no, el reporte
  // queda identico al clasico). Muestra el precio nativo de los que se venden en USD.
  const hasForeign = products.some((p) => isForeignPriced(p))

  const rows = products.map((p) => [
    p.code || '',
    p.name,
    catName[p.categoryId] || 'Sin categoria',
    p.unit,
    ...locCols.map((loc) => stockAt(p, loc)),
    round2(p.stock),
    round2(mnv.cost(p)),
    round2(mnv.price(p)),
    round2(p.stock * mnv.cost(p)),
    // Precio en su divisa nativa (USD) para los productos que se venden en divisa;
    // vacio para los de la base. La columna solo existe si hay alguno (hasForeign).
    ...(hasForeign ? [isForeignPriced(p) ? round2(Number(p.price) || 0) : ''] : [])
  ])
  const valorTotal = round2(products.reduce((a, p) => a + p.stock * mnv.cost(p), 0))
  const tail = new Array(4 + locCols.length).fill('')
  rows.push([...tail, '', 'VALOR INVENTARIO', valorTotal])
  return {
    title: 'Inventario por ubicación',
    subtitle: `Generado ${formatDateTime(new Date().toISOString())}`,
    head: [
      'Codigo', 'Producto', 'Categoria', 'Unidad',
      WAREHOUSE_LABEL, ...(elab.enabled ? [elab.name] : []), ...areas.map((a) => areaLabel(a)),
      'Total', 'Costo', 'Precio', 'Valor (total*costo)',
      ...(hasForeign ? ['Precio USD'] : [])
    ],
    rows,
    filename: 'inventario'
  }
}

// Entradas de mercancia (compras). Por defecto al almacen central; el vendedor
// con permiso puede entrar directo a su area (se muestra en la columna Ubicacion).
export async function buildEntriesReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const prods = await productMap()
  const mnv = await baseValuer() // modulo 'divisas': precio de venta en MN
  const purchases = (await db.purchases.toArray())
    .filter((p) => inRange(p.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const rows = []
  let total = 0
  for (const pu of purchases) {
    // Ubicacion de la entrada: por defecto el almacen central; el vendedor puede
    // haber entrado directo a su area (entradas antiguas no llevan el campo).
    const lugar = locationLabel(pu.location || WAREHOUSE)
    for (const it of pu.items || []) {
      rows.push([
        formatDateTime(pu.createdAt),
        it.name,
        lugar,
        round2(it.qty),
        it.unit || '',
        round2(it.unitCost || 0),
        round2(mnv.price(prods[it.productId])), // precio de venta actual (MN)
        round2(it.lineTotal ?? Number(it.qty) * Number(it.unitCost || 0)),
        pu.supplier || '',
        names[pu.userId] || 'dueño'
      ])
    }
    total += Number(pu.totalBase || 0)
  }
  if (rows.length === 0) rows.push(['Sin entradas en el periodo', '', '', '', '', '', '', '', '', ''])
  else rows.push(['', '', '', '', '', '', '', round2(total), 'TOTAL', ''])
  return {
    title: 'Entradas de mercancía',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Producto', 'Ubicación', 'Cantidad', 'U/M', 'Costo unit', 'Precio venta', 'Total', 'Proveedor', 'Registró'],
    rows,
    orientation: 'landscape',
    filename: 'entradas'
  }
}

// Salidas del almacen hacia las areas (trazabilidad append-only, Bloque 20).
export async function buildTransfersReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const prods = await productMap()
  const mnv = await baseValuer() // modulo 'divisas': precio/valor en MN
  const elab = await configRepo.getElaboration()
  // Con elaboración activa, los traspasos pueden salir del almacén O de
  // elaboración: se añade una columna "Origen". Sin ella, el reporte queda
  // idéntico a producción. Etiqueta legible para el centinela de elaboración.
  const showOrigin = elab.enabled
  const locName = (loc) => (loc === ELABORATION ? elab.name : locationLabel(loc))
  const transfers = (await db.transfers.toArray())
    .filter((t) => inRange(t.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const rows = []
  let totalVal = 0
  for (const t of transfers) {
    for (const it of t.items || []) {
      const price = round2(mnv.price(prods[it.productId]))
      const valor = round2(price * Number(it.qty || 0))
      totalVal += valor
      const base = [formatDateTime(t.createdAt)]
      if (showOrigin) base.push(locName(t.fromLocation || WAREHOUSE))
      rows.push([
        ...base,
        locName(t.toArea),
        it.name,
        round2(it.qty),
        it.unit || '',
        price,
        valor,
        names[t.byUserId] || 'dueño'
      ])
    }
  }
  const width = showOrigin ? 9 : 8
  if (rows.length === 0) rows.push(['Sin salidas en el periodo', ...new Array(width - 1).fill('')])
  else rows.push([...new Array(width - 3).fill(''), 'TOTAL', round2(totalVal), ''])
  return {
    title: showOrigin ? 'Salidas de almacén / elaboración' : 'Salidas almacén → área',
    subtitle: rangeLabel(from, to),
    head: [
      'Fecha', ...(showOrigin ? ['Origen'] : []), showOrigin ? 'Destino' : 'Área destino',
      'Producto', 'Cantidad', 'U/M', 'Precio', 'Valor', 'Registró'
    ],
    rows,
    filename: 'salidas_almacen'
  }
}

export async function buildShiftsReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const shifts = (await db.shifts.toArray())
    .filter((s) => s.status === SHIFT_STATUS.CLOSED && inRange(s.closedAt, from, to))
    .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))

  // Agregados por turno: nº de ventas, total vendido y transferencias en MN
  // (de ventas por transferencia y de las partes de transferencia en mixto).
  const agg = {}
  for (const s of await db.sales.toArray()) {
    if (s.voided) continue
    const a = agg[s.shiftId] || (agg[s.shiftId] = { count: 0, sold: 0, transfer: 0 })
    a.count += 1
    a.sold += Number(s.totalBase || 0)
    if (s.paymentMethod === 'transfer' && (s.transferCurrency || 'MN') === 'MN') {
      a.transfer += Number(s.transferAmount || 0)
    } else if (s.paymentMethod === 'mixed' && Array.isArray(s.payments)) {
      for (const p of s.payments) {
        if (p.method === 'transfer' && (p.currency || 'MN') === 'MN') a.transfer += Number(p.amount || 0)
      }
    }
  }
  // Extracciones de caja en MN por turno.
  const wd = {}
  for (const c of await db.cashMovements.toArray()) {
    if (c.type !== 'withdrawal' || c.currency !== 'MN') continue
    wd[c.shiftId] = (wd[c.shiftId] || 0) + Number(c.amount || 0)
  }

  const sem = { green: 'Cuadra', yellow: 'Dif. menor', red: 'Dif. critica' }
  const rows = shifts.map((s) => {
    const a = agg[s.id] || { count: 0, sold: 0, transfer: 0 }
    const notes = [
      s.forced ? 'cerrado por dueño' : '',
      s.countSkipped ? 'sin conteo de billetes' : '',
      s.closedBy && s.closedBy !== s.sellerId && names[s.closedBy] ? `cerró: ${names[s.closedBy]}` : ''
    ].filter(Boolean).join('; ')
    return [
      formatDateTime(s.openedAt),
      formatDateTime(s.closedAt),
      names[s.sellerId] || 'vendedor',
      areaLabel(s.area),
      round2(s.openingCash?.MN ?? 0),
      a.count,
      round2(a.sold),
      round2(a.transfer),
      round2(wd[s.id] || 0),
      round2(s.expectedCash?.MN ?? 0),
      round2(s.declaredCash?.MN ?? 0),
      round2(s.difference?.MN ?? 0),
      sem[s.semaphore] || '',
      notes
    ]
  })
  return {
    title: 'Cierres de turno',
    subtitle: rangeLabel(from, to),
    head: ['Abierto', 'Cerrado', 'Vendedor', 'Área', 'Fondo MN', 'N.º ventas', 'Vendido MN', 'Transf. MN', 'Extrac. MN', 'Esperado MN', 'Declarado MN', 'Diferencia MN', 'Cuadre', 'Notas'],
    rows,
    filename: 'cierres',
    orientation: 'landscape' // 14 columnas: se exporta el PDF en horizontal
  }
}

// Ventas por area de venta (Fase 6 - Bloque 19): cuanto vendio y gano cada
// VENDEDOR en cada area (quien hizo el turno en esa area), con subtotal por
// area, y el detalle de ventas cruzadas (sustitucion) por vendedor.
export async function buildAreaReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const sales = (await db.sales.toArray())
    .filter((s) => !s.voided && inRange(s.createdAt, from, to))

  // Etiqueta del grupo: el almacen central usa su nombre propio (areaLabel
  // devolveria el centinela "__almacen"); las areas, su nombre.
  const originLabel = (loc) => (loc === WAREHOUSE ? WAREHOUSE_LABEL : areaLabel(loc))

  // Agrupa por el ORIGEN real de la mercancia: el ALMACEN central cuando fue una
  // venta mayorista (sourceLocation), o el area del turno. Asi las ventas del
  // almacen central se cuentan en su propio grupo y no se mezclan con el area del
  // vendedor. Ventas antiguas (sin sourceLocation) caen en su area, como antes.
  const byArea = {}
  for (const s of sales) {
    const area = s.sourceLocation || String(s.area || '')
    const a = byArea[area] || (byArea[area] = { lines: [], revenue: 0, profit: 0, count: 0 })
    a.count += 1
    for (const it of s.items || []) {
      const importe = round2(it.lineTotal ?? it.unitPrice * it.qty)
      const ganancia = round2(importe - Number(it.unitCost || 0) * Number(it.qty || 0))
      a.lines.push({
        createdAt: s.createdAt,
        seller: names[s.sellerId] || 'vendedor',
        name: it.name,
        unit: it.unit,
        qty: round2(it.qty),
        price: round2(it.unitPrice ?? 0),
        importe,
        ganancia
      })
      a.revenue += importe
      a.profit += ganancia
    }
  }

  const rows = []
  let gRev = 0, gProf = 0, gCount = 0
  const areasSorted = Object.entries(byArea).sort((x, y) => y[1].revenue - x[1].revenue)
  for (const [area, a] of areasSorted) {
    a.lines.sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1))
    for (const l of a.lines) {
      rows.push([originLabel(area), formatDateTime(l.createdAt), l.seller, l.name, l.unit, l.qty, l.price, l.importe, l.ganancia])
    }
    rows.push([originLabel(area), 'SUBTOTAL', `${a.count} venta(s)`, '', '', '', '', round2(a.revenue), round2(a.profit)])
    gRev += a.revenue; gProf += a.profit; gCount += a.count
  }
  rows.push(['TOTAL', '', `${gCount} venta(s)`, '', '', '', '', round2(gRev), round2(gProf)])

  // Bloque de ventas cruzadas (productos de OTRA area cobrados por un vendedor).
  const rep = await analyticsRepo.report({ from, to })
  rows.push(['', '', '', '', '', '', '', '', ''])
  rows.push(['VENTAS CRUZADAS (sustitución)', 'Vendedor', 'Cant', '', '', '', '', 'Importe', ''])
  for (const c of rep.crossArea?.bySeller || []) {
    rows.push(['↔ de otras áreas', c.seller, c.qty, '', '', '', '', round2(c.revenue), ''])
  }
  if ((rep.crossArea?.count ?? 0) === 0) rows.push(['Sin ventas cruzadas', '', '', '', '', '', '', '', ''])

  return {
    title: 'Ventas por área',
    subtitle: rangeLabel(from, to),
    head: ['Área', 'Fecha', 'Vendedor', 'Descripción', 'U/M', 'Unidades', 'Precio', 'Importe', 'Ganancia'],
    rows,
    filename: 'areas'
  }
}

function rangeLabel(from, to) {
  if (!from && !to) return 'Todo el periodo'
  return `Periodo: ${from || '...'} a ${to || '...'}`
}

// Ventas por VENDEDOR con detalle de productos (Bloque E): que vendio cada
// vendedor, con fecha, producto, cantidad e importe por linea, y subtotal por
// vendedor. Ordenado por vendedor y fecha.
export async function buildSellerSalesReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const sales = (await db.sales.toArray())
    .filter((s) => !s.voided && inRange(s.createdAt, from, to))

  // Agrupa por vendedor; dentro, las ventas en orden cronologico.
  const bySeller = {}
  for (const s of sales) {
    const key = s.sellerId || ''
    ;(bySeller[key] = bySeller[key] || []).push(s)
  }
  const sellers = Object.entries(bySeller)
    .map(([id, list]) => ({
      id,
      name: names[id] || 'vendedor',
      list: list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const rows = []
  let grandTotal = 0
  for (const sel of sellers) {
    let subQty = 0
    let subTotal = 0
    for (const s of sel.list) {
      // Origen de la venta: el almacen central (venta mayorista) o el area del
      // turno. Asi el reporte muestra de donde salio cada producto que vendio.
      const originLoc = s.sourceLocation || s.area || ''
      const origin = originLoc === WAREHOUSE ? WAREHOUSE_LABEL : areaLabel(originLoc)
      for (const it of s.items || []) {
        const importe = round2(it.lineTotal ?? it.unitPrice * it.qty)
        rows.push([
          sel.name,
          formatDateTime(s.createdAt),
          origin,
          it.name,
          it.unit,
          round2(it.qty),
          round2(it.unitPrice ?? 0),
          importe,
          it.tierMinQty != null ? `Sí (≥${it.tierMinQty})` : ''
        ])
        subQty = round2(subQty + Number(it.qty || 0))
        subTotal = round2(subTotal + importe)
      }
    }
    rows.push([sel.name, '', '', 'Subtotal vendedor', '', subQty, '', subTotal, ''])
    grandTotal = round2(grandTotal + subTotal)
  }
  rows.push(['', '', '', 'TOTAL', '', '', '', grandTotal, ''])

  return {
    title: 'Ventas por vendedor',
    subtitle: rangeLabel(from, to),
    head: ['Vendedor', 'Fecha', 'Origen', 'Producto', 'U/M', 'Cantidad', 'Precio', 'Importe', 'Mayorista'],
    rows,
    filename: 'ventas_vendedor'
  }
}

// Movimientos de las cuentas de tesoreria (Bloque D, modulo cuentas): todos
// los creditos y debitos por cuenta, con origen y saldo final de cada una.
export async function buildAccountsReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const accounts = await db.accounts.toArray()
  const accName = {}
  for (const a of accounts) accName[a.id] = a
  const refLabel = {
    sale: 'Venta',
    withdrawal: 'Extracción de caja',
    partnerPayment: 'Pago/cobro de tercero',
    manual: 'Ajuste manual'
  }

  const moves = (await db.accountMovements.toArray())
    .filter((m) => inRange(m.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))

  const rows = moves.map((m) => {
    const acc = accName[m.accountId]
    const amt = round2(Number(m.amount) || 0)
    return [
      formatDateTime(m.createdAt),
      acc?.name || 'cuenta',
      m.direction === 'debit' ? 'Débito' : 'Crédito',
      refLabel[m.refType] || m.refType || '',
      m.direction === 'credit' ? amt : '',
      m.direction === 'debit' ? amt : '',
      acc?.currency || '',
      names[m.userId] || '',
      m.note || ''
    ]
  })

  // Saldo final de cada cuenta (todo el historial, no solo el rango).
  const balances = {}
  for (const m of await db.accountMovements.toArray()) {
    const sign = m.direction === 'debit' ? -1 : 1
    balances[m.accountId] = round2((balances[m.accountId] || 0) + sign * Number(m.amount || 0))
  }
  rows.push(['', '', '', '', '', '', '', '', ''])
  for (const a of accounts.filter((x) => x.active)) {
    rows.push(['', a.name, 'SALDO', '', '', '', a.currency, '', round2(balances[a.id] || 0)])
  }

  // Opcion B: desglose de ingresos y egresos por CONCEPTO (en el rango).
  const { credits, debits } = await accountsRepo.byConcept({ from, to })
  const conceptLabels = {
    own: 'Ventas propias',
    consignment: 'Ventas en consignación',
    thirdparty: 'Cobros a terceros',
    provider: 'Pagos a proveedores',
    withdrawal: 'Extracciones de caja',
    manual: 'Ajustes manuales'
  }
  rows.push(['', '', '', '', '', '', '', '', ''])
  rows.push(['INGRESOS POR CONCEPTO', '', '', '', '', '', '', '', ''])
  for (const k of ['own', 'consignment', 'thirdparty', 'manual']) {
    if ((credits[k] || 0) > 0) rows.push(['', conceptLabels[k], '', '', round2(credits[k]), '', 'MN', '', ''])
  }
  rows.push(['EGRESOS POR CONCEPTO', '', '', '', '', '', '', '', ''])
  for (const k of ['provider', 'withdrawal', 'manual']) {
    if ((debits[k] || 0) > 0) rows.push(['', conceptLabels[k], '', '', '', round2(debits[k]), 'MN', '', ''])
  }

  return {
    title: 'Movimientos de cuentas',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Cuenta', 'Tipo', 'Origen', 'Crédito', 'Débito', 'Moneda', 'Usuario', 'Nota'],
    rows,
    filename: 'cuentas'
  }
}

// Submayor de CONTEO FISICO (Fase 7). Por cada conteo APROBADO (de un area o del
// almacen central), reconstruye para cada producto contado el movimiento en esa
// ubicacion desde el conteo anterior hasta este: existencia inicial, entradas,
// ventas (que rebajan la existencia), otros ajustes/traspasos, existencia teorica
// (= el "sistema" del conteo), fisico contado y diferencia (merma/sobrante). El
// subtotal por conteo valora la diferencia con el costo. Incluye TODAS las
// ubicaciones (areas y almacen), etiquetadas con locationLabel.
export async function buildCountReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const prods = await productMap() // para el costo -> valor de la merma
  const mnv = await baseValuer() // modulo 'divisas': costo en MN (tasa vigente)
  const dateOf = (c) => c.approvedAt || c.submittedAt || c.createdAt

  // Todos los conteos aprobados, agrupados por ubicacion y ordenados en el tiempo,
  // para conocer el "conteo anterior" (inicio de la ventana del submayor).
  const approved = (await db.counts.toArray()).filter((c) => c.status === COUNT_STATUS.APPROVED)
  const byLoc = {}
  for (const c of approved) {
    const loc = c.location || WAREHOUSE
    ;(byLoc[loc] = byLoc[loc] || []).push(c)
  }
  for (const loc in byLoc) byLoc[loc].sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : 1))
  const prevBoundary = (c) => {
    const list = byLoc[c.location || WAREHOUSE] || []
    const b = dateOf(c)
    let prev = null
    for (const x of list) { if (dateOf(x) < b) prev = x; else break }
    return prev ? dateOf(prev) : null
  }

  // Los conteos a mostrar: aprobados dentro del rango, mas recientes primero.
  const counts = approved
    .filter((c) => inRange(dateOf(c), from, to))
    .sort((a, b) => (dateOf(a) < dateOf(b) ? 1 : -1))

  const allMoves = await db.stockMovements.toArray()
  const elab = await configRepo.getElaboration()

  const rows = []
  let grandMerma = 0
  for (const c of counts) {
    const loc = c.location || WAREHOUSE
    const start = prevBoundary(c) // exclusivo; null = desde el inicio del historial
    const end = c.submittedAt || dateOf(c) // momento de la foto del sistema
    const fecha = formatDateTime(dateOf(c))
    const lugar = loc === ELABORATION ? elab.name : locationLabel(loc)

    let nCounted = 0, nDif = 0, mermaVal = 0
    for (const it of c.items || []) {
      if (!it.counted) continue
      nCounted += 1
      // Movimientos de ESTE producto en ESTA ubicacion dentro de la ventana.
      let entradas = 0, ventas = 0, otrasSal = 0, cargaIni = 0, ajustes = 0
      for (const m of allMoves) {
        if (m.productId !== it.productId) continue
        if ((m.location || WAREHOUSE) !== loc) continue
        if (start && m.createdAt <= start) continue
        if (m.createdAt > end) continue
        const q = Number(m.qty || 0)
        const k = ledgerKey(m)
        if (k === 'ventas') ventas += q
        else if (k === 'compras' || k === 'traspIn' || k === 'producido') entradas += q
        else if (k === 'cargaIni') cargaIni += q
        else if (k === 'ajustes') ajustes += q
        else otrasSal += q // traspasos a áreas, consumo de elaboración, deuda interna, terceros
      }
      const teorico = round2(Number(it.systemStock || 0))
      const inicial = round2(teorico - (entradas + ventas + otrasSal + cargaIni + ajustes))
      const fisico = round2(Number(it.physicalQty || 0))
      const dif = round2(fisico - teorico)
      if (dif !== 0) nDif += 1
      const cost = mnv.cost(prods[it.productId]) // MN (convertido si es en divisa)
      mermaVal = round2(mermaVal + dif * cost) // dif<0 (merma) resta; sobrante suma
      const estado = dif === 0 ? 'Cuadra' : dif < 0 ? 'Merma' : 'Sobrante'
      rows.push([
        fecha, lugar, it.name, it.unit,
        inicial, round2(entradas), round2(ventas), round2(otrasSal), round2(cargaIni), round2(ajustes),
        teorico, fisico, dif, estado
      ])
    }
    grandMerma = round2(grandMerma + mermaVal)
    rows.push([
      '', '', `SUBTOTAL ${lugar} — ${nCounted} producto(s), ${nDif} con diferencia`,
      '', '', '', '', '', '', '', '', '', '', `Valor dif: ${formatMoney(mermaVal)}`
    ])
  }
  if (counts.length === 0) {
    rows.push(['Sin conteos aprobados en el periodo', '', '', '', '', '', '', '', '', '', '', '', '', ''])
  } else {
    rows.push(['', '', 'TOTAL', '', '', '', '', '', '', '', '', '', '', `Valor dif: ${formatMoney(grandMerma)}`])
  }

  return {
    title: 'Conteo físico (submayor)',
    subtitle: rangeLabel(from, to),
    head: [
      'Fecha', 'Lugar', 'Producto', 'U/M',
      'Inicial', 'Entradas', 'Ventas', 'Otras salidas', 'Carga inicial', 'Ajustes',
      'Teórico', 'Físico', 'Diferencia', 'Estado'
    ],
    rows,
    orientation: 'landscape',
    filename: 'conteo_fisico'
  }
}

// Ventas de UN turno, por linea (para que el vendedor las exporte a PDF):
// descripcion, unidad, cantidad, importe, metodo, cobrado y vuelto.
export async function buildShiftSalesReport(shiftId, sellerName = '') {
  const sales = (await db.sales.where('shiftId').equals(shiftId).toArray())
    .filter((s) => !s.voided)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  const rows = []
  let total = 0
  for (const s of sales) {
    const isMixed = s.paymentMethod === 'mixed'
    const isCash = !isMixed && s.paymentMethod !== 'transfer'
    // En mixto el total se cobra en base (MN); en efectivo/transferencia, en su
    // moneda. El vuelto existe en efectivo y en mixto (sobrepago) — ver changeOf.
    const cobrado = isMixed
      ? round2(Number(s.totalBase || 0))
      : isCash ? Number(s.amountPaid || 0) : Number(s.transferAmount || 0)
    const payCur = payCurrencyOf(s) // moneda del cobro (USD/MN/MLC)
    const chg = changeOf(s) // vuelto con su moneda (puede diferir de la del cobro)
    const items = s.items || []
    const shiftArea = String(s.area || '')
    // Area de la venta = la del TURNO donde se cobro (no la del producto, que
    // es solo informativa y suele venir vacia). Si la mercancia salio del
    // almacen central (venta mayorista, Bloque A), se marca "Almacén".
    const origin = s.sourceLocation === WAREHOUSE
      ? (shiftArea ? WAREHOUSE_LABEL : '')
      : (s.sourceLocation ? String(s.sourceLocation) : shiftArea)
    items.forEach((it, i) => {
      const itArea = String(it.area || '')
      // Marca historica de venta cruzada (previa al Bloque 20).
      const cross = !s.sourceLocation && itArea && shiftArea && itArea !== shiftArea
      rows.push([
        i === 0 ? formatDateTime(s.createdAt) : '',
        it.name,
        cross ? `↔ ${itArea}` : origin,
        it.unit,
        round2(it.qty),
        round2(it.unitPrice ?? (it.lineTotal / (it.qty || 1))),
        round2(it.lineTotal ?? it.unitPrice * it.qty),
        // Linea con precio de escala mayorista (Bloque B): umbral aplicado.
        it.tierMinQty != null ? `Sí (≥${it.tierMinQty})` : '',
        i === 0 ? (isMixed ? 'Mixto' : isCash ? 'Efectivo' : 'Transferencia') : '',
        i === 0 ? payCur : '',
        i === 0 ? round2(cobrado) : '',
        // Vuelto con su moneda (efectivo con cambio y sobrepago en mixto).
        i === 0 && chg.amount > 0 ? formatMoney(chg.amount, chg.currency) : ''
      ])
    })
    total += Number(s.totalBase || 0)
  }
  rows.push(['', '', '', '', '', '', round2(total), '', 'TOTAL', '', '', ''])
  return {
    title: 'Ventas del turno',
    subtitle: `${sellerName ? sellerName + ' · ' : ''}Generado ${formatDateTime(new Date().toISOString())}`,
    head: ['Fecha', 'Producto', 'Área', 'U/M', 'Cant', 'Precio', 'Importe', 'Mayorista', 'Metodo', 'Moneda', 'Cobrado', 'Vuelto'],
    rows,
    orientation: 'landscape',
    filename: 'ventas_turno'
  }
}

// === Reportes del módulo ELABORACIÓN =======================================
// Pensados para el rol de elaboración: NO exponen costo ni ganancia (datos del
// dueño). Solo cantidades, importes y precios de venta.

// R1: ventas consolidadas de TODAS las áreas (por área y producto).
export async function buildElabConsolidatedSales({ from = null, to = null } = {}) {
  const sales = (await db.sales.toArray()).filter((s) => !s.voided && inRange(s.createdAt, from, to))
  const map = {}
  for (const s of sales) {
    const area = areaLabel(s.area)
    for (const it of s.items || []) {
      const key = area + ' ' + it.name
      const g = map[key] || (map[key] = { area, name: it.name, unit: it.unit, qty: 0, importe: 0 })
      g.qty = round2(g.qty + Number(it.qty || 0))
      g.importe = round2(g.importe + Number(it.lineTotal ?? it.unitPrice * it.qty))
    }
  }
  const groups = Object.values(map).sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name))
  const rows = []
  let gQty = 0, gImp = 0, curArea = null, subQty = 0, subImp = 0
  const flush = () => { if (curArea !== null) rows.push([curArea, 'SUBTOTAL', '', round2(subQty), '', round2(subImp)]) }
  for (const g of groups) {
    if (g.area !== curArea) { flush(); curArea = g.area; subQty = 0; subImp = 0 }
    const precio = g.qty ? round2(g.importe / g.qty) : 0
    rows.push([g.area, g.name, g.unit, round2(g.qty), precio, round2(g.importe)])
    subQty = round2(subQty + g.qty); subImp = round2(subImp + g.importe)
    gQty = round2(gQty + g.qty); gImp = round2(gImp + g.importe)
  }
  flush()
  rows.push(['TOTAL', '', '', round2(gQty), '', round2(gImp)])
  if (groups.length === 0) rows.length = 0, rows.push(['Sin ventas en el periodo', '', '', '', '', ''])
  return {
    title: 'Ventas consolidadas por área',
    subtitle: rangeLabel(from, to),
    head: ['Área', 'Producto', 'U/M', 'Unidades', 'Precio', 'Importe'],
    rows,
    filename: 'ventas_consolidadas'
  }
}

// R2: salidas del área de ELABORACIÓN hacia los puntos de venta.
export async function buildElabOutputs({ from = null, to = null } = {}) {
  const names = await userMap()
  const transfers = (await db.transfers.toArray())
    .filter((t) => (t.fromLocation || WAREHOUSE) === ELABORATION && inRange(t.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const rows = []
  let totalQty = 0
  for (const t of transfers) {
    for (const it of t.items || []) {
      rows.push([formatDateTime(t.createdAt), areaLabel(t.toArea), it.name, round2(it.qty), it.unit || '', names[t.byUserId] || '—'])
      totalQty = round2(totalQty + Number(it.qty || 0))
    }
  }
  if (rows.length === 0) rows.push(['Sin salidas en el periodo', '', '', '', '', ''])
  else rows.push(['', '', 'TOTAL', round2(totalQty), '', ''])
  return {
    title: 'Salidas de elaboración a puntos',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Área destino', 'Producto', 'Cantidad', 'U/M', 'Registró'],
    rows,
    filename: 'salidas_elaboracion'
  }
}

// Cuadre cruzado: por producto, lo que ENTRÓ a elaboración (recibido del almacén
// + producido), lo que SALIÓ (consumido en transformación + enviado a puntos), la
// existencia actual en elaboración y lo vendido en los puntos.
export async function buildElabReconciliation({ from = null, to = null } = {}) {
  const moves = await db.stockMovements.toArray()
  const products = await db.products.toArray()
  const pById = {}
  for (const p of products) pById[p.id] = p
  const T = MOVEMENT_TYPES
  const acc = {}
  for (const m of moves) {
    if (!inRange(m.createdAt, from, to)) continue
    const loc = m.location || WAREHOUSE
    const q = Number(m.qty || 0)
    const a = acc[m.productId] || (acc[m.productId] = { entradas: 0, salidas: 0, vendido: 0 })
    if (loc === ELABORATION) {
      if (m.type === T.TRANSFER_IN || m.type === T.CONVERSION_IN) a.entradas = round2(a.entradas + q)
      else a.salidas = round2(a.salidas - q) // cualquier salida de elab (consumo/transfer/venta): q es negativo
    } else if (m.type === T.SALE_OUT) {
      a.vendido = round2(a.vendido - q) // vendido en un punto (q negativo)
    }
  }
  const ids = Object.keys(acc).filter((id) => acc[id].entradas || acc[id].salidas || acc[id].vendido)
  ids.sort((x, y) => (pById[x]?.name || '').localeCompare(pById[y]?.name || ''))
  const rows = ids.map((id) => {
    const p = pById[id]; const a = acc[id]
    const existencia = round2(Number(p?.stockByLocation?.[ELABORATION] || 0))
    return [p?.name || '—', p?.unit || '', round2(a.entradas), round2(a.salidas), existencia, round2(a.vendido)]
  })
  if (rows.length === 0) rows.push(['Sin actividad de elaboración en el periodo', '', '', '', '', ''])
  return {
    title: 'Cuadre de elaboración',
    subtitle: rangeLabel(from, to),
    head: ['Producto', 'U/M', 'Entró a elab.', 'Salió de elab.', 'Existencia elab.', 'Vendido en puntos'],
    rows,
    orientation: 'landscape',
    filename: 'cuadre_elaboracion'
  }
}

// === Submayor por PRODUCTO (kardex) — solo lectura, para el dueño ==========
// Elegido un producto, ubicación (o todas) y rango, reconstruye del libro mayor:
// apertura (existencia al inicio), y por día (o por movimiento) las entradas,
// salidas y ajustes con la existencia corriendo. Deriva todo de stockMovements.
const LEDGER_TIPO = {
  purchase_in: 'Compra', sale_out: 'Venta', internal_debt_out: 'Deuda interna',
  adjustment: 'Ajuste', transfer_out: 'Salida a área', transfer_in: 'Entrada de traspaso',
  partner_out: 'Entrega a tercero', conversion_in: 'Producido (conversión)',
  conversion_out: 'Consumido (conversión)', merma_out: 'Merma'
}

// Clasificacion fina de cada movimiento. La CARGA INICIAL (alta con existencia
// inicial) es un ajuste con nota 'Existencia inicial': se separa para no
// confundirla con un ajuste de correccion. Cada clave suma la cantidad con signo.
function ledgerKey(m) {
  const T = MOVEMENT_TYPES
  switch (m.type) {
    case T.PURCHASE_IN: return 'compras'
    case T.TRANSFER_IN: return 'traspIn'
    case T.CONVERSION_IN: return 'producido'
    case T.SALE_OUT: return 'ventas'
    case T.TRANSFER_OUT: return 'traspOut'
    case T.CONVERSION_OUT: return 'consumo'
    case T.INTERNAL_DEBT_OUT: return 'deuda'
    case T.PARTNER_OUT: return 'terceros'
    case T.MERMA_OUT: return 'merma'
    case T.ADJUSTMENT: return m.note === 'Existencia inicial' ? 'cargaIni' : 'ajustes'
    default: return 'ajustes'
  }
}
const LEDGER_KEYS = ['compras', 'traspIn', 'producido', 'ventas', 'traspOut', 'consumo', 'deuda', 'terceros', 'merma', 'cargaIni', 'ajustes']
const LEDGER_FULL = [
  ['compras', 'Compras'], ['traspIn', 'Traspasos recibidos'], ['producido', 'Producido'],
  ['ventas', 'Ventas'], ['traspOut', 'Traspasos a áreas'], ['consumo', 'Consumo elab.'],
  ['deuda', 'Deuda interna'], ['terceros', 'Entrega terceros'], ['merma', 'Mermas'],
  ['cargaIni', 'Carga inicial'], ['ajustes', 'Ajustes']
]
const emptyLedger = () => ({ compras: 0, traspIn: 0, producido: 0, ventas: 0, traspOut: 0, consumo: 0, deuda: 0, terceros: 0, merma: 0, cargaIni: 0, ajustes: 0 })
const ledgerAdd = (g, m) => { const k = ledgerKey(m); g[k] = round2(g[k] + Number(m.qty || 0)) }
const ledgerNet = (g) => round2(LEDGER_KEYS.reduce((s, k) => s + g[k], 0))
// Columnas intermedias segun nivel: 'basic' (pantalla/PDF) o 'full' (Excel).
const ledgerMidHead = (detail) => detail === 'full'
  ? LEDGER_FULL.map(([, l]) => l)
  : ['Entradas', 'Ventas', 'Otras salidas', 'Carga inicial', 'Ajustes']
const ledgerMidCols = (g, detail) => {
  if (detail === 'full') return LEDGER_FULL.map(([k]) => round2(g[k]))
  const entradas = round2(g.compras + g.traspIn + g.producido)
  const otras = round2(g.traspOut + g.consumo + g.deuda + g.terceros + g.merma)
  return [entradas, round2(g.ventas), otras, round2(g.cargaIni), round2(g.ajustes)]
}

export async function buildProductLedger({ productId = '', location = '', from = null, to = null, mode = 'daily', valued = false, detail = 'basic' } = {}) {
  const p = productId ? await db.products.get(productId) : null
  const locLabel = location ? locationLabel(location) : 'Todas las ubicaciones'
  const mh = ledgerMidHead(detail)
  const nMid = mh.length
  const valHead = valued ? ['Valor (costo)'] : []
  const baseHead = mode === 'detailed'
    ? ['Fecha', 'Tipo', 'Cantidad', 'Existencia', 'Nota']
    : ['Fecha', ...mh, 'Existencia', ...valHead]

  if (!productId || !p) {
    return { title: 'Submayor por producto', subtitle: 'Elige un producto para ver su submayor', head: baseHead, rows: [], filename: 'submayor', orientation: 'landscape' }
  }

  const all = await db.stockMovements.where('productId').equals(productId).toArray()
  const movs = all
    .filter((m) => !location || (m.location || WAREHOUSE) === location)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))

  // Apertura = todo lo ANTERIOR a `desde`; ventana = movimientos dentro del rango.
  let apertura = 0
  const win = []
  for (const m of movs) {
    const day = localDay(m.createdAt)
    if (from && day < from) { apertura = round2(apertura + Number(m.qty || 0)); continue }
    if (to && day > to) continue
    win.push(m)
  }

  const mnv = await baseValuer() // modulo 'divisas': costo en MN (tasa vigente)
  const cost = mnv.cost(p)
  const val = (n) => formatMoney(round2(n * cost))
  const rows = []
  let saldo = round2(apertura)

  if (mode === 'detailed') {
    rows.push(['Apertura', '', '', round2(apertura), ''])
    for (const m of win) {
      saldo = round2(saldo + Number(m.qty || 0))
      const tipo = (m.type === MOVEMENT_TYPES.ADJUSTMENT && m.note === 'Existencia inicial')
        ? 'Carga inicial' : (LEDGER_TIPO[m.type] || m.type)
      rows.push([formatDateTime(m.createdAt), tipo, round2(Number(m.qty || 0)), round2(saldo), m.note || ''])
    }
    rows.push(['Existencia final', '', '', round2(saldo), ''])
  } else {
    const byDay = new Map()
    const order = []
    for (const m of win) {
      const day = localDay(m.createdAt)
      if (!byDay.has(day)) { byDay.set(day, emptyLedger()); order.push(day) }
      ledgerAdd(byDay.get(day), m)
    }
    rows.push(['Apertura', ...new Array(nMid).fill(''), round2(apertura), ...(valued ? [val(apertura)] : [])])
    for (const day of order) {
      const g = byDay.get(day)
      saldo = round2(saldo + ledgerNet(g))
      rows.push([day, ...ledgerMidCols(g, detail), round2(saldo), ...(valued ? [val(saldo)] : [])])
    }
    rows.push(['Existencia final', ...new Array(nMid).fill(''), round2(saldo), ...(valued ? [val(saldo)] : [])])
  }

  return {
    title: 'Submayor por producto',
    subtitle: `${p.name}${p.code ? ' · ' + p.code : ''} · ${locLabel} · ${rangeLabel(from, to)}`,
    head: baseHead,
    rows,
    filename: 'submayor',
    orientation: 'landscape'
  }
}

// Submayor CONSOLIDADO: una fila por producto con sus totales del período.
// productIds vacío = todos los productos activos. Solo lectura.
export async function buildProductsLedgerSummary({ productIds = [], location = '', from = null, to = null, valued = false, detail = 'basic' } = {}) {
  const active = (await db.products.toArray()).filter((p) => p.active)
  const idSet = productIds && productIds.length ? new Set(productIds) : null
  const selected = (idSet ? active.filter((p) => idSet.has(p.id)) : active)
    .sort((a, b) => a.name.localeCompare(b.name))
  const acc = {}
  for (const p of selected) acc[p.id] = { apertura: 0, g: emptyLedger() }

  const moves = await db.stockMovements.toArray()
  for (const m of moves) {
    const a = acc[m.productId]
    if (!a) continue
    if (location && (m.location || WAREHOUSE) !== location) continue
    const day = localDay(m.createdAt)
    if (from && day < from) { a.apertura = round2(a.apertura + Number(m.qty || 0)); continue }
    if (to && day > to) continue
    ledgerAdd(a.g, m)
  }

  const mh = ledgerMidHead(detail)
  const nMid = mh.length
  const rows = []
  const tot = emptyLedger()
  let tVal = 0
  const mnv = await baseValuer() // modulo 'divisas': costo en MN (tasa vigente)
  for (const p of selected) {
    const a = acc[p.id]
    const existencia = round2(a.apertura + ledgerNet(a.g))
    const cost = mnv.cost(p)
    for (const k of LEDGER_KEYS) tot[k] = round2(tot[k] + a.g[k])
    tVal = round2(tVal + existencia * cost)
    rows.push([p.name, p.unit, round2(a.apertura), ...ledgerMidCols(a.g, detail), existencia,
      ...(valued ? [formatMoney(round2(existencia * cost))] : [])])
  }
  const emptyMid = new Array(nMid).fill('')
  if (selected.length === 0) rows.push(['Sin productos', '', '', ...emptyMid, '', ...(valued ? [''] : [])])
  else rows.push(['TOTAL', '', '', ...ledgerMidCols(tot, detail), '', ...(valued ? [formatMoney(tVal)] : [])])

  const locLabel = location ? locationLabel(location) : 'Todas las ubicaciones'
  return {
    title: 'Submayor consolidado por producto',
    subtitle: `${idSet ? selected.length + ' producto(s)' : 'Todos los productos'} · ${locLabel} · ${rangeLabel(from, to)}`,
    head: ['Producto', 'U/M', 'Apertura', ...mh, 'Existencia', ...(valued ? ['Valor (costo)'] : [])],
    rows,
    orientation: 'landscape',
    filename: 'submayor_consolidado'
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Modulo 'mesas': ventas cobradas desde una mesa (cafeteria). Una fila por
// cuenta cerrada, con su desglose (consumo, servicio, total). Al final, totales
// y ticket promedio. Solo mira ventas que llevan mesa (sale.table): las ventas
// directas no aparecen aqui.
export async function buildTablesReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const sales = (await db.sales.toArray())
    .filter((s) => !s.voided && s.table && inRange(s.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const methodOf = (s) =>
    s.paymentMethod === 'mixed' ? 'Mixto' : s.paymentMethod === 'transfer' ? 'Transferencia' : 'Efectivo'

  const rows = []
  let totSub = 0
  let totServ = 0
  let totTotal = 0
  for (const s of sales) {
    const units = (s.items || []).reduce((a, it) => a + Number(it.qty || 0), 0)
    const sub = round2(s.subtotal ?? s.totalBase ?? 0)
    const serv = round2(s.serviceChargeAmount ?? 0)
    const tot = round2(s.totalBase ?? 0)
    totSub += sub; totServ += serv; totTotal += tot
    rows.push([
      formatDateTime(s.createdAt),
      areaLabel(s.area),
      s.table,
      names[s.sellerId] || 'vendedor',
      round2(units),
      sub,
      s.serviceChargePct ? `${s.serviceChargePct}%` : '',
      serv,
      tot,
      methodOf(s)
    ])
  }
  const avg = sales.length ? round2(totTotal / sales.length) : 0
  rows.push(['', '', '', 'TOTALES', '', round2(totSub), '', round2(totServ), round2(totTotal), ''])
  rows.push(['', '', '', `Cuentas: ${sales.length}`, '', '', 'Ticket promedio', avg, '', ''])
  return {
    title: 'Ventas por mesa',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Área', 'Mesa', 'Camarero', 'Unidades', 'Consumo', 'Serv.%', 'Servicio', 'Total', 'Método'],
    rows,
    filename: 'ventas-mesas',
    orientation: 'landscape'
  }
}

// Mermas (deterioro/perdida): una fila por merma. Muestra el precio al que
// estaba a la venta (valor que ya no se realizara), el costo unitario y el
// importe del costo (cantidad x costo = perdida REAL para el dueño). Al final,
// el total de afectacion al costo y el total de precio de venta perdido.
export async function buildMermasReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const mermas = (await db.mermas.toArray())
    .filter((m) => inRange(m.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const rows = []
  let totCost = 0
  let totSale = 0
  for (const m of mermas) {
    const qty = round2(Number(m.qty || 0))
    const costTotal = round2(Number(m.costTotal ?? qty * Number(m.unitCost || 0)))
    const saleTotal = round2(Number(m.saleTotal ?? qty * Number(m.salePrice || 0)))
    totCost += costTotal
    totSale += saleTotal
    rows.push([
      formatDateTime(m.createdAt),
      m.name,
      locationLabel(m.location),
      qty,
      m.unit || '',
      round2(Number(m.salePrice || 0)),
      round2(Number(m.unitCost || 0)),
      costTotal,
      m.reason || '',
      names[m.userId] || ''
    ])
  }
  if (rows.length === 0) {
    rows.push(['Sin mermas en el periodo', '', '', '', '', '', '', '', '', ''])
  } else {
    rows.push(['', '', '', '', '', '', 'Venta perdida', round2(totSale), '', ''])
    rows.push(['', '', '', '', '', '', 'AFECTACIÓN TOTAL (costo)', round2(totCost), '', ''])
  }
  return {
    title: 'Mermas',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Producto', 'Ubicación', 'Cantidad', 'U/M', 'Precio venta', 'Costo unit', 'Importe costo', 'Motivo', 'Registró'],
    rows,
    filename: 'mermas',
    orientation: 'landscape'
  }
}

// --- Exportadores (carga diferida de las librerias) ---

export async function exportExcel(report) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet([report.head, ...report.rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  downloadBlob(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${report.filename}.xlsx`
  )
}

export async function exportPdf(report) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  // Los reportes muy anchos (p.ej. cierres de turno) se exportan horizontal.
  const doc = new jsPDF({ orientation: report.orientation === 'landscape' ? 'landscape' : 'portrait' })
  doc.setFontSize(14)
  doc.text(report.title, 14, 16)
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(`MypiCuadre · ${report.subtitle || ''}`, 14, 22)
  doc.setTextColor(0)
  autoTable(doc, {
    head: [report.head],
    body: report.rows,
    startY: 28,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 110] }
  })
  doc.save(`${report.filename}.pdf`)
}
