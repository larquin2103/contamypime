// Pruebas PURAS de los totales de la cuenta de una mesa (modulo 'mesas').
// Sin framework: ejecutar con  `node src/lib/orderTotals.test.mjs`.
//
// QUE EXISTE ESTA SUITE PARA CAZAR: que el descuento nuevo altere una cuenta que
// NO tiene descuento. Todas las mesas que hoy se cobran pasan por esta aritmetica,
// asi que el invariante "con discountPct = 0 la salida es identica a la de antes"
// es lo que impide tocar dinero de verdad. Va primero, y comparado contra la
// formula ANTERIOR escrita a mano.
import { orderTotals, cleanPct } from './orderTotals.js'

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
// La formula EXACTA que estaba en ordersRepo.totals antes del descuento.
function legacyTotals(items, { servicePct = 0, waived = false } = {}) {
  const subtotal = round2(items.reduce((a, i) => a + Number(i.lineTotal || 0), 0))
  const pct = waived ? 0 : Math.max(0, Number(servicePct) || 0)
  const service = round2(subtotal * (pct / 100))
  return { count: items.length, subtotal, servicePct: pct, service, total: round2(subtotal + service) }
}
const strip = (t) => ({ count: t.count, subtotal: t.subtotal, servicePct: t.servicePct, service: t.service, total: t.total })

const L = (lineTotal) => ({ lineTotal })

// --- 1) EL INVARIANTE: sin descuento, identico a la formula anterior ---------
{
  const casos = [
    [[], { servicePct: 0 }],
    [[], { servicePct: 10 }],
    [[L(100)], { servicePct: 0 }],
    [[L(100)], { servicePct: 10 }],
    [[L(100), L(250.5), L(3.33)], { servicePct: 10 }],
    [[L(100), L(250.5), L(3.33)], { servicePct: 10, waived: true }],
    [[L(0.01)], { servicePct: 15 }],
    [[L(1234.56), L(0.44)], { servicePct: 12.5 }],
    [[L(33.33), L(33.33), L(33.34)], { servicePct: 7 }],
    [[L(19.99)], { servicePct: 100 }]
  ]
  let diffs = 0
  for (const [items, opts] of casos) {
    const antes = legacyTotals(items, opts)
    const ahora = strip(orderTotals(items, opts))
    if (JSON.stringify(antes) !== JSON.stringify(ahora)) {
      diffs++
      console.error(`DIFF ${JSON.stringify(opts)} antes=${JSON.stringify(antes)} ahora=${JSON.stringify(ahora)}`)
    }
    // Y tambien con el descuento puesto explicitamente en 0.
    const cero = strip(orderTotals(items, { ...opts, discountPct: 0 }))
    if (JSON.stringify(antes) !== JSON.stringify(cero)) {
      diffs++
      console.error(`DIFF (discountPct:0) ${JSON.stringify(opts)}`)
    }
  }
  eq(diffs, 0, `1) INVARIANTE: sin descuento la salida es IDENTICA a la formula anterior (${casos.length} casos x 2)`)
  // Y los campos nuevos no molestan: nacen en cero.
  const t = orderTotals([L(100)], { servicePct: 10 })
  eq(t.discountPct, 0, '1) sin descuento, discountPct = 0')
  eq(t.discount, 0, '1) sin descuento, discount = 0')
}

// --- 2) El orden de la cuenta: descuento ANTES del servicio ------------------
{
  // 1000 de consumo, 15 % de descuento, 10 % de servicio.
  // descuento = 150 · base = 850 · servicio = 85 · total = 935
  const t = orderTotals([L(600), L(400)], { servicePct: 10, discountPct: 15 })
  eq(t.subtotal, 1000, '2) subtotal = suma de lineas')
  eq(t.discount, 150, '2) descuento = 15 % del consumo')
  eq(t.service, 85, '2) el servicio se cobra sobre lo que QUEDA (850), no sobre 1000')
  eq(t.total, 935, '2) total = 1000 - 150 + 85')
  // El mismo caso SIN el orden correcto daria 950 de total (servicio sobre 1000):
  ok(t.total !== 950, '2) y NO es 950, que es lo que daria cobrar servicio sobre el consumo completo')
}
{
  // Sin cargo por servicio, el descuento sale limpio del total.
  const t = orderTotals([L(200)], { discountPct: 25 })
  eq([t.discount, t.service, t.total], [50, 0, 150], '2) sin servicio: 200 - 50 = 150')
}
{
  // Servicio EXIMIDO por el mando + descuento: el servicio es 0 y el descuento sigue.
  const t = orderTotals([L(200)], { servicePct: 10, waived: true, discountPct: 10 })
  eq([t.discount, t.servicePct, t.service, t.total], [20, 0, 0, 180], '2) eximir servicio no anula el descuento')
}

// --- 3) Descuento del 100 % (cortesia total) --------------------------------
{
  const t = orderTotals([L(500)], { servicePct: 10, discountPct: 100 })
  eq([t.discount, t.service, t.total], [500, 0, 0], '3) 100 % de descuento: total 0 y servicio 0')
  ok(t.subtotal === 500, '3) el consumo real se conserva (no se borra lo que se consumio)')
}

// --- 4) Basura en el porcentaje: acotado, nunca revienta --------------------
{
  eq(cleanPct(0), 0, '4) 0 -> 0')
  eq(cleanPct(-5), 0, '4) negativo -> 0')
  eq(cleanPct(NaN), 0, '4) NaN -> 0')
  eq(cleanPct(undefined), 0, '4) undefined -> 0')
  eq(cleanPct(null), 0, '4) null -> 0')
  eq(cleanPct('hola'), 0, '4) texto -> 0')
  eq(cleanPct('15'), 15, '4) texto numerico -> su numero (los inputs dan texto)')
  eq(cleanPct(150), 100, '4) mas de 100 -> 100 (no se puede descontar mas que todo)')
  eq(cleanPct(12.5), 12.5, '4) decimales se respetan')
  const t = orderTotals([L(100)], { servicePct: -10, discountPct: 999 })
  eq([t.discount, t.servicePct, t.total], [100, 0, 0], '4) porcentajes absurdos no rompen la cuenta')
}

// --- 5) Redondeo a dos decimales en cada paso (es dinero) -------------------
{
  // 33.33 con 10 % de descuento = 3.333 -> 3.33
  const t = orderTotals([L(33.33)], { servicePct: 10, discountPct: 10 })
  eq(t.discount, 3.33, '5) el descuento se redondea a centavos')
  eq(t.service, 3, '5) el servicio se calcula sobre la base ya redondeada (30 x 10 %)')
  eq(t.total, 33, '5) total = 33.33 - 3.33 + 3')
  ok(Number.isFinite(t.total), '5) sin residuos de coma flotante')
}
{
  // Un caso que en coma flotante da 0.30000000000000004 si no se redondea.
  const t = orderTotals([L(0.1), L(0.1), L(0.1)], {})
  eq(t.subtotal, 0.3, '5) 0.1 x 3 da 0.3 exacto, no 0.30000000000000004')
}

// --- 6) Lineas: se cuentan las que llegan (las anuladas las filtra el repo) --
{
  eq(orderTotals([], {}).count, 0, '6) mesa vacia: 0 lineas y total 0')
  eq(orderTotals([], { discountPct: 50 }).total, 0, '6) descuento sobre una mesa vacia sigue siendo 0')
  eq(orderTotals(undefined, {}).count, 0, '6) sin lista de lineas no revienta')
  eq(orderTotals([{ lineTotal: null }, { lineTotal: undefined }, {}], {}).subtotal, 0,
    '6) lineas sin importe cuentan como 0')
}

console.log(`${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
