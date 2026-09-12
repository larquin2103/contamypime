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
import { grossOf, saleNetFactor, netLineRevenue } from './saleRevenue.js'

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

console.log(`${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
