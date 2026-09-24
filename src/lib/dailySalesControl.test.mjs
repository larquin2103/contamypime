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
// 8. CONTROL DE DINERO DESCRIPTIVO (tras tres revisiones independientes: inferir la CAUSA
// desde los totales del libro es ambiguo y dio causas falsas en cada ronda). El control
// ya no nombra causas: descompone la diferencia EXACTAMENTE en precio (linea a linea) +
// redondeo + descuadre de unidades, y cada mesa o venta con descuadre sale con sus HECHOS
// (libro y cobrado por producto, estado, cobros, anulaciones, otros dias). Quien lee concluye.
// Todos los escenarios de las tres revisiones siguen aqui, afirmando hechos.
const r2t = (x) => Math.round(x * 100) / 100
const money = (over) => buildDailyControl(base(over)).days
// Invariante de TODO dia: las partes impresas suman la diferencia impresa y nada queda sin explicar.
const exacta = (m, label) => {
  eq(r2t(m.precio.amount + (m.lineaImporte?.amount || 0) + (m.cantidad?.amount || 0) + (m.sinFicha?.amount || 0) + (m.fichaDecimales?.amount || 0) + m.redondeo + m.unidades.amount), m.diferencia, `${label}: las partes = diferencia`)
  eq(m.sinExplicar, 0, `${label}: nada sin explicar`)
}
// Ausente = vacio: una prueba que no encuentra la mesa FALLA limpia, no revienta la suite.
const grupo = (m, id) => m.unidades.grupos.find((g) => g.id === id) || { productos: [], hechos: { cobros: [], hoy: {}, otrosDias: [] } }
const prod = (g, pid) => g.productos.find((p) => p.productId === pid) || {}
{
  const products = [P('a', 'Agua')]
  const mv = [M('a', D0, 'traspIn', 10), M('a', D1, 'ventas', -2, { type: 'sale_out', refType: 'sale', refId: 'S1' })]
  const sale = { id: 'S1', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 2, unitPrice: 50, lineTotal: 100 }], totalBase: 100 }
  // 8.1 Cobrado a precio de ficha: CUADRA y no hay desglose.
  const ok = money({ products, movements: mv, sales: [sale] })[0].money
  eq(ok.cuadra, true, 'cuadra')
  eq(`${ok.importe}|${ok.consumo}|${ok.diferencia}`, '100|100|0', 'importe = consumo cobrado')
  eq(ok.precio.n + ok.unidades.grupos.length, 0, 'sin desglose')
  exacta(ok, '8.1')
  // 8.2 Cobrado a otro precio: la diferencia es PRECIO, con la linea como hecho.
  const pc = money({ products, movements: mv, sales: [{ ...sale, items: [{ productId: 'a', qty: 2, unitPrice: 40, lineTotal: 80 }] }] })[0].money
  eq(`${pc.precio.n}|${pc.precio.amount}`, '1|20', 'precio: 1 linea, 2 u x (50 - 40) = +20')
  eq(`${pc.precio.detalle[0]?.name}|${pc.precio.detalle[0]?.qty}|${pc.precio.detalle[0]?.unitPrice}|${pc.precio.detalle[0]?.ficha}`, 'Agua|2|40|50', 'la linea cobrada, tal cual')
  eq(pc.unidades.grupos.length, 0, 'sin descuadre de unidades')
  exacta(pc, '8.2')
  // 8.3 Dos cobros mal hechos que se COMPENSAN no desaparecen (regresion de la 2a revision).
  const cmp = money({ products, movements: [M('a', D0, 'traspIn', 9), M('a', D1, 'ventas', -1, { h: '10', type: 'sale_out', refType: 'sale', refId: 'cx' }), M('a', D1, 'ventas', -1, { h: '11', type: 'sale_out', refType: 'sale', refId: 'cy' })],
    sales: [{ id: 'cx', createdAt: at(D1, '10'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 1, unitPrice: 55, lineTotal: 55 }], totalBase: 55 },
      { id: 'cy', createdAt: at(D1, '11'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 1, unitPrice: 45, lineTotal: 45 }], totalBase: 45 }] })[0].money
  eq(`${cmp.diferencia}|${cmp.precio.n}|${cmp.precio.amount}`, '0|2|0', 'diferencia 0, pero 2 lineas a otro precio a la vista')
  exacta(cmp, '8.3')
}
// 8.4 Pesadas: cada linea se cobra redondeada al centavo. La diferencia es REDONDEO, sin
// ningun precio falso, con una o con varias lineas por venta (1a y 2a revision).
{
  const carne = P('k', 'Carne', { unit: 'kg', price: 13.37 })
  const mv = [M('k', D0, 'traspIn', 10)], sales = []
  for (let i = 0; i < 3; i++) {
    mv.push(M('k', D1, 'ventas', -0.333, { h: '1' + i, type: 'sale_out', refType: 'sale', refId: 'kw' + i }))
    sales.push({ id: 'kw' + i, createdAt: at(D1, '1' + i), sourceLocation: SAL, voided: false, items: [{ productId: 'k', qty: 0.333, unitPrice: 13.37, lineTotal: 4.45 }], totalBase: 4.45 })
  }
  const w = money({ products: [carne], movements: mv, sales })[0].money
  eq(`${w.diferencia}|${w.redondeo}|${w.precio.n}|${w.unidades.grupos.length}`, '0.01|0.01|0|0', 'pesadas: todo es redondeo')
  eq(w.soloRedondeo, true, 'y se dice que es solo redondeo')
  exacta(w, '8.4a')
  const two = money({ products: [P('k', 'Carne', { unit: 'kg', price: 3.33 }), P('j', 'Cerdo', { unit: 'kg', price: 3.33 })],
    movements: [M('k', D0, 'traspIn', 9), M('j', D0, 'traspIn', 9), M('k', D1, 'ventas', -0.125, { type: 'sale_out', refType: 'sale', refId: 'h2' }), M('j', D1, 'ventas', -0.125, { type: 'sale_out', refType: 'sale', refId: 'h2' })],
    sales: [{ id: 'h2', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'k', qty: 0.125, unitPrice: 3.33, lineTotal: 0.42 }, { productId: 'j', qty: 0.125, unitPrice: 3.33, lineTotal: 0.42 }], totalBase: 0.84 }] })[0].money
  eq(`${two.diferencia}|${two.redondeo}|${two.precio.n}`, '-0.01|-0.01|0', 'varias lineas pesadas: redondeo, ningun precio')
  exacta(two, '8.4b')
  // Precio de mesa congelado sin redondear (33.333 frente a la ficha 33.33): es redondeo del
  // precio, no un cambio de precio (3a revision, M1: salia "precio: 0 casos").
  const m1 = money({ products: [P('a', 'Agua', { price: 33.33 })], orders: [{ id: 'OM', area: SAL, status: 'closed' }],
    movements: [M('a', D0, 'traspIn', 50), M('a', D1, 'ventas', -10, { h: '10', type: 'sale_out', refType: 'order', refId: 'OM' })],
    sales: [{ id: 'VM', orderId: 'OM', createdAt: at(D1, '11'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 10, unitPrice: 33.333, lineTotal: 333.33 }], totalBase: 333.33 }] })[0].money
  eq(`${m1.precio.n}|${m1.precio.amount}|${m1.unidades.grupos.length}`, '1|-0.03|0', 'precio sub-centavo por unidad: 3 centavos en la linea, es precio (4a revision)')
  exacta(m1, '8.4c')
  // Caso hallado por fuerza bruta: el precio se imprime EXACTO (1.329 x (11.32 - 11.39) = -0.09).
  const fz = money({ products: [P('f', 'F1', { unit: 'kg', price: 11.32 }), P('g', 'F2', { unit: 'kg', price: 5.97 })],
    movements: [M('f', D0, 'traspIn', 10), M('g', D0, 'traspIn', 10), M('f', D1, 'ventas', -1.329, { h: '10', type: 'sale_out', refType: 'sale', refId: 'fz1' }), M('g', D1, 'ventas', -0.811, { h: '11', type: 'sale_out', refType: 'sale', refId: 'fz2' })],
    sales: [{ id: 'fz1', createdAt: at(D1, '10'), sourceLocation: SAL, voided: false, items: [{ productId: 'f', qty: 1.329, unitPrice: 11.39, lineTotal: 15.14 }], totalBase: 15.14 },
      { id: 'fz2', createdAt: at(D1, '11'), sourceLocation: SAL, voided: false, items: [{ productId: 'g', qty: 0.811, unitPrice: 5.97, lineTotal: 4.84 }], totalBase: 4.84 }] })[0].money
  eq(fz.precio.amount, -0.09, 'precio exacto')
  exacta(fz, '8.4d')
}
// 8.4e Cantidad del libro con mas de 3 decimales (3a revision, M2): el Importe usa la milesima
// y el libro el crudo; la diferencia es redondeo de cantidad, no "Sin explicar".
{
  const q4 = money({ products: [P('k', 'Carne', { unit: 'kg', price: 3000 })], movements: [M('k', D0, 'traspIn', 9), M('k', D1, 'ventas', -0.2504, { type: 'sale_out', refType: 'sale', refId: 'Q4' })],
    sales: [{ id: 'Q4', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'k', qty: 0.25, unitPrice: 3000, lineTotal: 750 }], totalBase: 750 }] })[0].money
  // Cuadra, pero el HECHO existe y se muestra (4a revision): salieron del libro 0,0004 kg sin
  // cobrar (+1,20) y la columna a la milesima lo compensa (-1,20).
  eq(`${q4.diferencia}|${q4.sinExplicar}|${q4.cantidad.amount}|${q4.unidades.amount}`, '0|0|-1.2|1.2', 'cuadra, con sus dos hechos a la vista')
  eq(`${prod(grupo(q4, 'Q4'), 'k').libro}|${prod(grupo(q4, 'Q4'), 'k').cobrado}`, '0.2504|0.25', 'el libro en crudo, no a la milesima')
}
// 8.5 Mesas: el descuadre de unidades sale como HECHOS, por mesa y producto.
{
  const products = [P('a', 'Agua')]
  const ord = (id, status, extra = {}) => ({ id, area: SAL, table: 'Mesa 1', status, openedAt: at(D1, '09'), ...extra })
  // Anulada dias despues sin cobrar (C1 de la 1a revision).
  const an = money({ products, orders: [ord('O1', 'voided')], movements: [M('a', D0, 'traspIn', 10), M('a', D1, 'ventas', -2, { type: 'sale_out', refType: 'order', refId: 'O1' }), M('a', D2, 'ventas', 2, { type: 'sale_out', refType: 'order_void', refId: 'O1' })],
    orderItems: [{ id: 'l1', orderId: 'O1', productId: 'a', qty: 2, voided: true, voidedAt: at(D2), createdAt: at(D1) }] })
  const g1 = grupo(an[0].money, 'O1'), g2 = grupo(an[1].money, 'O1')
  eq(`${g1.kind}|${g1.amount}|${prod(g1, 'a').libro}|${prod(g1, 'a').cobrado}`, 'mesa|100|2|0', 'dia 1: libro 2 u, cobrado 0 -> +100')
  eq(`${g1.hechos.estado}|${g1.hechos.cobros.length}`, 'voided|0', 'hechos: anulada, sin cobros')
  eq(g1.hechos.otrosDias.map((x) => `${x.day}:${x.units}`).join(','), `${D2}:-2`, 'hechos: en otro dia el libro devolvio 2 u')
  eq(`${g2.amount}|${prod(g2, 'a').libro}|${g2.hechos.hoy.anuladas}`, '-100|-2|2', 'dia 2: la devolucion, con sus 2 u anuladas')
  eq(g1.label, 'Mesa 1 · pedido O1', 'se identifica por su mesa y su pedido')
  exacta(an[0].money, '8.5a'); exacta(an[1].money, '8.5a2')
  // Medianoche: consumo el dia 1, cobro el dia 2.
  const mn = money({ products, orders: [ord('O2', 'closed')], movements: [M('a', D0, 'traspIn', 10), M('a', D1, 'ventas', -1, { h: '23', type: 'sale_out', refType: 'order', refId: 'O2' })],
    sales: [{ id: 'V2', orderId: 'O2', createdAt: at(D2, '01'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 1, unitPrice: 50, lineTotal: 50 }], totalBase: 50 }] })
  const n1 = grupo(mn[0].money, 'O2'), n2 = grupo(mn[1].money, 'O2')
  eq(n1.hechos.cobros.map((c) => `${c.day}:${c.units}`).join(','), `${D2}:1`, 'dia 1: cobrada el dia 2, 1 u')
  eq(`${prod(n2, 'a').libro}|${prod(n2, 'a').cobrado}`, '0|1', 'dia 2: cobrado 1 u que el libro no tiene hoy')
  eq(n2.hechos.otrosDias.map((x) => `${x.day}:${x.units}`).join(','), `${D1}:1`, 'dia 2: consumo de 1 u el dia 1')
  exacta(mn[0].money, '8.5b'); exacta(mn[1].money, '8.5b2')
  // Mesa abierta en un dia que no es hoy.
  const ab = money({ products, orders: [ord('O3', 'open')], movements: [M('a', D1, 'traspIn', 10), M('a', D1, 'ventas', -2, { type: 'sale_out', refType: 'order', refId: 'O3' })] })[0].money
  eq(`${grupo(ab, 'O3').hechos.estado}|${grupo(ab, 'O3').amount}`, 'open|100', 'abierta: libro 2 u sin cobro')
  exacta(ab, '8.5c')
  // Patron real 143f3098: consumo 3, una anulacion previa al cobro (marcada sin linea), cobro
  // de 2 u, y las 3 lineas anuladas despues del cobro.
  const V = (h, n) => M('a', D1, 'ventas', 1, { h, type: 'sale_out', refType: 'order_void', refId: 'O5', id: `v-${h}-${n}` })
  const bp = money({ products, orders: [ord('O5', 'closed')],
    movements: [M('a', D0, 'traspIn', 10), M('a', D1, 'ventas', -3, { h: '11', type: 'sale_out', refType: 'order', refId: 'O5' }), V('12', 1), V('16', 1), V('16', 2), V('16', 3)],
    orderItems: [1, 2, 3].map((n) => ({ id: `i${n}`, orderId: 'O5', productId: 'a', qty: 1, voided: true, voidedAt: at(D1, '16'), createdAt: at(D1, '11') })),
    sales: [{ id: 'S5', orderId: 'O5', createdAt: at(D1, '13'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 2, unitPrice: 50, lineTotal: 100 }], totalBase: 100 }] })[0].money
  const b = grupo(bp, 'O5')
  eq(`${b.amount}|${prod(b, 'a').libro}|${prod(b, 'a').cobrado}`, '-150|-1|2', 'libro -1 u, cobrado 2 u -> -150')
  eq(`${b.hechos.hoy.consumo}|${b.hechos.hoy.anuladas}|${b.hechos.hoy.anuladasTrasCobro}|${b.hechos.hoy.marcadasSinLinea}`, '3|4|3|1', 'consumo 3, anuladas 4 (3 despues del cobro, 1 marcada sin linea)')
  exacta(bp, '8.5d')
  // Doble cobro con distinto contenido (2a revision): libro 2 u, cobrado 3 u en dos cobros.
  const dc = money({ products, orders: [ord('O6', 'closed')],
    movements: [M('a', D0, 'traspIn', 9), M('a', D1, 'ventas', -1, { h: '10', type: 'sale_out', refType: 'order', refId: 'O6' }), M('a', D1, 'ventas', -1, { h: '12', type: 'sale_out', refType: 'order', refId: 'O6' })],
    sales: [{ id: 'A6', orderId: 'O6', createdAt: at(D1, '11'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 1, unitPrice: 50, lineTotal: 50 }], totalBase: 50 },
      { id: 'B6', orderId: 'O6', createdAt: at(D1, '13'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 2, unitPrice: 50, lineTotal: 100 }], totalBase: 100 }] })[0].money
  const d = grupo(dc, 'O6')
  eq(`${d.amount}|${prod(d, 'a').libro}|${prod(d, 'a').cobrado}|${d.hechos.cobros.length}`, '-50|2|3|2', 'libro 2, cobrado 3, en 2 cobros')
  exacta(dc, '8.5e')
  // Diferencia 0 que esconderia un no cobrado (2a revision): A del dia anterior, B de hoy, se cobra solo A.
  const h4 = money({ products: [P('a', 'Arroz', { price: 100 }), P('b', 'Batido', { price: 100 })], orders: [ord('O7', 'closed')],
    movements: [M('a', D0, 'traspIn', 9), M('b', D0, 'traspIn', 9), M('a', D0, 'ventas', -1, { h: '22', type: 'sale_out', refType: 'order', refId: 'O7' }), M('b', D1, 'ventas', -1, { h: '01', type: 'sale_out', refType: 'order', refId: 'O7' })],
    sales: [{ id: 'Z7', orderId: 'O7', createdAt: at(D1, '02'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 1, unitPrice: 100, lineTotal: 100 }], totalBase: 100 }] })[0].money
  const h = grupo(h4, 'O7')
  eq(`${h4.diferencia}|${h.amount}|${prod(h, 'a').libro}/${prod(h, 'a').cobrado}|${prod(h, 'b').libro}/${prod(h, 'b').cobrado}`, '0|0|0/1|1/0', 'diferencia 0, pero la mesa sale con sus dos productos')
  exacta(h4, '8.5f')
  // Agregado despues del cobro y anulado con su linea (3a revision, I2): el libro y el cobro
  // coinciden por producto -> no hay NADA que mostrar.
  const ag = money({ products, orders: [ord('O8', 'closed')],
    movements: [M('a', D0, 'traspIn', 9), M('a', D1, 'ventas', -1, { h: '10', type: 'sale_out', refType: 'order', refId: 'O8' }), M('a', D1, 'ventas', -1, { h: '12', type: 'sale_out', refType: 'order', refId: 'O8' }), M('a', D1, 'ventas', 1, { h: '13', type: 'sale_out', refType: 'order_void', refId: 'O8' })],
    orderItems: [{ id: 'q1', orderId: 'O8', productId: 'a', qty: 1, voided: false, createdAt: at(D1, '10') }, { id: 'q2', orderId: 'O8', productId: 'a', qty: 1, voided: true, voidedAt: at(D1, '13'), createdAt: at(D1, '12') }],
    sales: [{ id: 'V8', orderId: 'O8', createdAt: at(D1, '11'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 1, unitPrice: 50, lineTotal: 50 }], totalBase: 50 }] })[0].money
  eq(`${ag.cuadra}|${ag.unidades.grupos.length}`, 'true|0', 'agregado y anulado tras cobrar: cuadra, sin nada que mostrar')
  exacta(ag, '8.5g')
}
// 8.6 Ventas directas: hechos de la venta.
{
  const products = [P('a', 'Agua')]
  // Movimiento de venta cuya venta no esta en este aparato.
  const ne = money({ products, movements: [M('a', D0, 'traspIn', 9), M('a', D1, 'ventas', -1, { type: 'sale_out', refType: 'sale', refId: 'NOESTA' })] })[0].money
  eq(`${grupo(ne, 'NOESTA').kind}|${grupo(ne, 'NOESTA').hechos.venta}`, 'venta|no-esta', 'la venta no esta en este aparato')
  exacta(ne, '8.6a')
  // Venta antigua sin sourceLocation (area) cuyo movimiento quedo en el almacen (1a revision, I3):
  // en el area se ve la venta sin movimiento de ESTA ubicacion, como hecho.
  const vi = money({ products, movements: [M('a', D0, 'traspIn', 9, { location: '__almacen' }), M('a', D1, 'ventas', -1, { type: 'sale_out', refType: 'sale', refId: 'VV', location: '__almacen' })],
    sales: [{ id: 'VV', createdAt: at(D1), area: SAL, voided: false, items: [{ productId: 'a', qty: 1, unitPrice: 50, lineTotal: 50 }], totalBase: 50 }] })[0].money
  eq(`${prod(grupo(vi, 'VV'), 'a').libro}|${prod(grupo(vi, 'VV'), 'a').cobrado}`, '0|1', 'cobrado 1 u sin movimiento en esta ubicacion')
  exacta(vi, '8.6b')
  // Linea sin cantidad (10) y linea vacia (3a revision, M3: no puede salir como caso).
  const sq = money({ products, movements: [M('a', D1, 'traspIn', 1)], sales: [{ id: 'SQ', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'a', lineTotal: 50 }, { productId: 'a', qty: 0, lineTotal: 0 }], totalBase: 50 }] })[0].money
  eq(`${grupo(sq, 'SQ').amount}|${prod(grupo(sq, 'SQ'), 'a').sinCantidad}`, '-50|50', 'linea cobrada sin cantidad, con su importe')
  exacta(sq, '8.6c')
}
// 8.7 Filtro de categoria: el cobrado total se rotula; el desglose solo mira la categoria.
{
  const prods = [P('z', 'Pizza', { categoryId: 'COM', price: 100 }), P('c', 'Cerveza', { categoryId: 'BEB', price: 100 })]
  const o = [{ id: 'O9', area: SAL, status: 'closed' }]
  const mv = [M('z', D0, 'traspIn', 5), M('c', D0, 'traspIn', 5), M('z', D0, 'ventas', -1, { h: '23', type: 'sale_out', refType: 'order', refId: 'O9' }), M('c', D1, 'ventas', -1, { h: '01', type: 'sale_out', refType: 'order', refId: 'O9' })]
  const s = [{ id: 'X9', orderId: 'O9', createdAt: at(D1, '02'), sourceLocation: SAL, voided: false, items: [{ productId: 'z', qty: 1, unitPrice: 200, lineTotal: 200 }, { productId: 'c', qty: 1, unitPrice: 90, lineTotal: 90 }], totalBase: 290 }]
  const beb = money({ categoryId: 'BEB', products: prods, movements: mv, sales: s, orders: o })[0].money
  eq(`${beb.precio.amount}|${beb.unidades.grupos.length}|${beb.cobradoTodasCategorias}`, '10|0|true', 'Bebidas: solo el precio de la cerveza; el cobrado total va rotulado')
  exacta(beb, '8.7a')
  const todo = money({ products: prods, movements: mv, sales: s, orders: o })[0].money
  eq(`${todo.precio.amount}|${prod(grupo(todo, 'O9'), 'z').libro}|${prod(grupo(todo, 'O9'), 'z').cobrado}`, '-90|0|1', 'sin filtro: precio -90 y la pizza cobrada hoy sin libro de hoy')
  exacta(todo, '8.7b')
}
// 8.8 Cuarta revision independiente: el REDONDEO no puede ser un saco residual. Cada parte que
// no es redondeo de centavo tiene su nombre y sus lineas, y el redondeo queda ACOTADO.
{
  const exacta6 = (m, label) => {
    eq(r2t(m.precio.amount + m.lineaImporte.amount + m.cantidad.amount + m.sinFicha.amount + (m.fichaDecimales?.amount || 0) + m.redondeo + m.unidades.amount), m.diferencia, `${label}: las partes = diferencia`)
    eq(m.sinExplicar, 0, `${label}: nada sin explicar`)
  }
  const one = (id, qty, up, lt, pid = 'a') => ({ id, createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: pid, qty, unitPrice: up, lineTotal: lt }], totalBase: lt })
  // S1: una linea cuyo importe no es cantidad x precio (2 x 50 cobrado 80).
  const s1 = money({ products: [P('a', 'Agua')], movements: [M('a', D0, 'traspIn', 9), M('a', D1, 'ventas', -2, { type: 'sale_out', refType: 'sale', refId: 'x1' })], sales: [one('x1', 2, 50, 80)] })[0].money
  eq(`${s1.lineaImporte.n}|${s1.lineaImporte.amount}|${s1.redondeo}|${s1.soloRedondeo}`, '1|20|0|false', `linea incoherente: su propia parte, +20, y nada de redondeo`)
  eq(`${s1.lineaImporte.detalle[0]?.qty}|${s1.lineaImporte.detalle[0]?.unitPrice}|${s1.lineaImporte.detalle[0]?.lineTotal}`, '2|50|80', 'con la linea tal cual')
  exacta6(s1, 'S1')
  // S2: precio congelado 49.996 frente a 50 por 5000 u: el umbral va sobre el IMPORTE de la linea.
  const s2 = money({ products: [P('a', 'Agua')], movements: [M('a', D0, 'traspIn', 9999), M('a', D1, 'ventas', -5000, { type: 'sale_out', refType: 'sale', refId: 'x2' })], sales: [one('x2', 5000, 49.996, 249980)] })[0].money
  eq(`${s2.precio.n}|${s2.precio.amount}|${s2.redondeo}`, '1|20|0', 'precio: 5000 x 0.004 = +20, no redondeo')
  exacta6(s2, 'S2')
  // S6 (alcanzable: la venta acepta decimales libres): 3 ventas de 1.2345 kg a 8000. La columna
  // Venta redondea a la milesima (3.704) y el Importe con ella: eso es su propia parte.
  const mv = [M('k', D0, 'traspIn', 99)], sl = []
  for (let i = 0; i < 3; i++) { mv.push(M('k', D1, 'ventas', -1.2345, { h: '1' + i, type: 'sale_out', refType: 'sale', refId: 'q' + i })); sl.push({ ...one('q' + i, 1.2345, 8000, 9876, 'k'), createdAt: at(D1, '1' + i) }) }
  const s6 = money({ products: [P('k', 'Carne', { unit: 'kg', price: 8000 })], movements: mv, sales: sl })[0].money
  eq(`${s6.cantidad.amount}|${s6.redondeo}|${s6.soloRedondeo}`, '4|0|false', 'cantidad con mas de 3 decimales: +4, su parte')
  eq(`${s6.cantidad.detalle[0]?.name}|${s6.cantidad.detalle[0]?.libro}|${s6.cantidad.detalle[0]?.columna}`, 'Carne|3.7035|3.704', 'libro en crudo frente a la columna')
  exacta6(s6, 'S6')
  // M1: producto que no esta en el catalogo del aparato: sin ficha, no "ficha 0".
  const m1 = money({ products: [P('a', 'Agua')], movements: [M('a', D0, 'traspIn', 9), M('zz', D1, 'ventas', -1, { type: 'sale_out', refType: 'sale', refId: 'x3' })], sales: [one('x3', 1, 30, 30, 'zz')] })[0].money
  eq(`${m1.sinFicha.n}|${m1.sinFicha.amount}|${m1.sinFicha.detalle[0]?.motivo}|${m1.precio.n}`, '1|-30|no-catalogo|0', 'sin ficha en este aparato: -30, no un precio')
  exacta6(m1, 'M1')
  // M3: producto con precio en divisa y sin tasa (priceOf da 0): sin ficha por falta de tasa.
  const m3 = buildDailyControl(base({ products: [P('u', 'Ron', { price: 10, priceCurrency: 'USD' })], priceOf: (p) => (p.priceCurrency ? 0 : p.price), isForeign: (p) => !!p.priceCurrency,
    movements: [M('u', D0, 'traspIn', 9), M('u', D1, 'ventas', -1, { type: 'sale_out', refType: 'sale', refId: 'x4' })], sales: [one('x4', 1, 2500, 2500, 'u')] })).days[0].money
  eq(`${m3.sinFicha.detalle[0]?.motivo}|${m3.sinFicha.amount}`, 'sin-tasa|-2500', 'sin tasa: su motivo')
  exacta6(m3, 'M3')
  // Precio de mesa congelado sin redondear (33.333 frente a 33.33 x 10 u = -0.03): es un precio
  // cobrado distinto, con su linea exacta.
  const pm = money({ products: [P('a', 'Agua', { price: 33.33 })], orders: [{ id: 'OQ', area: SAL, status: 'closed' }],
    movements: [M('a', D0, 'traspIn', 50), M('a', D1, 'ventas', -10, { h: '10', type: 'sale_out', refType: 'order', refId: 'OQ' })],
    sales: [{ id: 'VQ', orderId: 'OQ', createdAt: at(D1, '11'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 10, unitPrice: 33.333, lineTotal: 333.33 }], totalBase: 333.33 }] })[0].money
  eq(`${pm.precio.n}|${pm.precio.amount}|${pm.precio.detalle[0]?.unitPrice}`, '1|-0.03|33.333', 'precio sub-centavo por unidad pero de 3 centavos en la linea: precio')
  exacta6(pm, 'PM')
  // El redondeo que queda es de centavo: pesadas a precio de ficha, 3 lineas -> 0.01.
  const w = [M('k', D0, 'traspIn', 10)], ws = []
  for (let i = 0; i < 3; i++) { w.push(M('k', D1, 'ventas', -0.333, { h: '1' + i, type: 'sale_out', refType: 'sale', refId: 'w' + i })); ws.push({ ...one('w' + i, 0.333, 13.37, 4.45, 'k'), createdAt: at(D1, '1' + i) }) }
  const rw = money({ products: [P('k', 'Carne', { unit: 'kg', price: 13.37 })], movements: w, sales: ws })[0].money
  eq(`${rw.redondeo}|${rw.soloRedondeo}|${rw.lineaImporte.n + rw.precio.n + rw.cantidad.detalle.length + rw.sinFicha.n}`, '0.01|true|0', 'pesadas: solo redondeo de centavo')
  exacta6(rw, 'RW')
}
// 8.10 Quinta revision: el precio se compara con la ficha SIN redondear y SIN umbral; la ficha
// con mas de 2 decimales es su propia parte; "sin tasa" exige precio en divisa.
{
  const kg = (id, name, price, x = {}) => P(id, name, { unit: 'kg', price, ...x })
  // I1: 300 ventas de 0,1 kg a 12,30 con ficha 12,34 (cada linea difiere 0,004): es PRECIO.
  const mv = [M('q', D0, 'traspIn', 999)], sl = []
  for (let i = 0; i < 300; i++) { mv.push(M('q', D1, 'ventas', -0.1, { h: '12', type: 'sale_out', refType: 'sale', refId: 'z' + i })); sl.push({ id: 'z' + i, createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'q', qty: 0.1, unitPrice: 12.3, lineTotal: 1.23 }], totalBase: 1.23 }) }
  const i1 = money({ products: [kg('q', 'Queso', 12.34)], movements: mv, sales: sl })[0].money
  eq(`${i1.precio.n}|${i1.precio.amount}|${i1.redondeo}|${i1.soloRedondeo}`, '300|1.2|0|false', `300 lineas a otro precio: precio +1,20, no redondeo`)
  // M1: ficha 49,996 cobrada exactamente a 49,996: NO es un precio distinto; es la ficha con mas
  // de 2 decimales, que el Importe usa redondeada (50).
  const m1 = money({ products: [P('a', 'Aceite', { price: 49.996 })], movements: [M('a', D0, 'traspIn', 9999), M('a', D1, 'ventas', -5000, { type: 'sale_out', refType: 'sale', refId: 'fa' })],
    sales: [{ id: 'fa', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 5000, unitPrice: 49.996, lineTotal: 249980 }], totalBase: 249980 }] })[0].money
  eq(`${m1.precio.n}|${m1.fichaDecimales.amount}|${m1.fichaDecimales.detalle[0]?.ficha}|${m1.fichaDecimales.detalle[0]?.fichaImporte}`, '0|20|49.996|50', 'ficha de 3 decimales: su parte, +20')
  // M2: un producto en MN con precio 0,004 NO es "sin tasa".
  const m2 = money({ products: [P('b', 'Bola', { price: 0.004 })], movements: [M('b', D0, 'traspIn', 9), M('b', D1, 'ventas', -1, { type: 'sale_out', refType: 'sale', refId: 'fb' })],
    sales: [{ id: 'fb', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'b', qty: 1, unitPrice: 0.004, lineTotal: 0 }], totalBase: 0 }] })[0].money
  eq(`${m2.sinFicha.n}|${m2.cuadra}`, '0|true', 'precio 0,004 en MN: ni sin tasa ni descuadre')
  // Sin tasa: SOLO un producto con precio en divisa (isForeign inyectado) y ficha 0.
  const st = buildDailyControl(base({ products: [P('u', 'Ron', { price: 10, priceCurrency: 'USD' })], priceOf: (p) => (p.priceCurrency ? 0 : p.price), isForeign: (p) => !!p.priceCurrency,
    movements: [M('u', D0, 'traspIn', 9), M('u', D1, 'ventas', -1, { type: 'sale_out', refType: 'sale', refId: 'fu' })], sales: [{ id: 'fu', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'u', qty: 1, unitPrice: 2500, lineTotal: 2500 }], totalBase: 2500 }] })).days[0].money
  eq(`${st.sinFicha.detalle[0]?.motivo}|${st.sinFicha.amount}`, 'sin-tasa|-2500', 'divisa sin tasa: su motivo')
  // El redondeo dice de cuantas partidas sale (cada una de menos de medio centavo).
  const w = [M('k', D0, 'traspIn', 10)], ws = []
  for (let i = 0; i < 3; i++) { w.push(M('k', D1, 'ventas', -0.333, { h: '1' + i, type: 'sale_out', refType: 'sale', refId: 'r' + i })); ws.push({ id: 'r' + i, createdAt: at(D1, '1' + i), sourceLocation: SAL, voided: false, items: [{ productId: 'k', qty: 0.333, unitPrice: 13.37, lineTotal: 4.45 }], totalBase: 4.45 }) }
  const rw = buildDailyControl(base({ products: [kg('k', 'Carne', 13.37)], movements: w, sales: ws }))
  eq(rw.days[0].money.redondeoPartidas, 3, 'redondeo: 3 partidas')
  const tl = dailyControlReport(rw, { from: D1 }).rows.map((r) => (typeof r[0] === 'object' ? r[0].content : String(r[0])))
  eq(tl.some((l) => /Redondeo al centavo: 0\.01 MN \(3 partida\(s\) de menos de medio centavo cada una/.test(l)), true, `se imprime con sus partidas (${tl.filter((l) => /Redondeo/.test(l)).join(' | ')})`)
}
// 8.9 Hechos mas precisos (cuarta revision, M2 y M7).
{
  const products = [P('a', 'Agua')]
  // M2: "ventas netas en otros dias", incluidos los dias con neto 0 (consumo y anulacion).
  const o = [{ id: 'OR', area: SAL, table: 'Mesa 2', status: 'closed' }]
  const r = money({ from: D1, to: D1, products, orders: o, orderItems: [{ id: 'r1', orderId: 'OR', productId: 'a', qty: 1, voided: true, voidedAt: at(D0, '11'), createdAt: at(D0, '10') }],
    movements: [M('a', D0, 'traspIn', 9, { h: '01' }), M('a', D0, 'ventas', -1, { h: '10', type: 'sale_out', refType: 'order', refId: 'OR' }), M('a', D0, 'ventas', 1, { h: '11', type: 'sale_out', refType: 'order_void', refId: 'OR' }), M('a', D1, 'ventas', -1, { h: '10', type: 'sale_out', refType: 'order', refId: 'OR' })] })[0].money
  const g = grupo(r, 'OR')
  eq(g.hechos.otrosDias.map((x) => `${x.day}:${x.units}`).join(','), `${D0}:0`, 'el dia con consumo y anulacion (neto 0) tambien sale')
  // M7: venta de esta ubicacion cuyo movimiento esta en otra: se dice donde.
  const v = money({ products, movements: [M('a', D0, 'traspIn', 9, { location: '__almacen' }), M('a', D1, 'ventas', -1, { type: 'sale_out', refType: 'sale', refId: 'VL', location: '__almacen' })],
    sales: [{ id: 'VL', createdAt: at(D1), area: SAL, voided: false, items: [{ productId: 'a', qty: 1, unitPrice: 50, lineTotal: 50 }], totalBase: 50 }] })[0].money
  eq(grupo(v, 'VL').hechos.movEn?.join(','), '__almacen', 'el movimiento de la venta esta en otra ubicacion')
}
// 9. Cache: la que difiere se lista.
{
  const r = buildDailyControl(base({ products: [P('a', 'Agua', { stockByLocation: { [SAL]: 7 } })], movements: [M('a', D1, 'traspIn', 9)] }))
  eq(r.cacheCheck.ok, false, 'cache distinta del libro: no ok')
  eq(`${r.cacheCheck.diffs[0].name}:${r.cacheCheck.diffs[0].libro}:${r.cacheCheck.diffs[0].cache}`, 'Agua:9:7', 'se lista con libro y cache')
  // Un producto con cache en la ubicacion y NINGUN movimiento en ella tambien se mira
  // (1a revision, M1: antes el control decia CUADRA sin haberlo visto).
  const sm = buildDailyControl(base({ products: [P('a', 'Agua', { stockByLocation: { [SAL]: 1 } }), P('b', 'Bola', { stockByLocation: { [SAL]: 5 } }), P('c', 'Coco', { categoryId: 'OTRA', stockByLocation: { [SAL]: 3 } })], movements: [M('a', D1, 'traspIn', 1)] }))
  eq(sm.cacheCheck.diffs.map((x) => `${x.name}:${x.libro}:${x.cache}`).join(','), 'Bola:0:5,Coco:0:3', 'cache sin movimientos: se lista')
  const smc = buildDailyControl(base({ categoryId: 'C1', products: [P('b', 'Bola', { stockByLocation: { [SAL]: 5 } }), P('c', 'Coco', { categoryId: 'OTRA', stockByLocation: { [SAL]: 3 } })] }))
  eq(smc.cacheCheck.diffs.map((x) => x.name).join(','), 'Bola', 'con filtro de categoria, solo la categoria')
}
// 10. Integridad: venta sin su movimiento en el rango.
{
  const sale = { id: 'S9', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'a', lineTotal: 50 }], totalBase: 50 }
  const r = buildDailyControl(base({ products: [P('a', 'Agua')], movements: [M('a', D1, 'traspIn', 1)], sales: [sale] }))
  eq(r.integrity.ok, false, 'venta sin movimiento: integridad no ok')
  eq(r.integrity.counts['sale-sin-mov'], 1, 'cuenta exacta')
  eq(r.days[0].money.unidades.grupos.some((g) => g.id === 'S9'), true, 'y la venta sale en el desglose del dia')
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
  // El texto impreso lleva los HECHOS del desglose y ninguna causa interpretada.
  const r2 = buildDailyControl(base({ products: [P('a', 'Agua')], orders: [{ id: 'OX', area: SAL, table: 'Mesa 4', status: 'closed' }],
    movements: [M('a', D0, 'traspIn', 9), M('a', D1, 'ventas', -2, { h: '10', type: 'sale_out', refType: 'order', refId: 'OX' })],
    sales: [{ id: 'VX', orderId: 'OX', createdAt: at(D1, '11'), sourceLocation: SAL, voided: false, items: [{ productId: 'a', qty: 1, unitPrice: 40, lineTotal: 40 }], totalBase: 40 }] }))
  const t2 = dailyControlReport(r2, { locationName: 'Salones', from: D1, to: D1 }).rows.map(txt).join(' ¶ ')
  eq(/Precio distinto de la ficha: 1 línea/.test(t2), true, `imprime el precio (${t2})`)
  eq(/Mesa 4 · pedido OX/.test(t2) && /Agua: libro 2 · cobrado 1/.test(t2), true, 'imprime la mesa con su libro y su cobro')
  eq(/Causa:/.test(t2), false, 'no imprime causas interpretadas')
  const rr = buildDailyControl(base({ products: [P('k', 'Carne', { unit: 'kg', price: 13.37 })], movements: [M('k', D0, 'traspIn', 9), M('k', D1, 'ventas', -0.333, { type: 'sale_out', refType: 'sale', refId: 'RR' })],
    sales: [{ id: 'RR', createdAt: at(D1), sourceLocation: SAL, voided: false, items: [{ productId: 'k', qty: 0.333, unitPrice: 13.37, lineTotal: 4.45 }], totalBase: 4.45 }] }))
  eq(dailyControlReport(rr, { from: D1 }).rows.map(txt).some((l) => /NO CUADRA solo por redondeo al centavo/.test(l)), rr.days[0].money.diferencia !== 0, 'un dia con solo redondeo lo dice')
}

console.log(`dailySalesControl: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
