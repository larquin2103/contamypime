// Pruebas PURAS del prorrateo del descuento de una venta (modulo 'mesas').
// Sin framework: ejecutar con  `node src/lib/saleRevenue.test.mjs`.
//
// QUE EXISTE ESTA SUITE PARA CAZAR: que el panel del dueño mienta. Estas funciones
// deciden el INGRESO y la GANANCIA que ve el dueño, y el encargo fue explicito: que
// el panel muestre el valor REAL, "que no se falseen las ventas ni los estimados".
// Dos cosas tienen que cumplirse siempre:
//   a) SIN descuento, el factor es 1 y el panel calcula lo mismo que antes.
//   b) CON descuento, la suma de las lineas netas es EXACTAMENTE el consumo
//      descontado: si no, el total y las partes dejarian de cuadrar entre si.
import { grossOf, saleNetFactor, netLineRevenue, sumSales } from './saleRevenue.js'

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
const sumNet = (sale) => round2((sale.items || []).reduce((a, it) => a + netLineRevenue(sale, it), 0))

// --- 1) SIN descuento: factor 1 y todo igual que antes -----------------------
{
  const sale = { items: [{ lineTotal: 100 }, { lineTotal: 250.5 }] }
  eq(saleNetFactor(sale), 1, '1) sin el campo, factor 1')
  eq(saleNetFactor({ ...sale, discountAmount: 0 }), 1, '1) con el campo en 0, factor 1')
  eq(saleNetFactor({ ...sale, discountAmount: null }), 1, '1) con el campo en null, factor 1')
  eq(saleNetFactor({ ...sale, discountAmount: 'hola' }), 1, '1) con basura, factor 1 (lado seguro)')
  eq(saleNetFactor({ ...sale, discountAmount: -50 }), 1, '1) con un descuento negativo, factor 1')
  eq(netLineRevenue(sale, sale.items[0]), 100, '1) la linea aporta su importe tal cual')
  eq(netLineRevenue(sale, sale.items[1]), 250.5, '1) y la otra tambien')
  eq(sumNet(sale), 350.5, '1) la suma es el consumo completo')
  // Una venta ANTIGUA (sin ninguno de los campos nuevos) se comporta igual.
  eq(saleNetFactor({ items: [{ unitPrice: 10, qty: 3 }] }), 1, '1) venta vieja sin lineTotal: factor 1')
  eq(netLineRevenue({ items: [] }, { unitPrice: 10, qty: 3 }), 30, '1) y su importe sale de precio x cantidad')
}

// --- 2) CON descuento: las partes suman el total descontado ------------------
{
  // 1000 de consumo, 150 de descuento -> 850 netos.
  const sale = { items: [{ lineTotal: 600 }, { lineTotal: 400 }], discountAmount: 150 }
  eq(grossOf(sale), 1000, '2) el consumo bruto es 1000')
  eq(saleNetFactor(sale), 0.85, '2) factor 0.85')
  eq(netLineRevenue(sale, sale.items[0]), 510, '2) la linea de 600 aporta 510')
  eq(netLineRevenue(sale, sale.items[1]), 340, '2) la de 400 aporta 340')
  eq(sumNet(sale), 850, '2) LAS PARTES SUMAN EL TOTAL DESCONTADO (510 + 340 = 850)')
}
{
  // Reparto proporcional con importes desiguales y un descuento que no divide limpio.
  const sale = { items: [{ lineTotal: 333.33 }, { lineTotal: 66.67 }], discountAmount: 40 }
  eq(grossOf(sale), 400, '2) consumo 400')
  eq(sumNet(sale), 360, '2) 400 - 40 = 360, y las partes lo suman exacto')
  ok(netLineRevenue(sale, sale.items[0]) > netLineRevenue(sale, sale.items[1]),
    '2) la linea mas grande absorbe mas descuento (es proporcional)')
}
{
  // Muchas lineas pequeñas: el redondeo por linea no puede desviar el total.
  const items = Array.from({ length: 7 }, () => ({ lineTotal: 10 }))
  const sale = { items, discountAmount: 7 }
  eq(grossOf(sale), 70, '2) consumo 70 en 7 lineas')
  eq(sumNet(sale), 63, '2) 70 - 7 = 63 con 7 lineas (el redondeo no desvia el total)')
}

// --- 3) Casos limite ---------------------------------------------------------
{
  // Descuento del 100 %: ingreso 0, pero el consumo bruto se conserva.
  const sale = { items: [{ lineTotal: 500 }], discountAmount: 500 }
  eq(saleNetFactor(sale), 0, '3) descuento del 100 %: factor 0')
  eq(sumNet(sale), 0, '3) ingreso 0')
  eq(grossOf(sale), 500, '3) el consumo bruto se conserva (no se borra lo consumido)')
}
{
  // Descuento MAYOR que el consumo (no deberia pasar): se corta en 0, no en negativo.
  const sale = { items: [{ lineTotal: 100 }], discountAmount: 300 }
  eq(saleNetFactor(sale), 0, '3) descuento mayor que el consumo: factor 0, NUNCA negativo')
  eq(sumNet(sale), 0, '3) el ingreso no puede ser negativo')
}
{
  // Venta con descuento pero SIN lineas: no hay nada que prorratear.
  eq(saleNetFactor({ items: [], discountAmount: 50 }), 1, '3) sin lineas, factor 1 (no hay donde repartir)')
  eq(saleNetFactor({ discountAmount: 50 }), 1, '3) sin la propiedad items tampoco revienta')
  eq(saleNetFactor(null), 1, '3) sin venta, factor 1')
  eq(grossOf(null), 0, '3) grossOf de nada es 0')
  eq(grossOf({ items: [{ lineTotal: null }, {}] }), 0, '3) lineas sin importe cuentan 0')
}
{
  // Residuo de coma flotante: tres lineas de 0.1 con descuento de 0.03.
  const sale = { items: [{ lineTotal: 0.1 }, { lineTotal: 0.1 }, { lineTotal: 0.1 }], discountAmount: 0.03 }
  eq(grossOf(sale), 0.3, '3) consumo 0.3 exacto (no 0.30000000000000004)')
  eq(sumNet(sale), 0.27, '3) 0.3 - 0.03 = 0.27, sin residuos')
}

// --- 4) El COSTO no se prorratea: es la mitad del encargo --------------------
// (se comprueba aqui como contrato: estas funciones NO exponen nada de costo, asi
//  que quien las use no puede aplicarlas al costo por descuido)
{
  ok(typeof netLineRevenue === 'function' && netLineRevenue.length === 2,
    '4) netLineRevenue solo trabaja con el INGRESO (venta, linea)')
  const sale = { items: [{ lineTotal: 100, unitCost: 40, qty: 1 }], discountAmount: 50 }
  eq(netLineRevenue(sale, sale.items[0]), 50, '4) el ingreso de la linea baja a la mitad')
  eq(sale.items[0].unitCost, 40, '4) y el costo de la linea NO se toca (la mercancia costo lo mismo)')
}

// ---------------------------------------------------------------------------
// sumSales: ingreso, costo y ganancia de un conjunto de ventas.
//
// PARA QUE: el panel de escritorio muestra las cifras del DIA en el Inicio. El
// `analyticsRepo.report()` ya las calcula, pero lee TODAS las ventas de la
// historia (`db.sales.toArray()`), y el Inicio es la pantalla que mas se abre.
//
// EL RIESGO DE ESCRIBIR OTRA SUMA es el fallo de F1 en miniatura: dos sitios que
// calculan el mismo dinero acaban divergiendo, y aqui divergir significa que el
// Inicio y el Panel del dueño digan cifras distintas del MISMO dia. Por eso esta
// tanda no se limita a probar casos: compara `sumSales` contra el BUCLE REAL de
// `report()`, copiado literalmente del repositorio, sobre ventas aleatorias.
// Si alguien toca uno de los dos, esta prueba lo caza.
{
  // El bucle de analyticsRepo.report(), TAL CUAL esta en el fichero.
  const bucleDelPanel = (sales) => {
    let revenue = 0
    let cost = 0
    for (const s of sales) {
      const netFactor = saleNetFactor(s)
      for (const it of s.items || []) {
        const lineRev = round2(Number(it.lineTotal ?? it.unitPrice * it.qty) * netFactor)
        const lineCost = Number((it.unitCost || 0) * it.qty)
        revenue += lineRev
        cost += lineCost
      }
    }
    revenue = round2(revenue)
    cost = round2(cost)
    return { revenue, cost, profit: round2(revenue - cost) }
  }

  // 1) Lo basico.
  const v1 = { items: [{ qty: 2, unitPrice: 50, lineTotal: 100, unitCost: 30 }] }
  eq(sumSales([v1]), { revenue: 100, cost: 60, profit: 40, count: 1 }, 'sumSales: una venta simple')
  eq(sumSales([]), { revenue: 0, cost: 0, profit: 0, count: 0 }, 'sumSales: sin ventas, todo en cero')
  eq(sumSales(null), { revenue: 0, cost: 0, profit: 0, count: 0 }, 'sumSales: sin argumento no revienta')

  // 2) El descuento de mesa se PRORRATEA: es lo que hace que el ingreso sea el
  //    real y no el bruto. El COSTO no se toca (la mercancia costo lo mismo).
  // OJO: la venta guarda el IMPORTE del descuento (`discountAmount`), no el
  //  porcentaje: es lo que lee `saleNetFactor`. La primera version de esta
  //  prueba uso `discountPct` y fallo, que es justo para lo que sirve.
  const conDesc = {
    discountPct: 50,
    discountAmount: 100,
    subtotal: 200,
    items: [{ qty: 1, unitPrice: 200, lineTotal: 200, unitCost: 80 }]
  }
  const r = sumSales([conDesc])
  eq(r.revenue, 100, 'sumSales: el descuento del 50% reduce el ingreso a la mitad')
  eq(r.cost, 80, 'sumSales: el descuento NO toca el costo')
  eq(r.profit, 20, 'sumSales: la ganancia sale de los dos anteriores')

  // 3) Una CORTESIA (100%) no ingresa nada, pero su costo si cuenta: es
  //    exactamente lo que se pidio al cerrar mesas regaladas.
  const cortesia = {
    discountPct: 100,
    discountAmount: 150,
    subtotal: 150,
    items: [{ qty: 3, unitPrice: 50, lineTotal: 150, unitCost: 20 }]
  }
  const c = sumSales([cortesia])
  eq(c.revenue, 0, 'sumSales: una cortesia no ingresa nada')
  eq(c.cost, 60, 'sumSales: el costo de la cortesia SI cuenta')
  eq(c.profit, -60, 'sumSales: regalar una cuenta da ganancia negativa')

  // 4) `count` son VENTAS, no lineas.
  eq(sumSales([v1, v1, v1]).count, 3, 'sumSales: cuenta ventas, no lineas')

  // 5) Robustez con datos incompletos (ventas viejas sin `lineTotal` ni costo).
  eq(sumSales([{ items: [{ qty: 2, unitPrice: 30 }] }]),
    { revenue: 60, cost: 0, profit: 60, count: 1 },
    'sumSales: sin lineTotal usa precio x cantidad; sin costo, costo 0')
  eq(sumSales([{}]), { revenue: 0, cost: 0, profit: 0, count: 1 },
    'sumSales: una venta sin lineas no revienta')

  // 6) EQUIVALENCIA CON EL PANEL sobre ventas aleatorias. Es el punto de la
  //    tanda: que las dos sumas no puedan separarse.
  let sem = 20260917
  const rnd = () => { sem = (sem * 1103515245 + 12345) % 2147483648; return sem / 2147483648 }
  let comparados = 0
  let iguales = 0
  for (let n = 0; n < 500; n++) {
    const ventas = []
    for (let i = 0, k = 1 + Math.floor(rnd() * 4); i < k; i++) {
      const lineas = []
      for (let j = 0, m = 1 + Math.floor(rnd() * 3); j < m; j++) {
        const qty = 1 + Math.floor(rnd() * 5)
        const unitPrice = round2(10 + rnd() * 990)
        lineas.push({
          qty,
          unitPrice,
          lineTotal: round2(qty * unitPrice),
          unitCost: round2(rnd() * unitPrice)
        })
      }
      const sub = round2(lineas.reduce((a, l) => a + l.lineTotal, 0))
      const pct = [0, 0, 0, 10, 25, 50, 100][Math.floor(rnd() * 7)]
      ventas.push(pct
        ? { discountPct: pct, discountAmount: round2(sub * pct / 100), subtotal: sub, items: lineas }
        : { items: lineas })
    }
    const a = bucleDelPanel(ventas)
    const b = sumSales(ventas)
    comparados++
    if (a.revenue === b.revenue && a.cost === b.cost && a.profit === b.profit) iguales++
    else if (comparados < 4) console.error('  DIFERENCIA:', JSON.stringify(a), JSON.stringify(b))
  }
  eq(iguales, comparados, `sumSales coincide con el bucle del panel en ${comparados} conjuntos aleatorios`)
}

console.log(`${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
