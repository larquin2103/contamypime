import { round2 } from './currency.js'

// ---------------------------------------------------------------------------
// Totales de la cuenta de una MESA (modulo 'mesas'). Aritmetica PURA, sin Dexie:
// se puede probar con node (patron de custodyMath / kitchenMath). Quien lee las
// lineas de la base es ordersRepo; aqui solo se calcula.
//
// Orden de la cuenta (decision del dueño, 11-09-2026):
//   consumo (subtotal) -> DESCUENTO -> cargo por SERVICIO sobre lo que queda
//
//   descuento = subtotal x %descuento
//   servicio  = (subtotal - descuento) x %servicio
//   total     = subtotal - descuento + servicio
//
// El descuento es del negocio y el servicio se cobra sobre lo realmente
// facturado: si se regala parte del consumo, no se cobra servicio por esa parte.
//
// INVARIANTE que hay que preservar: con `discountPct = 0` la salida es IDENTICA
// campo por campo a la de antes de que existiera el descuento. De eso depende que
// todas las mesas que hoy se cobran sigan cobrandose igual.
// ---------------------------------------------------------------------------

// Normaliza un porcentaje: 0..100, y cualquier basura (NaN, negativo, texto) a 0.
export function cleanPct(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 100 ? 100 : n
}

// `items` = lineas VIVAS de la mesa (las anuladas no entran). `waived` = el mando
// eximio el cargo por servicio de esta mesa.
export function orderTotals(items = [], { servicePct = 0, waived = false, discountPct = 0 } = {}) {
  const subtotal = round2((items || []).reduce((a, i) => a + Number(i?.lineTotal || 0), 0))
  const discPct = cleanPct(discountPct)
  const discount = round2(subtotal * (discPct / 100))
  // Base del servicio: el consumo YA descontado.
  const taxable = round2(subtotal - discount)
  const pct = waived ? 0 : cleanPct(servicePct)
  const service = round2(taxable * (pct / 100))
  return {
    items: items || [],
    count: (items || []).length,
    subtotal,
    discountPct: discPct,
    discount,
    servicePct: pct,
    service,
    total: round2(taxable + service)
  }
}
