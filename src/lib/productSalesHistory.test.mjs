// Pruebas PURAS del historico de ventas por producto (Reportes -> Ventas).
// Sin framework: ejecutar con  `node src/lib/productSalesHistory.test.mjs`.
//
// QUE EXISTE ESTA SUITE PARA CAZAR: que el reporte diga una cifra distinta de la que
// dicen las ventas. Tres cosas tienen que cumplirse siempre:
//   a) solo entran las lineas de los productos elegidos, de ventas NO anuladas y
//      del rango de dias LOCALES pedido;
//   b) el neto de cada linea es el mismo que suma el panel del dueño
//      (`netLineRevenue`): si no, dos pantallas dirian cifras distintas del mismo dia;
//   c) subtotales y total son la suma exacta de las filas que se imprimen.
import { buildProductSales, productSalesReport } from './productSalesHistory.js'
import { netLineRevenue, sumSales } from './saleRevenue.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${e}\n  obtenido: ${a}`)
}
const ok = (cond, label) => eq(!!cond, true, label)
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// Dia "local" de la prueba: los 10 primeros caracteres (sin zona), determinista.
const deps = {
  dayOf: (iso) => String(iso || '').slice(0, 10),
  userName: (id) => ({ u1: 'Ana', u2: 'Beto' }[id] || 'vendedor'),
  originLabel: (s) => s.sourceLocation || s.area || '',
  productName: (id) => ({ A: 'Arroz', B: 'Bistec', C: 'Cola' }[id] || '')
}
const line = (productId, qty, unitPrice, extra = {}) => ({
  productId, name: `nombre-${productId}`, unit: 'u', qty, unitPrice,
  lineTotal: round2(qty * unitPrice), unitCost: 1, ...extra
})
const sale = (id, createdAt, items, extra = {}) => ({
  id, createdAt, sellerId: 'u1', area: 'Tienda', paymentMethod: 'cash', items, ...extra
})

// --- 1) Filtro: producto, anuladas y rango -----------------------------------
{
  const sales = [
    sale('s1', '2026-11-01T10:00:00', [line('A', 2, 10), line('B', 1, 50)]),
    sale('s2', '2026-11-02T10:00:00', [line('A', 3, 10)]),
    sale('s3', '2026-11-02T11:00:00', [line('A', 9, 10)], { voided: true }),
    sale('s4', '2026-11-05T10:00:00', [line('A', 1, 10), line('C', 4, 5)]),
    sale('s5', '2026-11-03T10:00:00', [{ name: 'sin id', qty: 1, unitPrice: 7 }])
  ]
  const r = buildProductSales({ sales, productIds: ['A'], ...deps })
  eq(r.lines.map((l) => [l.saleId, l.qty]), [['s1', 2], ['s2', 3], ['s4', 1]], '1) solo el producto A, sin la anulada, en orden cronologico')
  eq(r.voidedLines, 1, '1) cuenta la linea anulada que dejo fuera')
  eq(r.products.length, 1, '1) un solo grupo')
  eq([r.products[0].qty, r.products[0].gross, r.products[0].sales], [6, 60, 3], '1) subtotal: unidades, importe y numero de ventas')

  const rango = buildProductSales({ sales, productIds: ['A'], from: '2026-11-02', to: '2026-11-04', ...deps })
  eq(rango.lines.map((l) => l.saleId), ['s2'], '1) el rango es inclusivo y por dia local')
  eq(rango.voidedLines, 1, '1) la anulada del rango tambien se cuenta')
  const soloDesde = buildProductSales({ sales, productIds: ['A'], from: '2026-11-02', ...deps })
  eq(soloDesde.lines.map((l) => l.saleId), ['s2', 's4'], '1) solo "desde"')
  const soloHasta = buildProductSales({ sales, productIds: ['A'], to: '2026-11-01', ...deps })
  eq(soloHasta.lines.map((l) => l.saleId), ['s1'], '1) solo "hasta"')
  const fueraAnulada = buildProductSales({ sales, productIds: ['A'], to: '2026-11-01', ...deps })
  eq(fueraAnulada.voidedLines, 0, '1) una anulada fuera del rango no se cuenta')

  const varios = buildProductSales({ sales, productIds: ['C', 'A'], ...deps })
  eq(varios.products.map((p) => p.name), ['Arroz', 'Cola'], '1) varios productos, grupos por nombre')
  eq(varios.lines.length, 4, '1) y todas sus lineas')
  eq(buildProductSales({ sales, productIds: [], ...deps }).lines.length, 0, '1) sin seleccion no hay filas (no "todos")')
  eq(buildProductSales({ sales: null, productIds: ['A'], ...deps }).lines.length, 0, '1) sin ventas no revienta')
}

// --- 2) Importes: descuento prorrateado igual que el panel -------------------
{
  const s = sale('m1', '2026-11-01T12:00:00', [line('A', 2, 100, { unitCost: 30 }), line('B', 1, 300, { unitCost: 100 })],
    { discountPct: 10, discountAmount: 50 })
  const r = buildProductSales({ sales: [s], productIds: ['A', 'B'], ...deps })
  for (const l of r.lines) {
    const it = s.items.find((x) => x.productId === l.productId)
    eq(l.net, netLineRevenue(s, it), `2) neto de ${l.productId} = el del panel`)
    eq(l.discount, round2(l.gross - l.net), `2) descuento de ${l.productId} = bruto - neto`)
  }
  eq(r.hasDiscount, true, '2) detecta que hay descuento')
  eq(r.total.net, sumSales([s]).revenue, '2) total neto = ingreso del panel')
  eq(r.total.cost, sumSales([s]).cost, '2) total costo = costo del panel')
  eq(r.total.profit, sumSales([s]).profit, '2) total ganancia = ganancia del panel')

  // Cortesia (100 %): ingreso 0, el costo SI cuenta.
  const c = sale('m2', '2026-11-01T13:00:00', [line('A', 1, 100, { unitCost: 30 })], { discountPct: 100, discountAmount: 100 })
  const rc = buildProductSales({ sales: [c], productIds: ['A'], ...deps })
  eq([rc.lines[0].gross, rc.lines[0].discount, rc.lines[0].net, rc.lines[0].cost, rc.lines[0].profit], [100, 100, 0, 30, -30], '2) cortesia: neto 0, costo intacto')

  // Sin descuento: neto = bruto y la bandera apagada.
  const n = buildProductSales({ sales: [sale('s', '2026-11-01T09:00:00', [line('A', 3, 10)])], productIds: ['A'], ...deps })
  eq([n.lines[0].gross, n.lines[0].discount, n.lines[0].net, n.hasDiscount], [30, 0, 30, false], '2) sin descuento, neto = bruto')

  // Venta vieja sin lineTotal ni unitCost: importe = precio x cantidad; costo 0 y contado.
  const v = buildProductSales({ sales: [sale('v', '2026-01-01T09:00:00', [{ productId: 'A', name: 'x', unit: 'kg', qty: 1.2345, unitPrice: 10 }])], productIds: ['A'], ...deps })
  eq([v.lines[0].gross, v.lines[0].cost, v.noCostLines], [12.35, 0, 1], '2) linea vieja: precio x cantidad y sin costo')
  eq(v.lines[0].qty, 1.235, '2) la cantidad conserva la milesima (no se redondea a 2)')
}

// --- 3) Sumas: subtotal y total = suma de las filas --------------------------
{
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const ids = ['A', 'B', 'C']
  for (let t = 0; t < 200; t++) {
    const sales = []
    for (let i = 0; i < 12; i++) {
      const items = []
      const n = 1 + Math.floor(rnd() * 3)
      for (let k = 0; k < n; k++) {
        items.push(line(ids[Math.floor(rnd() * 3)], round2(rnd() * 5 + 0.01), round2(rnd() * 200), { unitCost: round2(rnd() * 80) }))
      }
      const gross = round2(items.reduce((a, it) => a + it.lineTotal, 0))
      const disc = rnd() < 0.3 ? round2(gross * rnd()) : 0
      sales.push(sale(`s${i}`, `2026-11-${String(1 + Math.floor(rnd() * 9)).padStart(2, '0')}T10:00:00`, items,
        { discountAmount: disc, voided: rnd() < 0.1 }))
    }
    const r = buildProductSales({ sales, productIds: ids, ...deps })
    const vivas = sales.filter((s) => !s.voided)
    const panel = sumSales(vivas)
    if (r.total.net !== panel.revenue || r.total.cost !== panel.cost || r.total.profit !== panel.profit) {
      eq([r.total.net, r.total.cost, r.total.profit], [panel.revenue, panel.cost, panel.profit], `3) caso ${t}: total = panel del dueño`)
    } else pass++
    const sumaGrupos = round2(r.products.reduce((a, p) => a + p.net, 0))
    const sumaLineas = round2(r.lines.reduce((a, l) => a + l.net, 0))
    if (sumaGrupos !== r.total.net || sumaLineas !== r.total.net) {
      eq([sumaGrupos, sumaLineas], [r.total.net, r.total.net], `3) caso ${t}: grupos y lineas suman el total`)
    } else pass++
    const lineasGrupo = r.products.reduce((a, p) => a + p.lines.length, 0)
    if (lineasGrupo !== r.lines.length) eq(lineasGrupo, r.lines.length, `3) caso ${t}: ninguna linea fuera de su grupo`)
    else pass++
  }
}

// --- 4) Divisa: referencia en USD con la tasa CONGELADA ----------------------
{
  const s = sale('d1', '2026-11-01T10:00:00', [line('A', 2, 240, { priceCurrency: 'USD', priceRate: 120 }), line('B', 1, 50)])
  const r = buildProductSales({ sales: [s], productIds: ['A', 'B'], ...deps })
  const a = r.lines.find((l) => l.productId === 'A')
  const b = r.lines.find((l) => l.productId === 'B')
  eq([a.fxPrice, a.fxTotal], [2, 4], '4) precio e importe en divisa a la tasa congelada')
  eq([b.fxPrice, b.fxTotal], ['', ''], '4) una linea en MN deja la columna vacia')
  eq(r.hasForeign, true, '4) detecta lineas en divisa')
}

// --- 5) El reporte: columnas, subtotales y pie -------------------------------
{
  const sales = [
    sale('s1', '2026-11-01T10:00:00', [line('A', 2, 10), line('B', 1, 50)], { sellerId: 'u2' }),
    sale('s2', '2026-11-02T10:00:00', [line('A', 3, 10)], { paymentMethod: 'transfer' }),
    sale('s3', '2026-11-02T11:00:00', [line('A', 9, 10)], { voided: true })
  ]
  const res = buildProductSales({ sales, productIds: ['A', 'B'], ...deps })
  const fmt = { formatDateTime: (x) => x, from: '2026-11-01', to: '2026-11-30' }
  const rep = productSalesReport(res, fmt)
  eq(rep.head, ['Producto', 'Fecha', 'Vendedor', 'Origen', 'U/M', 'Cantidad', 'Precio', 'Importe', 'Costo', 'Ganancia', 'Método'], '5) columnas clasicas (sin descuento ni divisa)')
  eq(rep.filename, 'ventas_por_producto', '5) nombre de fichero')
  ok(rep.subtitle.includes('2026-11-01') && rep.subtitle.includes('2 producto'), '5) el subtitulo dice el rango y cuantos productos')
  const datos = rep.rows.filter((r) => r.length === rep.head.length)
  ok(datos.every((r) => r.length === rep.head.length), '5) todas las filas de datos tienen el ancho de la cabecera')
  eq(datos[0].slice(0, 8), ['Arroz', '2026-11-01T10:00:00', 'Beto', 'Tienda', 'u', 2, 10, 20], '5) primera fila: producto, fecha, vendedor, origen y cifras')
  eq(datos[1][10], 'Transferencia', '5) el metodo se etiqueta')
  eq(datos[2].slice(0, 8), ['Arroz', '', '', 'Subtotal (2 ventas)', 'u', 5, '', 50], '5) subtotal del producto con sus unidades')
  const total = datos[datos.length - 1]
  eq([total[3], total[5], total[7]], ['TOTAL', '', 100], '5) el TOTAL no suma unidades de productos distintos')
  const pie = rep.rows.filter((r) => r.length === 1).map((r) => r[0].content)
  ok(pie.some((t) => t.includes('1 línea') && t.includes('anulada')), '5) el pie avisa de las anuladas que dejo fuera')
  ok(rep.rows.filter((r) => r.length === 1).every((r) => r[0].colSpan === rep.head.length), '5) el pie va a lo ancho')

  // Con descuento y divisa aparecen sus columnas; sin ellos, no.
  const conTodo = buildProductSales({
    sales: [sale('x', '2026-11-01T10:00:00', [line('A', 1, 120, { priceCurrency: 'USD', priceRate: 120 })], { discountAmount: 20 })],
    productIds: ['A'], ...deps
  })
  const repTodo = productSalesReport(conTodo, { ...fmt, divisas: true })
  eq(repTodo.head, ['Producto', 'Fecha', 'Vendedor', 'Origen', 'U/M', 'Cantidad', 'Precio', 'Importe', 'Descuento', 'Neto', 'Costo', 'Ganancia', 'Método', 'Precio USD', 'Importe USD'], '5) con descuento y divisa, sus columnas')
  eq(productSalesReport(conTodo, fmt).head.includes('Precio USD'), false, '5) sin el modulo divisas no hay columnas USD')
  eq(repTodo.orientation, 'landscape', '5) horizontal')

  // Sin ventas: un reporte valido que lo dice.
  const vacio = productSalesReport(buildProductSales({ sales: [], productIds: ['A'], ...deps }), fmt)
  ok(vacio.rows.some((r) => r.length === 1 && r[0].content.includes('No hay ventas')), '5) sin ventas lo dice en vez de salir en blanco')
}

console.log(`productSalesHistory: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
