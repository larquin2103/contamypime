// Pruebas PURAS de los reportes de salidas de caja (Reportes): deudas internas.
// Sin framework: ejecutar con  `node src/lib/cashOutReports.test.mjs`.
//
// QUE EXISTE ESTA SUITE PARA CAZAR: que el reporte diga algo distinto de lo que
// hay en los datos. Cuatro cosas tienen que cumplirse siempre:
//   a) solo entran las deudas del rango de dias LOCALES pedido (inclusivo);
//   b) la ubicacion sale del movimiento de ESA deuda (`refId`), nunca de otro
//      movimiento del mismo producto;
//   c) las columnas de moneda solo existen si hay una deuda en divisa y el modulo
//      `divisas` esta activo (data-driven, como el resto de reportes);
//   d) el total y el resumen por deudor son la suma exacta de las filas.
import { buildDebts, debtsReport } from './cashOutReports.js'

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

const deps = {
  dayOf: (iso) => String(iso || '').slice(0, 10),
  userName: (id) => id || '',
  locationName: (l) => 'L:' + l
}
const products = {
  A: { id: 'A', name: 'Arroz', unit: 'kg' },
  B: { id: 'B', name: 'Refresco', unit: 'u' },
  U: { id: 'U', name: 'Ron', unit: 'u', priceCurrency: 'USD' }
}
const debt = (o) => ({
  id: 'd?', productId: 'A', qty: 1, valueAtTime: 10, userId: 'Aylin', registeredBy: 'Vendedor',
  authorizedBy: 'Yuniel', note: '', settled: false, createdAt: '2026-11-01T10:00:00', ...o
})
const mov = (d, location) => ({ id: 'm-' + d.id, productId: d.productId, type: 'internal_debt_out', refType: 'internal_debt', refId: d.id, location })
const isText = (r) => r.length === 1 && r[0] && typeof r[0] === 'object' && 'colSpan' in r[0]
const textOf = (rows) => rows.filter(isText).map((r) => r[0].content)

// D1 rango inclusivo por dia local
{
  const ds = [
    debt({ id: 'd1', createdAt: '2026-11-01T10:00:00' }),
    debt({ id: 'd2', createdAt: '2026-11-05T00:00:00' }),
    debt({ id: 'd3', createdAt: '2026-11-10T23:59:59' })
  ]
  eq(buildDebts({ debts: ds, products, ...deps, from: '2026-11-05', to: '2026-11-10' }).lines.length, 2, 'D1) rango inclusivo: 2 lineas')
  eq(buildDebts({ debts: ds, products, ...deps }).lines.length, 3, 'D1) sin rango: 3 lineas')
}

// D2 orden: la mas reciente primero
{
  const ds = [debt({ id: 'd1', createdAt: '2026-11-01T10:00:00' }), debt({ id: 'd2', createdAt: '2026-11-09T10:00:00' }), debt({ id: 'd3', createdAt: '2026-11-05T10:00:00' })]
  const r = buildDebts({ debts: ds, products, ...deps })
  eq(r.lines.map((l) => l.at), ['2026-11-09T10:00:00', '2026-11-05T10:00:00', '2026-11-01T10:00:00'], 'D2) mas recientes primero')
}

// D3 ubicacion: por refId, no por producto. Dos deudas del MISMO producto.
{
  const d1 = debt({ id: 'd1', productId: 'A', createdAt: '2026-11-02T10:00:00' })
  const d2 = debt({ id: 'd2', productId: 'A', createdAt: '2026-11-03T10:00:00' })
  const r = buildDebts({ debts: [d1, d2], movements: [mov(d1, 'Víveres')], products, ...deps })
  const l1 = r.lines.find((l) => l.at === d1.createdAt)
  const l2 = r.lines.find((l) => l.at === d2.createdAt)
  eq(l1.location, 'L:Víveres', 'D3) la deuda con movimiento lleva su ubicacion')
  eq(l2.location, '', 'D3) la deuda del mismo producto sin movimiento NO hereda la ubicacion')
  eq(r.missingMovements, 1, 'D3) una deuda sin movimiento')
  const rep = debtsReport(r)
  const row2 = rep.rows.find((x) => !isText(x) && x[0] === d2.createdAt)
  eq(row2[2], '—', 'D3) celda de ubicacion vacia sale como —')
  ok(textOf(rep.rows).some((t) => t.includes('1 deuda')), 'D3) aviso de deudas sin movimiento')
  // sin deudas sin movimiento no hay aviso
  const sinAviso = debtsReport(buildDebts({ debts: [d1], movements: [mov(d1, 'Víveres')], products, ...deps }))
  ok(!textOf(sinAviso.rows).some((t) => t.includes('movimiento')), 'D3) sin faltantes no hay aviso')
  // un movimiento de otro tipo con el mismo refId no cuenta
  const rx = buildDebts({ debts: [d1], movements: [{ ...mov(d1, 'Víveres'), refType: 'sale' }], products, ...deps })
  eq(rx.missingMovements, 1, 'D3) refType distinto no cuenta como movimiento de la deuda')
}

// D4 producto inexistente
{
  const r = buildDebts({ debts: [debt({ id: 'd1', productId: 'ZZ' })], products, ...deps })
  eq(r.lines[0].product, '(producto no encontrado)', 'D4) producto inexistente: texto')
  eq(r.lines[0].unit, '', 'D4) producto inexistente: unidad vacia')
}

// D5 quien autorizo
{
  const r = buildDebts({ debts: [debt({ id: 'd1', authorizedBy: '' }), debt({ id: 'd2', authorizedBy: 'Yuniel', createdAt: '2026-11-02T10:00:00' })], products, ...deps })
  const rep = debtsReport(r)
  const filas = rep.rows.filter((x) => !isText(x) && x[0] !== '' && x[0] !== 'TOTAL')
  const i = rep.head.indexOf('Autorizó')
  eq(filas.map((f) => f[i]), ['Yuniel', '—'], 'D5) autorizo vacio -> —, con nombre -> nombre')
}

// D6 estado
{
  const lbl = (m) => ({ payroll: 'Descontada del pago' }[m])
  const ds = [
    debt({ id: 'd1', createdAt: '2026-11-03T10:00:00' }),
    debt({ id: 'd2', createdAt: '2026-11-02T10:00:00', settled: true, settledAt: '2026-11-07T10:00', settleMethod: 'payroll', settleNote: 'abril' }),
    debt({ id: 'd3', createdAt: '2026-11-01T10:00:00', note: 'x', settled: true, settledAt: '2026-11-07T10:00', settleMethod: 'payroll', settleNote: 'abril' })
  ]
  const rep = debtsReport(buildDebts({ debts: ds, products, ...deps }), { settleLabel: lbl })
  const iE = rep.head.indexOf('Estado')
  const iN = rep.head.indexOf('Nota')
  const filas = rep.rows.filter((x) => !isText(x) && x[0] !== '' && x[0] !== 'TOTAL')
  eq(filas[0][iE], 'Pendiente', 'D6) pendiente')
  eq(filas[1][iE], 'Saldada 2026-11-07T10:00 · Descontada del pago', 'D6) saldada con fecha y forma')
  eq(filas[1][iN], 'Saldo: abril', 'D6) sin nota propia, solo la del saldo')
  eq(filas[2][iN], 'x · Saldo: abril', 'D6) nota y nota del saldo')
  eq(filas[0][iN], '', 'D6) sin notas la celda queda vacia')
}

// D7 resumen por deudor
{
  const ds = [
    debt({ id: 'd1', userId: 'Beto', valueAtTime: 30, qty: 3, createdAt: '2026-11-03T10:00:00' }),
    debt({ id: 'd2', userId: 'Aylin', valueAtTime: 100, qty: 7, createdAt: '2026-11-02T10:00:00' }),
    debt({ id: 'd3', userId: 'Aylin', valueAtTime: 50, qty: 9, settled: true, settledAt: '2026-11-07T10:00', createdAt: '2026-11-01T10:00:00' })
  ]
  const r = buildDebts({ debts: ds, products, ...deps })
  eq(r.byDebtor, [
    { debtor: 'Aylin', count: 2, byCurrency: { MN: { total: 150, pending: 100, settled: 50 } } },
    { debtor: 'Beto', count: 1, byCurrency: { MN: { total: 30, pending: 30, settled: 0 } } }
  ], 'D7) resumen por deudor, alfabetico')
  ok(r.byDebtor.every((x) => !('qty' in x) && !Object.values(x.byCurrency).some((c) => 'qty' in c)), 'D7) el resumen no suma cantidades')
}

// D8 / D9 moneda
{
  const dU = debt({ id: 'd1', productId: 'U', valueAtTime: 20, createdAt: '2026-11-02T10:00:00' })
  const dB = debt({ id: 'd2', productId: 'B', valueAtTime: 240, createdAt: '2026-11-01T10:00:00' })
  const r0 = buildDebts({ debts: [dU, dB], products, ...deps, divisas: false })
  eq(r0.lines.map((l) => l.currency), ['MN', 'MN'], 'D8) sin divisas todo es MN')
  eq(r0.foreign, false, 'D8) foreign false')
  const rep0 = debtsReport(r0)
  ok(!rep0.head.includes('Moneda'), 'D8) sin columna Moneda')
  eq(rep0.head.length, 11, 'D8) 11 columnas')
  eq(rep0.head, ['Fecha', 'Producto', 'Ubicación', 'Cantidad', 'U/M', 'Valor', 'Deudor', 'Autorizó', 'Registró', 'Estado', 'Nota'], 'D8) cabecera clasica')

  const r1 = buildDebts({ debts: [dU, dB], products, ...deps, divisas: true })
  eq(r1.foreign, true, 'D9) foreign true')
  eq(r1.totals, { MN: 240, USD: 20 }, 'D9) totales por moneda')
  const rep1 = debtsReport(r1)
  eq(rep1.head.length, 12, 'D9) 12 columnas')
  eq(rep1.head.indexOf('Moneda'), rep1.head.indexOf('Valor') + 1, 'D9) Moneda tras Valor')
  ok(textOf(rep1.rows).some((t) => t.includes('se deduce')), 'D9) aviso de moneda deducida')
  ok(!textOf(rep0.rows).some((t) => t.includes('se deduce')), 'D8) sin divisas no hay aviso de moneda')
  // divisas activas pero sin productos en divisa: identico a D8
  const r2 = buildDebts({ debts: [dB], products, ...deps, divisas: true })
  eq(debtsReport(r2).head, rep0.head, 'D9) divisas sin productos en divisa: cabecera identica')
}

// D10 total
{
  const ds = [debt({ id: 'd1', valueAtTime: 10.1 }), debt({ id: 'd2', valueAtTime: 20.2, createdAt: '2026-11-02T10:00:00' }), debt({ id: 'd3', valueAtTime: 0.3, createdAt: '2026-11-03T10:00:00' })]
  const r = buildDebts({ debts: ds, products, ...deps })
  eq(r.totals.MN, round2(r.lines.reduce((a, l) => a + l.value, 0)), 'D10) total = suma de las lineas')
  const rep = debtsReport(r)
  const t = rep.rows.find((x) => !isText(x) && x[0] === 'TOTAL')
  eq(t[rep.head.indexOf('Valor')], 30.6, 'D10) la fila TOTAL lleva ese numero')
}

// D11 vacio
{
  const rep = debtsReport(buildDebts({ debts: [], products, ...deps }))
  eq(rep.rows, [[{ content: 'Sin deudas internas en el periodo.', colSpan: rep.head.length }]], 'D11) vacio dice que no hay nada')
}

// D12 forma
{
  const ds = [
    debt({ id: 'd1', productId: 'U', createdAt: '2026-11-02T10:00:00' }),
    debt({ id: 'd2', productId: 'B', createdAt: '2026-11-01T10:00:00', settled: true, settledAt: '2026-11-07T10:00' })
  ]
  for (const divisas of [false, true]) {
    const rep = debtsReport(buildDebts({ debts: ds, products, ...deps, divisas }))
    ok(rep.rows.every((r) => isText(r) ? r[0].colSpan === rep.head.length : r.length === rep.head.length), `D12) forma de filas (divisas=${divisas})`)
  }
  const rep = debtsReport(buildDebts({ debts: ds, products, ...deps }), { from: '2026-11-01', to: '2026-11-30' })
  eq([rep.title, rep.filename, rep.orientation], ['Deudas internas', 'deudas_internas', 'landscape'], 'D12) titulo, fichero y orientacion')
  eq(rep.subtitle, 'Periodo: 2026-11-01 a 2026-11-30', 'D12) subtitulo con periodo')
  eq(debtsReport(buildDebts({ debts: ds, products, ...deps })).subtitle, 'Todo el periodo', 'D12) subtitulo sin periodo')
}

// D13 resumen por deudor en el reporte
{
  const dU = debt({ id: 'd1', productId: 'U', userId: 'Aylin', valueAtTime: 20, createdAt: '2026-11-03T10:00:00' })
  const dB = debt({ id: 'd2', productId: 'B', userId: 'Aylin', valueAtTime: 240, settled: true, settledAt: '2026-11-07T10:00', createdAt: '2026-11-02T10:00:00' })
  const dC = debt({ id: 'd3', productId: 'B', userId: 'Beto', valueAtTime: 30, createdAt: '2026-11-01T10:00:00' })
  const fm = (v, c) => `${v}${c}`
  const rep = debtsReport(buildDebts({ debts: [dU, dB, dC], products, ...deps, divisas: true }), { formatMoney: fm })
  const t = textOf(rep.rows)
  const i = t.indexOf('Resumen por deudor')
  ok(i >= 0, 'D13) titulo del resumen como fila de texto')
  const lineas = t.slice(i + 1)
  ok(lineas.some((x) => x.startsWith('Aylin') && x.includes('2 deudas') && x.includes('total 240MN') && x.includes('saldado 240MN') && x.includes('pendiente 0MN')), 'D13) Aylin en MN')
  ok(lineas.some((x) => x.startsWith('Aylin') && x.includes('total 20USD') && x.includes('pendiente 20USD')), 'D13) Aylin en USD')
  ok(lineas.some((x) => x.startsWith('Beto') && x.includes('1 deuda') && x.includes('total 30MN')), 'D13) Beto')
  // el orden de los pies: TOTAL, aviso de moneda, resumen
  const pos = (f) => rep.rows.findIndex(f)
  ok(pos((r) => !isText(r) && r[0] === 'TOTAL') < pos((r) => isText(r) && r[0].content.includes('se deduce')) &&
    pos((r) => isText(r) && r[0].content.includes('se deduce')) < pos((r) => isText(r) && r[0].content === 'Resumen por deudor'), 'D13) orden del pie')
}

console.log(`cashOutReports: ${pass} OK / ${fail} fallos`)
if (fail) process.exit(1)
