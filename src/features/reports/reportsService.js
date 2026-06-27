import { db } from '../../db/db'
import { formatDateTime, localDay } from '../../lib/dates'
import { round2 } from '../../lib/currency'
import { SHIFT_STATUS, areaLabel } from '../../db/constants'
import { analyticsRepo } from '../../repositories/analyticsRepo'

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

// --- Builders: cada uno devuelve { title, subtitle, head, rows, filename } ---

export async function buildSalesReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const sales = (await db.sales.toArray())
    .filter((s) => !s.voided && inRange(s.createdAt, from, to))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const rows = sales.map((s) => {
    const isTransfer = s.paymentMethod === 'transfer'
    // Para transferencias: esperado, recibido y diferencia (si la hay).
    const expected = isTransfer ? round2(Number(s.transferExpected ?? s.totalBase ?? 0)) : ''
    const received = isTransfer ? round2(Number(s.transferAmount || 0)) : ''
    const diff = isTransfer ? round2(Number(s.transferDiff || 0)) : ''
    return [
      formatDateTime(s.createdAt),
      names[s.sellerId] || 'vendedor',
      areaLabel(s.area),
      s.hasCrossArea ? 'Sí' : '',
      isTransfer ? 'Transferencia' : 'Efectivo',
      isTransfer ? s.transferReference || '' : '',
      round2(s.totalBase),
      expected,
      received,
      diff
    ]
  })
  const total = round2(sales.reduce((a, s) => a + Number(s.totalBase || 0), 0))
  rows.push(['', '', '', '', '', 'TOTAL', total, '', '', ''])
  return {
    title: 'Reporte de ventas',
    subtitle: rangeLabel(from, to),
    head: ['Fecha', 'Vendedor', 'Área', 'Cruzada', 'Metodo', 'No. operacion', 'Total', 'Esperado', 'Recibido', 'Diferencia'],
    rows,
    filename: 'ventas'
  }
}

export async function buildInventoryReport() {
  const cats = await db.categories.toArray()
  const catName = {}
  for (const c of cats) catName[c.id] = c.name
  const products = (await db.products.toArray())
    .filter((p) => p.active)
    .sort((a, b) => a.name.localeCompare(b.name))
  const rows = products.map((p) => [
    p.code || '',
    p.name,
    catName[p.categoryId] || 'Sin categoria',
    areaLabel(p.area),
    p.unit,
    round2(p.stock),
    round2(p.cost),
    round2(p.price),
    round2(p.stock * p.cost)
  ])
  const valorTotal = round2(products.reduce((a, p) => a + p.stock * p.cost, 0))
  rows.push(['', '', '', '', '', '', '', 'VALOR INVENTARIO', valorTotal])
  return {
    title: 'Inventario actual',
    subtitle: `Generado ${formatDateTime(new Date().toISOString())}`,
    head: ['Codigo', 'Producto', 'Categoria', 'Área', 'Unidad', 'Stock', 'Costo', 'Precio', 'Valor (stock*costo)'],
    rows,
    filename: 'inventario'
  }
}

export async function buildShiftsReport({ from = null, to = null } = {}) {
  const names = await userMap()
  const shifts = (await db.shifts.toArray())
    .filter((s) => s.status === SHIFT_STATUS.CLOSED && inRange(s.closedAt, from, to))
    .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))
  const sem = { green: 'Cuadra', yellow: 'Dif. menor', red: 'Dif. critica' }
  const rows = shifts.map((s) => [
    formatDateTime(s.openedAt),
    formatDateTime(s.closedAt),
    names[s.sellerId] || 'vendedor',
    areaLabel(s.area),
    round2(s.expectedCash?.MN ?? 0),
    round2(s.declaredCash?.MN ?? 0),
    round2(s.difference?.MN ?? 0),
    sem[s.semaphore] || '',
    [s.forced ? 'cerrado por dueño' : '', s.countSkipped ? 'sin conteo' : ''].filter(Boolean).join('; ')
  ])
  return {
    title: 'Cierres de turno',
    subtitle: rangeLabel(from, to),
    head: ['Abierto', 'Cerrado', 'Vendedor', 'Área', 'Esperado MN', 'Declarado MN', 'Diferencia MN', 'Cuadre', 'Notas'],
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

  const saleProfit = (s) =>
    (s.items || []).reduce(
      (a, it) => a + (Number(it.lineTotal ?? it.unitPrice * it.qty) - Number((it.unitCost || 0) * it.qty)),
      0
    )

  // Agrupa por area del turno (donde se cobro) y, dentro, por vendedor.
  const byArea = {}
  let gRevenue = 0
  let gProfit = 0
  let gCount = 0
  for (const s of sales) {
    const area = String(s.area || '')
    const a = byArea[area] || (byArea[area] = { area, sellers: {}, revenue: 0, profit: 0, count: 0 })
    const sid = s.sellerId
    const e = a.sellers[sid] || (a.sellers[sid] = { seller: names[sid] || 'vendedor', revenue: 0, profit: 0, count: 0 })
    const rev = Number(s.totalBase || 0)
    const prof = saleProfit(s)
    e.revenue += rev; e.profit += prof; e.count += 1
    a.revenue += rev; a.profit += prof; a.count += 1
    gRevenue += rev; gProfit += prof; gCount += 1
  }

  const rows = []
  const areasSorted = Object.values(byArea).sort((x, y) => y.revenue - x.revenue)
  for (const a of areasSorted) {
    const sellers = Object.values(a.sellers).sort((x, y) => y.revenue - x.revenue)
    for (const e of sellers) {
      rows.push([areaLabel(a.area), e.seller, e.count, round2(e.revenue), round2(e.profit)])
    }
    // Subtotal del area (si tiene mas de un vendedor, ayuda a leerlo).
    if (sellers.length > 1) {
      rows.push([areaLabel(a.area), 'Subtotal área', a.count, round2(a.revenue), round2(a.profit)])
    }
  }
  rows.push(['TOTAL', '', gCount, round2(gRevenue), round2(gProfit)])

  // Bloque de ventas cruzadas (productos de OTRA area cobrados por un vendedor).
  const rep = await analyticsRepo.report({ from, to })
  rows.push(['', '', '', '', ''])
  rows.push(['VENTAS CRUZADAS (sustitución)', 'Vendedor', 'Cant', 'Importe', ''])
  for (const c of rep.crossArea?.bySeller || []) {
    rows.push(['↔ de otras áreas', c.seller, c.qty, round2(c.revenue), ''])
  }
  if ((rep.crossArea?.count ?? 0) === 0) rows.push(['Sin ventas cruzadas', '', '', '', ''])

  return {
    title: 'Ventas por área',
    subtitle: rangeLabel(from, to),
    head: ['Área', 'Vendedor', 'Ventas', 'Ingreso', 'Ganancia'],
    rows,
    filename: 'areas'
  }
}

function rangeLabel(from, to) {
  if (!from && !to) return 'Todo el periodo'
  return `Periodo: ${from || '...'} a ${to || '...'}`
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
    const isCash = s.paymentMethod !== 'transfer'
    const cobrado = isCash ? Number(s.amountPaid || 0) : Number(s.transferAmount || 0)
    const vuelto = isCash ? Number(s.change || 0) : 0
    const items = s.items || []
    const shiftArea = String(s.area || '')
    items.forEach((it, i) => {
      const itArea = String(it.area || '')
      const cross = itArea && itArea !== shiftArea
      rows.push([
        i === 0 ? formatDateTime(s.createdAt) : '',
        it.name,
        itArea ? (cross ? `↔ ${itArea}` : itArea) : '',
        it.unit,
        round2(it.qty),
        round2(it.lineTotal ?? it.unitPrice * it.qty),
        i === 0 ? (isCash ? 'Efectivo' : 'Transferencia') : '',
        i === 0 ? round2(cobrado) : '',
        i === 0 ? round2(vuelto) : ''
      ])
    })
    total += Number(s.totalBase || 0)
  }
  rows.push(['', '', '', '', '', round2(total), 'TOTAL', '', ''])
  return {
    title: 'Ventas del turno',
    subtitle: `${sellerName ? sellerName + ' · ' : ''}Generado ${formatDateTime(new Date().toISOString())}`,
    head: ['Fecha', 'Producto', 'Área', 'U/M', 'Cant', 'Importe', 'Metodo', 'Cobrado', 'Vuelto'],
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
