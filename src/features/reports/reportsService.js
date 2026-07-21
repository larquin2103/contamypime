import { db } from '../../db/db'
import { formatDateTime, localDay } from '../../lib/dates'
import { round2 } from '../../lib/currency'
import { SHIFT_STATUS, areaLabel, WAREHOUSE, WAREHOUSE_LABEL } from '../../db/constants'
import { analyticsRepo } from '../../repositories/analyticsRepo'
import { configRepo } from '../../repositories/configRepo'

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
    for (const it of s.items || []) {
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
        it.tierMinQty != null ? `Sí (≥${it.tierMinQty})` : ''
      ])
      total += importe
    }
  }
  rows.push(['', '', '', '', '', '', 'TOTAL', round2(total), '', ''])
  return {
    title: 'Reporte de ventas',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Vendedor', 'Área', 'Descripción', 'U/M', 'Unidades', 'Precio', 'Importe', 'Metodo', 'Mayorista'],
    rows,
    filename: 'ventas'
  }
}

export async function buildInventoryReport() {
  const cats = await db.categories.toArray()
  const catName = {}
  for (const c of cats) catName[c.id] = c.name
  const areas = await configRepo.getAreas()
  const products = (await db.products.toArray())
    .filter((p) => p.active)
    .sort((a, b) => a.name.localeCompare(b.name))

  // Columnas dinamicas: existencia en el almacen + en cada area configurada.
  const locCols = [WAREHOUSE, ...areas]
  const stockAt = (p, loc) => round2(Number(p.stockByLocation?.[loc] || 0))

  const rows = products.map((p) => [
    p.code || '',
    p.name,
    catName[p.categoryId] || 'Sin categoria',
    p.unit,
    ...locCols.map((loc) => stockAt(p, loc)),
    round2(p.stock),
    round2(p.cost),
    round2(p.price),
    round2(p.stock * p.cost)
  ])
  const valorTotal = round2(products.reduce((a, p) => a + p.stock * p.cost, 0))
  const tail = new Array(4 + locCols.length).fill('')
  rows.push([...tail, '', 'VALOR INVENTARIO', valorTotal])
  return {
    title: 'Inventario por ubicación',
    subtitle: `Generado ${formatDateTime(new Date().toISOString())}`,
    head: [
      'Codigo', 'Producto', 'Categoria', 'Unidad',
      WAREHOUSE_LABEL, ...areas.map((a) => areaLabel(a)),
      'Total', 'Costo', 'Precio', 'Valor (total*costo)'
    ],
    rows,
    filename: 'inventario'
  }
}

// Entradas de mercancia al almacen central (compras).
export async function buildEntriesReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const prods = await productMap()
  const purchases = (await db.purchases.toArray())
    .filter((p) => inRange(p.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const rows = []
  let total = 0
  for (const pu of purchases) {
    for (const it of pu.items || []) {
      rows.push([
        formatDateTime(pu.createdAt),
        it.name,
        round2(it.qty),
        it.unit || '',
        round2(it.unitCost || 0),
        round2(prods[it.productId]?.price ?? 0), // precio de venta actual
        round2(it.lineTotal ?? Number(it.qty) * Number(it.unitCost || 0)),
        pu.supplier || '',
        names[pu.userId] || 'dueño'
      ])
    }
    total += Number(pu.totalBase || 0)
  }
  if (rows.length === 0) rows.push(['Sin entradas en el periodo', '', '', '', '', '', '', '', ''])
  else rows.push(['', '', '', '', '', '', round2(total), 'TOTAL', ''])
  return {
    title: 'Entradas al almacén',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Producto', 'Cantidad', 'U/M', 'Costo unit', 'Precio venta', 'Total', 'Proveedor', 'Registró'],
    rows,
    filename: 'entradas'
  }
}

// Salidas del almacen hacia las areas (trazabilidad append-only, Bloque 20).
export async function buildTransfersReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const prods = await productMap()
  const transfers = (await db.transfers.toArray())
    .filter((t) => inRange(t.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const rows = []
  let totalVal = 0
  for (const t of transfers) {
    for (const it of t.items || []) {
      const price = round2(prods[it.productId]?.price ?? 0)
      const valor = round2(price * Number(it.qty || 0))
      totalVal += valor
      rows.push([
        formatDateTime(t.createdAt),
        t.toArea,
        it.name,
        round2(it.qty),
        it.unit || '',
        price,
        valor,
        names[t.byUserId] || 'dueño'
      ])
    }
  }
  if (rows.length === 0) rows.push(['Sin salidas en el periodo', '', '', '', '', '', '', ''])
  else rows.push(['', '', '', '', '', 'TOTAL', round2(totalVal), ''])
  return {
    title: 'Salidas almacén → área',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Área destino', 'Producto', 'Cantidad', 'U/M', 'Precio', 'Valor', 'Registró'],
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
    filename: 'cierres'
  }
}

// Ventas por area de venta (Fase 6 - Bloque 19): cuanto vendio y gano cada
// VENDEDOR en cada area (quien hizo el turno en esa area), con subtotal por
// area, y el detalle de ventas cruzadas (sustitucion) por vendedor.
export async function buildAreaReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const sales = (await db.sales.toArray())
    .filter((s) => !s.voided && inRange(s.createdAt, from, to))

  // Agrupa por area del turno (donde se cobro); dentro, una fila por producto
  // vendido (fecha, vendedor, descripcion, unidades, precio, importe, ganancia).
  const byArea = {}
  for (const s of sales) {
    const area = String(s.area || '')
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
      rows.push([areaLabel(area), formatDateTime(l.createdAt), l.seller, l.name, l.unit, l.qty, l.price, l.importe, l.ganancia])
    }
    rows.push([areaLabel(area), 'SUBTOTAL', `${a.count} venta(s)`, '', '', '', '', round2(a.revenue), round2(a.profit)])
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
      for (const it of s.items || []) {
        const importe = round2(it.lineTotal ?? it.unitPrice * it.qty)
        rows.push([
          sel.name,
          formatDateTime(s.createdAt),
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
    rows.push([sel.name, '', 'Subtotal vendedor', '', subQty, '', subTotal, ''])
    grandTotal = round2(grandTotal + subTotal)
  }
  rows.push(['', '', 'TOTAL', '', '', '', grandTotal, ''])

  return {
    title: 'Ventas por vendedor',
    subtitle: rangeLabel(from, to),
    head: ['Vendedor', 'Fecha', 'Producto', 'U/M', 'Cantidad', 'Precio', 'Importe', 'Mayorista'],
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

  return {
    title: 'Movimientos de cuentas',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Cuenta', 'Tipo', 'Origen', 'Crédito', 'Débito', 'Moneda', 'Usuario', 'Nota'],
    rows,
    filename: 'cuentas'
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
    // En pago mixto se cobra el total exacto (en base); sin vuelto.
    const cobrado = isMixed
      ? round2(Number(s.totalBase || 0))
      : isCash ? Number(s.amountPaid || 0) : Number(s.transferAmount || 0)
    const vuelto = isCash ? Number(s.change || 0) : 0
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
        round2(it.lineTotal ?? it.unitPrice * it.qty),
        // Linea con precio de escala mayorista (Bloque B): umbral aplicado.
        it.tierMinQty != null ? `Sí (≥${it.tierMinQty})` : '',
        i === 0 ? (isMixed ? 'Mixto' : isCash ? 'Efectivo' : 'Transferencia') : '',
        i === 0 ? round2(cobrado) : '',
        i === 0 ? round2(vuelto) : ''
      ])
    })
    total += Number(s.totalBase || 0)
  }
  rows.push(['', '', '', '', '', round2(total), '', 'TOTAL', '', ''])
  return {
    title: 'Ventas del turno',
    subtitle: `${sellerName ? sellerName + ' · ' : ''}Generado ${formatDateTime(new Date().toISOString())}`,
    head: ['Fecha', 'Producto', 'Área', 'U/M', 'Cant', 'Importe', 'Mayorista', 'Metodo', 'Cobrado', 'Vuelto'],
    rows,
    filename: 'ventas_turno'
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
  const doc = new jsPDF()
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
