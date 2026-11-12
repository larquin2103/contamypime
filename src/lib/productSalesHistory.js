import { round2, baseToForeign } from './currency.js'
import { cleanQty } from './qty.js'
import { saleNetFactor } from './saleRevenue.js'
import { isCourtesyPct } from './orderTotals.js'

// ---------------------------------------------------------------------------
// Historico de ventas POR PRODUCTO (Reportes -> Ventas). PURO, sin Dexie ni
// React: se prueba con node (`productSalesHistory.test.mjs`).
//
// QUE RESPONDE. "¿Cuanto se vendio de ESTE producto (o de estos) entre dos
// fechas?": una fila por cada linea de venta, con su subtotal por producto y el
// total. SOLO LEE: recibe las ventas ya cargadas y no escribe nada.
//
// DE DONDE SALE CADA CIFRA (ninguna se recalcula con datos de hoy):
//  - Cantidad, Precio e Importe: lo CONGELADO en la linea de la venta. Un cambio
//    de precio posterior no altera estas filas.
//  - Descuento / Neto: el descuento de la venta (mesas) PRORRATEADO por importe
//    con `saleNetFactor`, el mismo criterio del panel del dueño. Dos sitios que
//    sumaran el mismo dinero con reglas distintas dirian cifras distintas del
//    mismo dia; la suite compara este modulo contra `sumSales`.
//  - Costo: el `unitCost` congelado en la linea (en MN). El descuento NO lo toca.
//    Una linea vieja sin costo guardado cuenta 0 y el reporte lo AVISA.
//
// QUE DEJA FUERA, a proposito: las ventas ANULADAS (se cuentan y se avisa en el
// pie) y las lineas sin `productId` (no se pueden atribuir a un producto).
//
// El dia es el LOCAL del negocio: `dayOf` se inyecta (en la app, `localDay`).
// ---------------------------------------------------------------------------

const methodLabel = (s) => {
  // Cortesia (100 % de descuento): se cobro efectivo 0; decir "Efectivo" seria mentira.
  if (isCourtesyPct(s?.discountPct)) return 'Cortesía'
  return s?.paymentMethod === 'mixed' ? 'Mixto' : s?.paymentMethod === 'transfer' ? 'Transferencia' : 'Efectivo'
}

const grossOfLine = (it) => Number(it?.lineTotal ?? (Number(it?.unitPrice || 0) * Number(it?.qty || 0)))

export function buildProductSales({
  sales = [], productIds = [], from = '', to = '',
  dayOf, userName = () => '', originLabel = () => '', productName = () => ''
} = {}) {
  const wanted = new Set((productIds || []).filter(Boolean))
  const inRange = (iso) => {
    const d = dayOf(iso)
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  }

  const groups = new Map() // productId -> { lines, costRaw, saleIds }
  let voidedLines = 0
  let noCostLines = 0
  let hasDiscount = false
  let hasForeign = false

  const ordered = (Array.isArray(sales) ? sales : [])
    .filter((s) => s && inRange(s.createdAt))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))

  for (const s of wanted.size ? ordered : []) {
    const items = (s.items || []).filter((it) => it && wanted.has(it.productId))
    if (!items.length) continue
    if (s.voided) { voidedLines += items.length; continue }
    const factor = saleNetFactor(s)
    for (const it of items) {
      const gross = round2(grossOfLine(it))
      // Igual que `netLineRevenue`/`sumSales`: se redondea el importe YA prorrateado.
      const net = round2(grossOfLine(it) * factor)
      const discount = round2(gross - net)
      const sinCosto = it.unitCost == null || !Number.isFinite(Number(it.unitCost))
      const costRaw = sinCosto ? 0 : Number(it.unitCost) * Number(it.qty || 0)
      const cost = round2(costRaw)
      const rate = Number(it.priceRate || 0)
      const enDivisa = !!it.priceCurrency && rate > 0
      const fxPrice = enDivisa ? baseToForeign(Number(it.unitPrice || 0), rate) : ''
      const fxTotal = enDivisa ? round2(fxPrice * Number(it.qty || 0)) : ''
      if (sinCosto) noCostLines++
      if (discount !== 0) hasDiscount = true
      if (enDivisa) hasForeign = true
      const g = groups.get(it.productId) || { productId: it.productId, lines: [], costRaw: 0, saleIds: new Set(), lastName: '' }
      g.lines.push({
        saleId: s.id, productId: it.productId, at: s.createdAt, day: dayOf(s.createdAt),
        name: it.name || '', unit: it.unit || '', qty: cleanQty(it.qty),
        unitPrice: round2(it.unitPrice ?? 0), gross, discount, net, cost, costRaw,
        profit: round2(net - cost), seller: userName(s.sellerId), origin: originLabel(s),
        method: methodLabel(s), fxPrice, fxTotal
      })
      g.costRaw += costRaw
      g.saleIds.add(s.id)
      g.lastName = it.name || g.lastName
      groups.set(it.productId, g)
    }
  }

  const sum = (arr, f) => round2(arr.reduce((a, x) => a + Number(x[f] || 0), 0))
  const products = [...groups.values()].map((g) => {
    const units = new Set(g.lines.map((l) => l.unit))
    const net = sum(g.lines, 'net')
    const cost = round2(g.costRaw)
    return {
      productId: g.productId,
      // Nombre de HOY del producto; si ya no existe, el ultimo con que se vendio.
      name: productName(g.productId) || g.lastName || g.productId,
      // Si la unidad cambio en el periodo, sumar las cantidades no significa nada.
      unit: units.size === 1 ? [...units][0] : '',
      qty: units.size === 1 ? cleanQty(g.lines.reduce((a, l) => a + l.qty, 0)) : '',
      gross: sum(g.lines, 'gross'), discount: sum(g.lines, 'discount'), net, cost,
      profit: round2(net - cost),
      fxTotal: g.lines.some((l) => l.fxTotal !== '') ? sum(g.lines, 'fxTotal') : '',
      sales: g.saleIds.size, lines: g.lines
    }
  }).sort((a, b) => a.name.localeCompare(b.name, 'es'))

  const lines = products.flatMap((p) => p.lines)
  const net = sum(lines, 'net')
  // El costo total se redondea UNA vez sobre la suma cruda, como `sumSales`.
  const cost = round2(lines.reduce((a, l) => a + l.costRaw, 0))
  return {
    lines, products,
    total: {
      gross: sum(lines, 'gross'), discount: sum(lines, 'discount'), net, cost,
      profit: round2(net - cost),
      fxTotal: hasForeign ? sum(lines, 'fxTotal') : ''
    },
    selected: wanted.size, voidedLines, noCostLines, hasDiscount, hasForeign
  }
}

// De resultado a reporte exportable: { title, subtitle, head, rows, filename, orientation }.
// Las columnas de Descuento/Neto solo existen si hubo algun descuento, y las de
// divisa solo con el modulo `divisas` Y alguna linea en divisa (data-driven).
export function productSalesReport(result, { from = '', to = '', divisas = false, formatDateTime = (x) => x } = {}) {
  const disc = !!result.hasDiscount
  const fx = !!divisas && !!result.hasForeign
  const head = ['Producto', 'Fecha', 'Vendedor', 'Origen', 'U/M', 'Cantidad', 'Precio', 'Importe',
    ...(disc ? ['Descuento', 'Neto'] : []), 'Costo', 'Ganancia', 'Método',
    ...(fx ? ['Precio USD', 'Importe USD'] : [])]
  const pad = (text) => [{ content: text, colSpan: head.length }]
  const money = (x) => [x.gross, ...(disc ? [x.discount, x.net] : []), x.cost, x.profit]

  const rows = []
  for (const p of result.products) {
    for (const l of p.lines) {
      rows.push([p.name, formatDateTime(l.at), l.seller, l.origin, l.unit, l.qty, l.unitPrice,
        ...money(l), l.method, ...(fx ? [l.fxPrice, l.fxTotal] : [])])
    }
    rows.push([p.name, '', '', `Subtotal (${p.sales} ${p.sales === 1 ? 'venta' : 'ventas'})`, p.unit, p.qty, '',
      ...money(p), '', ...(fx ? ['', p.fxTotal] : [])])
  }
  if (result.products.length) {
    rows.push(['', '', '', 'TOTAL', '', '', '', ...money(result.total), '', ...(fx ? ['', result.total.fxTotal] : [])])
  } else {
    rows.push(pad('No hay ventas de los productos elegidos en el periodo.'))
  }
  if (disc) rows.push(pad('Descuento = la parte del descuento de la venta que corresponde a la línea (repartido en proporción al importe). Neto = Importe − Descuento. El costo no se descuenta.'))
  if (result.voidedLines > 0) {
    rows.push(pad(`Fuera del reporte: ${result.voidedLines} ${result.voidedLines === 1 ? 'línea' : 'líneas'} de estos productos en ventas anuladas.`))
  }
  if (result.noCostLines > 0) {
    rows.push(pad(`${result.noCostLines} ${result.noCostLines === 1 ? 'línea no tiene' : 'líneas no tienen'} costo registrado: cuentan costo 0 y su ganancia sale de más.`))
  }

  const periodo = !from && !to ? 'Todo el periodo' : `Periodo: ${from || '...'} a ${to || '...'}`
  return {
    title: 'Histórico de ventas por producto',
    subtitle: `${periodo} · ${result.selected} ${result.selected === 1 ? 'producto' : 'productos'}`,
    head, rows, orientation: 'landscape', filename: 'ventas_por_producto'
  }
}
