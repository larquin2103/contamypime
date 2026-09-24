// Pruebas PURAS del Control de Ventas Diarias (spec 2026-09-24-control-ventas-diarias-design.md).
// Sin framework: `node src/lib/dailySalesControl.test.mjs`.
//
// QUE CAZA: una fila que no cuadra; un dia que no empieza donde acabo el anterior; un
// movimiento contado en la ubicacion equivocada; una venta con el signo al reves; perder
// gramos; esconder un producto con existencia; y controles que no avisan cuando deben.
import { buildDailyControl, daysBetween, dailyControlReport, MAX_DAYS, HEAD } from './dailySalesControl.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}
const throws = (fn, re, label) => { try { fn(); eq('no lanzo', re.source, label) } catch (e) { eq(re.test(e.message), true, `${label}: ${e.message}`) } }

const D0 = '2026-09-19', D1 = '2026-09-20', D2 = '2026-09-21', D3 = '2026-09-22'
const at = (d, h = '12') => `${d}T${h}:00:00.000Z`
const SAL = 'Salones'
// classify de prueba: el movimiento trae su clave (la real es ledgerKey, inyectada).
const classify = (m) => m.k
const dayOf = (iso) => String(iso || '').slice(0, 10)
const priceOf = (p) => p.price
const P = (id, name, extra = {}) => ({ id, name, unit: 'u', price: 50, categoryId: 'C1', active: true, stockByLocation: {}, ...extra })
const M = (productId, day, k, qty, extra = {}) => ({ id: `${productId}-${day}-${k}-${qty}-${extra.h || ''}`, productId, createdAt: at(day, extra.h || '12'), k, qty, location: SAL, type: 'x', ...extra })
const base = (over = {}) => ({
  products: [], movements: [], sales: [], shifts: [], users: [], orders: [], priceChanges: [],
  productions: [], purchases: [], transfers: [], orderItems: [],
  location: SAL, categoryId: '', from: D1, to: D2, classify, priceOf, dayOf, today: '', ...over
})

// 1. Cada clave va a su columna, la fila cuadra y el dia siguiente arranca donde acabo.
{
  const r = buildDailyControl(base({
    products: [P('a', 'Agua', { stockByLocation: { [SAL]: 9 } })],
    movements: [
      M('a', D0, 'traspIn', 5),
      M('a', D1, 'traspIn', 10), M('a', D1, 'compras', 0), M('a', D1, 'ventas', -3), M('a', D1, 'ventas', 1, { h: '13' }),
      M('a', D1, 'merma', -1), M('a', D1, 'ajustes', -2), M('a', D1, 'deuda', -1)
    ]
  }))
  const f = r.days[0].rows[0]
  eq(f.inicio, 5, 'saldo inicio = todo lo anterior al dia')
  eq(f.entrada, 10, 'entrada')
  eq(f.salida, 1, 'salida (deuda interna) en positivo')
  eq(f.merma, 1, 'merma en positivo')
  eq(f.venta, 2, 'venta neta: -3 +1 de la anulacion')
  eq(f.ajuste, -2, 'ajuste con signo')
  eq(f.final, 9, 'final = 5 + 10 - 1 - 1 - 2 - 2')
  eq(f.final, f.inicio + f.entrada - f.salida - f.merma - f.venta + f.ajuste, 'la fila cuadra')
  eq(f.importe, 100, 'importe = venta x precio')
  eq(r.days[1].rows[0].inicio, 9, 'el dia 2 empieza donde acabo el 1')
  eq(r.days[1].rows[0].final, 9, 'dia 2 sin movimientos: final = inicio')
  eq(r.cacheCheck.ok, true, 'la cache (9) coincide con el libro')
}
// 2. Ubicacion: sin location cuenta en el almacen, no en el area.
{
  const mv = [M('a', D1, 'traspIn', 4, { location: undefined })]
  eq(buildDailyControl(base({ products: [P('a', 'Agua')], movements: mv })).days[0].rows.length, 0, 'sin location: no entra en Salones')
  eq(buildDailyControl(base({ products: [P('a', 'Agua')], movements: mv, location: '__almacen' })).days[0].rows[0]?.entrada, 4, 'sin location: cuenta en el almacen')
}
// 3. Orden alfabetico con tildes y ene; filtro de categoria; los productos en cero no salen.
{
  const products = [P('z', 'Zeta'), P('n', 'Ñame'), P('g', 'Agua'), P('c', 'Ácido', { categoryId: 'C2' }), P('o', 'Otro')]
  const movements = ['z', 'n', 'g', 'c'].map((id) => M(id, D1, 'traspIn', 1)).concat([M('o', D3, 'traspIn', 1)])
  const r = buildDailyControl(base({ products, movements }))
  eq(r.days[0].rows.map((x) => x.name).join(','), 'Ácido,Agua,Ñame,Zeta', 'orden alfabetico es (tilde y ene)')
  eq(r.days[0].rows.some((x) => x.name === 'Otro'), false, 'movimiento fuera del rango: no sale')
  eq(buildDailyControl(base({ products, movements, categoryId: 'C1' })).days[0].rows.map((x) => x.name).join(','), 'Agua,Ñame,Zeta', 'filtro de categoria')
}
// 4. Peso: 3 decimales sin residuo ni perdida de gramos.
{
  const mv = [M('k', D1, 'traspIn', 1.125), M('k', D1, 'ventas', -0.1), M('k', D1, 'ventas', -0.2, { h: '13' })]
  const f = buildDailyControl(base({ products: [P('k', 'Queso', { unit: 'kg' })], movements: mv })).days[0].rows[0]
  eq(f.venta, 0.3, 'peso: 0.1 + 0.2 = 0.3 exacto')
  eq(f.final, 0.825, 'peso: final con sus gramos')
}
// 5. Duplicados de nombre: dos filas separadas.
{
  const r = buildDailyControl(base({ products: [P('b1', 'Bridas'), P('b2', 'Bridas')], movements: [M('b1', D1, 'traspIn', 97), M('b2', D1, 'traspIn', 13)] }))
  eq(r.days[0].rows.length, 2, 'duplicados: dos filas')
  eq(r.days[0].rows.map((x) => x.final).sort((a, b) => a - b).join(','), '13,97', 'cada una con su saldo')
}
// 6. Inactivo con existencia: aparece.
eq(buildDailyControl(base({ products: [P('i', 'Viejo', { active: false })], movements: [M('i', D0, 'traspIn', 3)] })).days[0].rows[0]?.final, 3, 'inactivo con existencia: aparece')
// 7. Cabecera: turnos de la ubicacion que tocan el dia.
{
  const r = buildDailyControl(base({
    products: [P('a', 'Agua')], movements: [M('a', D1, 'traspIn', 1)],
    users: [{ id: 'u1', name: 'Abar' }, { id: 'u2', name: 'Otro' }],
    shifts: [
      { id: 'shift-0000-abc123', area: SAL, sellerId: 'u1', openedAt: at(D1, '08'), closedAt: at(D2, '02') },
      { id: 'shift-9999-zzz999', area: 'Otra', sellerId: 'u2', openedAt: at(D1, '08'), closedAt: null }
    ]
  }))
  eq(r.days[0].folios.join(','), 'ABC123', 'folio corto del turno de la ubicacion')
  eq(r.days[0].sellers.join(','), 'Abar', 'vendedor del turno')
  eq(r.days[1].folios.join(','), 'ABC123', 'el turno que cierra el dia 2 tambien sale el dia 2')
}
// 8. Control de dinero: cuadra, y cuando no, nombra las causas (precio, medianoche, mesa abierta).
{
  const products = [P('a', 'Agua')]
  const movements = [M('a', D1, 'traspIn', 10), M('a', D1, 'ventas', -2, { type: 'sale_out', refType: 'sale', refId: 'S1' })]
  const sale = { id: 'S1', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 2, lineTotal: 100 }], serviceChargeAmount: 10, discountAmount: 0, totalBase: 110 }
  const ok = buildDailyControl(base({ products, movements, sales: [sale] })).days[0].money
  eq(ok.cuadra, true, 'importe 100 = consumo 100: cuadra')
  eq(ok.cobrado, 110, 'cobrado total con servicio')
  eq(ok.servicio, 10, 'servicio aparte')
  const pc = buildDailyControl(base({ products, movements, sales: [{ ...sale, items: [{ productId: 'a', qty: 2, lineTotal: 90 }] }] })).days[0].money
  eq(pc.cuadra, false, 'importe 100 vs consumo 90: no cuadra')
  eq(pc.diferencia, 10, 'diferencia 10')
  eq(pc.causas.some((c) => /precio cobrado distinto/.test(c)), true, `causa precisa: cobrado a 45 y la ficha dice 50 (${pc.causas.join(' | ')})`)
  // Revision (dato real de Burger): un cambio de precio que NO produjo diferencia no se nombra como causa.
  const noPrecio = buildDailyControl(base({ products, movements: [...movements, M('a', D1, 'ventas', 1, { h: '15', type: 'sale_out', refType: 'order_void', refId: 'OX' })], sales: [sale], priceChanges: [{ productId: 'a', createdAt: at(D2) }] })).days[0].money
  eq(noPrecio.causas.some((c) => /precio/.test(c)), false, `un cambio de precio que no explica nada no sale (${noPrecio.causas.join(' | ')})`)
  eq(noPrecio.causas.some((c) => /anulaci[oó]n sin l[ií]nea/.test(c)), true, `causa: movimiento de anulacion sin su linea (${noPrecio.causas.join(' | ')})`)
  const orders = [{ id: 'O1', area: SAL, status: 'closed', openedAt: at(D1, '23'), closedAt: at(D2, '01'), saleId: 'S1' }]
  const mesaMov = [M('a', D1, 'traspIn', 10), M('a', D1, 'ventas', -2, { h: '23', type: 'sale_out', refType: 'order', refId: 'O1' })]
  const lateR = buildDailyControl(base({ products, movements: mesaMov, sales: [{ ...sale, createdAt: at(D2, '01'), orderId: 'O1' }], orders }))
  const late = lateR.days[0].money
  eq(late.causas.some((c) => /cobrado otro d[ií]a/.test(c)), true, `causa: consumo de este dia cobrado otro dia (${late.causas.join(' | ')})`)
  eq(late.sinExplicar, 0, 'medianoche dia 1: nada sin explicar')
  eq(lateR.days[1].money.causas.some((c) => /consumo de otro d[ií]a/.test(c)), true, `dia 2: cobrada con consumo de otro dia (${lateR.days[1].money.causas.join(' | ')})`)
  eq(lateR.days[1].money.sinExplicar, 0, 'medianoche dia 2: nada sin explicar')
  // I1 (revision final): una mesa ABIERTA explica la diferencia en CUALQUIER dia, no solo hoy.
  const abiertas = buildDailyControl(base({ products, movements: [M('a', D1, 'traspIn', 10), M('a', D1, 'ventas', -2, { type: 'sale_out', refType: 'order', refId: 'O2' })], orders: [{ id: 'O2', area: SAL, status: 'open', openedAt: at(D1) }], today: '' })).days[0].money
  eq(abiertas.causas.some((c) => /mesa abierta/.test(c)), true, `causa: mesa abierta, aunque no sea hoy (${abiertas.causas.join(' | ')})`)
  eq(abiertas.sinExplicar, 0, 'mesa abierta: nada sin explicar')
}
// 8b. Revision (dato real de Burger): lineas anuladas DESPUES de cobrar la mesa.
{
  const products = [P('a', 'Agua')]
  const movements = [
    M('a', D1, 'traspIn', 10),
    M('a', D1, 'ventas', -3, { type: 'sale_out', refType: 'order', refId: 'O1' }),
    M('a', D1, 'ventas', 1, { h: '14', type: 'sale_out', refType: 'order_void', refId: 'O1' })
  ]
  const sale = { id: 'S1', orderId: 'O1', createdAt: at(D1, '13'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 3, lineTotal: 150 }], totalBase: 150 }
  const orderItems = [
    { id: 'i1', orderId: 'O1', productId: 'a', qty: 2, voided: false, createdAt: at(D1, '12') },
    { id: 'i2', orderId: 'O1', productId: 'a', qty: 1, voided: true, createdAt: at(D1, '12'), voidedAt: at(D1, '14') }
  ]
  const orders = [{ id: 'O1', area: SAL, status: 'closed', openedAt: at(D1, '11'), closedAt: at(D1, '13') }]
  const m = buildDailyControl(base({ products, movements, sales: [sale], orderItems, orders })).days[0].money
  eq(m.diferencia, -50, 'libro 2 x 50 = 100 vs cobrado 150')
  eq(m.causas.some((c) => /anulado despu[eé]s de cobrar/.test(c)), true, `causa: anulado despues de cobrar (${m.causas.join(' | ')})`)
  eq(m.causasDet.find((c) => c.key === 'anulTrasCobro')?.amount, -50, 'con su importe: -50')
  eq(m.sinExplicar, 0, 'y nada queda sin explicar')
}
// C1 (revision final, dato real de Burger: mesa a4f37f9b). Mesa abierta un dia, NUNCA cobrada,
// anulada dias despues: la causa NO puede ser "cobrada otro dia", y el dia de la anulacion
// (Venta negativa) tiene que explicarse.
{
  const products = [P('a', 'Agua')]
  const movements = [
    M('a', D0, 'traspIn', 10),
    M('a', D1, 'ventas', -2, { type: 'sale_out', refType: 'order', refId: 'O3' }),
    M('a', D2, 'ventas', 2, { type: 'sale_out', refType: 'order_void', refId: 'O3' })
  ]
  const orders = [{ id: 'O3', area: SAL, status: 'voided', openedAt: at(D1), closedAt: at(D2), saleId: null }]
  const orderItems = [{ id: 'i3', orderId: 'O3', productId: 'a', qty: 2, voided: true, createdAt: at(D1), voidedAt: at(D2) }]
  const r = buildDailyControl(base({ products, movements, orders, orderItems }))
  const d1 = r.days[0].money, d2 = r.days[1].money
  eq(d1.causas.some((c) => /cobrad/.test(c)), false, `dia 1: no dice que se cobro (${d1.causas.join(' | ')})`)
  eq(d1.causas.some((c) => /mesa anulada sin cobrar/.test(c)), true, `dia 1: mesa anulada sin cobrar (${d1.causas.join(' | ')})`)
  eq(d1.causasDet.find((c) => c.key === 'anuladaSinCobro')?.amount, 100, 'dia 1: +100')
  eq(d2.causas.some((c) => /mesa anulada sin cobrar/.test(c)), true, `dia 2: la devolucion tambien se explica (${d2.causas.join(' | ')})`)
  eq(d2.causasDet.find((c) => c.key === 'anuladaSinCobro')?.amount, -100, 'dia 2: -100')
  eq(d1.sinExplicar + d2.sinExplicar, 0, 'nada sin explicar')
  eq(r.days[1].rows[0].venta, -2, 'la Venta negativa del libro se conserva (es el dato), pero ya explicada')
}
// 8c. Revision (dato real de Burger 22-09 tarde, mesa 143f3098). Consumo 3 u; una
// anulacion ANTES del cobro que el detector marca huerfana (su linea quedo sellada con la
// hora de la anulacion posterior); se cobran 2 u; DESPUES del cobro se anulan las 3 lineas.
// Lo anterior al cobro cuadra en unidades (3 - 1 = 2): TODA la diferencia es lo devuelto
// al stock tras cobrar. Antes se partia en "anulacion sin linea" -50 + un resto +50 que se
// llamaba "linea cobrada sin su movimiento": el total estaba bien y el reparto era falso.
{
  const products = [P('a', 'Agua')]
  const orders = [{ id: 'O5', area: SAL, status: 'closed', openedAt: at(D1, '10'), closedAt: at(D1, '13'), saleId: 'S5' }]
  const V = (h, n) => M('a', D1, 'ventas', 1, { h, type: 'sale_out', refType: 'order_void', refId: 'O5', id: `v-${h}-${n}` })
  const movs = [
    M('a', D0, 'traspIn', 10),
    M('a', D1, 'ventas', -3, { h: '11', type: 'sale_out', refType: 'order', refId: 'O5' }),
    V('12', 1), V('16', 1), V('16', 2), V('16', 3)
  ]
  const lines = [1, 2, 3].map((n) => ({ id: `i${n}`, orderId: 'O5', productId: 'a', qty: 1, voided: true, voidedAt: at(D1, '16'), createdAt: at(D1, '11') }))
  const sale = { id: 'S5', orderId: 'O5', createdAt: at(D1, '13'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 2, lineTotal: 100 }], totalBase: 100 }
  const m = buildDailyControl(base({ products, movements: movs, sales: [sale], orders, orderItems: lines })).days[0].money
  eq(m.diferencia, -150, 'libro -1 u x 50 - cobrado 100 = -150')
  eq(m.causasDet.find((c) => c.key === 'anulTrasCobro')?.amount, -150, `todo es lo devuelto tras cobrar: -150 (${m.causas.join(' | ')})`)
  eq(m.causasDet.some((c) => c.key === 'lineaSinMov'), false, 'sin un falso "cobrado sin movimiento"')
  eq(m.causasDet.some((c) => c.key === 'anulSinLinea'), false, 'la anulacion previa al cobro YA esta reflejada en lo cobrado')
  eq(m.sinExplicar, 0, 'nada sin explicar')
  // El signo del resto, en los dos sentidos (mesa cobrada el mismo dia, sin anulaciones):
  const cons = (u, cob) => buildDailyControl(base({ products, orders, movements: [M('a', D0, 'traspIn', 10), M('a', D1, 'ventas', -u, { h: '11', type: 'sale_out', refType: 'order', refId: 'O5' })], sales: [{ ...sale, items: [{ productId: 'a', qty: cob, lineTotal: cob * 50 }] }] })).days[0].money
  const mas = cons(2, 1)
  eq(mas.causasDet.find((c) => c.key === 'consumoNoCobrado')?.amount, 50, `consumo del libro que no entro en la venta: +50 (${mas.causas.join(' | ')})`)
  eq(mas.causasDet.some((c) => c.key === 'lineaSinMov'), false, 'NO se le llama "cobrado sin movimiento" a lo contrario')
  const menos = cons(1, 2)
  eq(menos.causasDet.find((c) => c.key === 'lineaSinMov')?.amount, -50, `cobrado mas de lo consumido en el libro: -50 (${menos.causas.join(' | ')})`)
  eq(mas.sinExplicar + menos.sinExplicar, 0, 'nada sin explicar')
  // Las unidades que deciden son las de ANTES del cobro, no las netas: consumo 3, 1 anulada
  // antes, 2 cobradas a 40 (no a 50), 1 anulada despues. En neto el libro dice 1 u y la
  // venta 2 (pareceria "cobrado sin movimiento"); lo verdadero es precio +20 y -50 devuelto.
  const mix = buildDailyControl(base({ products, orders, sales: [{ ...sale, items: [{ productId: 'a', qty: 2, lineTotal: 80 }] }], movements: [
    M('a', D0, 'traspIn', 10),
    M('a', D1, 'ventas', -3, { h: '11', type: 'sale_out', refType: 'order', refId: 'O5' }),
    V('12', 1), V('16', 1)
  ], orderItems: [{ id: 'i1', orderId: 'O5', productId: 'a', qty: 1, voided: true, voidedAt: at(D1, '12'), createdAt: at(D1, '11') }, { id: 'i2', orderId: 'O5', productId: 'a', qty: 1, voided: true, voidedAt: at(D1, '16'), createdAt: at(D1, '11') }] })).days[0].money
  eq(mix.causasDet.find((c) => c.key === 'precio')?.amount, 20, `precio: 2 u x (50 - 40) = +20 (${mix.causas.join(' | ')})`)
  eq(mix.causasDet.find((c) => c.key === 'anulTrasCobro')?.amount, -50, 'devuelto tras cobrar: -50')
  eq(mix.sinExplicar, 0, 'nada sin explicar')
  // Patron real de la mesa 180a7687 (A1 y A2 de Burger): una anulacion DUPLICADA antes del
  // cobro -el libro devolvio mas de lo consumido-. Ahi el detector acierta: es "anulacion
  // sin linea", no "falta un movimiento de consumo". Consumo 2; linea i1 anulada con su
  // movimiento + un movimiento de anulacion extra sin linea; se cobra 1 u.
  const dup = (cob, extra = []) => buildDailyControl(base({ products, orders, sales: [{ ...sale, items: [{ productId: 'a', qty: cob, lineTotal: cob * 50 }] }], movements: [
    M('a', D0, 'traspIn', 10),
    M('a', D1, 'ventas', -2, { h: '11', type: 'sale_out', refType: 'order', refId: 'O5' }),
    V('12', 1), V('12', 2), ...extra
  ], orderItems: [{ id: 'i1', orderId: 'O5', productId: 'a', qty: 1, voided: true, voidedAt: at(D1, '12'), createdAt: at(D1, '11') }, { id: 'i2', orderId: 'O5', productId: 'a', qty: 1, voided: false, createdAt: at(D1, '11') }] })).days[0].money
  const d1 = dup(1)
  eq(d1.causasDet.find((c) => c.key === 'anulSinLinea')?.amount, -50, `anulacion duplicada: -50 (${d1.causas.join(' | ')})`)
  eq(d1.causasDet.some((c) => c.key === 'lineaSinMov'), false, 'no se inventa un movimiento de consumo faltante')
  // Mixto: ademas se cobra 1 u de mas -> la huerfana explica SU importe y solo el resto es lineaSinMov.
  const d2 = dup(2)
  eq(d2.causasDet.find((c) => c.key === 'anulSinLinea')?.amount, -50, `mixto, la huerfana: -50 (${d2.causas.join(' | ')})`)
  eq(d2.causasDet.find((c) => c.key === 'lineaSinMov')?.amount, -50, 'mixto, lo cobrado de mas: -50')
  eq(d1.sinExplicar + d2.sinExplicar, 0, 'nada sin explicar')
}
// 9. Cache: la que difiere se lista.
{
  const r = buildDailyControl(base({ products: [P('a', 'Agua', { stockByLocation: { [SAL]: 7 } })], movements: [M('a', D1, 'traspIn', 9)] }))
  eq(r.cacheCheck.ok, false, 'cache distinta del libro: no ok')
  eq(`${r.cacheCheck.diffs[0].name}:${r.cacheCheck.diffs[0].libro}:${r.cacheCheck.diffs[0].cache}`, 'Agua:9:7', 'se lista con libro y cache')
}
// 10. Integridad: venta sin su movimiento en el rango.
{
  const sale = { id: 'S9', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'a', lineTotal: 50 }], totalBase: 50 }
  const r = buildDailyControl(base({ products: [P('a', 'Agua')], movements: [M('a', D1, 'traspIn', 1)], sales: [sale] }))
  eq(r.integrity.ok, false, 'venta sin movimiento: integridad no ok')
  eq(r.integrity.counts['sale-sin-mov'], 1, 'cuenta exacta')
  eq(r.days[0].money.causas.some((c) => /sin movimiento/.test(c)), true, 'y sale como causa del dia')
}
// 11. Clave desconocida: va a Ajuste y se cuenta (no se pierde en silencio).
{
  const r = buildDailyControl(base({ products: [P('a', 'Agua')], movements: [M('a', D1, 'raro', 4)] }))
  eq(r.days[0].rows[0].ajuste, 4, 'clave desconocida en ajuste')
  eq(r.unclassified, 1, 'y contada')
}
// 12. Rango.
throws(() => daysBetween('', ''), /Desde/, 'sin desde')
throws(() => daysBetween(D2, D1), /anterior/, 'hasta < desde')
throws(() => daysBetween('2026-01-01', '2026-03-01'), new RegExp(String(MAX_DAYS)), 'mas de 31 dias')
eq(daysBetween(D1, '').join(','), D1, 'hasta vacio = un dia')
eq(daysBetween('2026-02-27', '2026-03-01').join(','), '2026-02-27,2026-02-28,2026-03-01', 'cruza fin de mes')
throws(() => buildDailyControl(base({ location: '' })), /ubicaci/, 'sin ubicacion')
// 13. Formato del reporte.
{
  const res = buildDailyControl(base({ products: [P('a', 'Agua')], movements: [M('a', D1, 'traspIn', 1)] }))
  const rep = dailyControlReport(res, { locationName: 'Salones', categoryName: '', from: D1, to: D2 })
  eq(rep.head.join('|'), HEAD.join('|'), 'cabecera de 10 columnas')
  eq(rep.title, 'Control de Ventas Diarias', 'titulo')
  const texto = rep.rows.filter((r) => r.length === 1)
  eq(rep.rows.every((r) => r.length === 10 || (r.length === 1 && r[0].colSpan === 10 && typeof r[0].content === 'string')), true, 'filas de 10 celdas, o de texto a lo ancho (colSpan 10)')
  eq(texto.length > 0, true, 'las lineas de texto van a lo ancho')
  const txt = (r) => (typeof r[0] === 'object' ? r[0].content : String(r[0]))
  eq(rep.rows.some((r) => txt(r).includes(D1) && txt(r).includes('Entregado por')), true, 'separador de dia con cabecera')
  eq(JSON.stringify(rep.rows).includes('✔'), false, 'sin el caracter ✔ (jsPDF no lo tiene)')
  eq(rep.rows.some((r) => /CUADRA/.test(txt(r))), true, 'el control de dinero dice CUADRA o NO CUADRA')
}

console.log(`dailySalesControl: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
