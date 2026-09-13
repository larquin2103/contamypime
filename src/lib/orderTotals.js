import { round2 } from './currency.js'
import { ORDER_AUDIT_ACTIONS } from '../db/constants.js'

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

// ---------------------------------------------------------------------------
// C5 - DESCUENTO VIGENTE DERIVADO DE LOS EVENTOS (append-only).
//
// EL PROBLEMA QUE RESUELVE. El descuento vivia SOLO en la cabecera del pedido, y
// esa cabecera se fusiona por "ultima escritura gana" de DOCUMENTO ENTERO. Como
// `addItem` y `voidItem` reescriben la cabecera, bastaba con que un camarero
// agregara una cerveza desde un telefono que aun no habia recibido el descuento
// para que su subida lo BORRARA: la mesa se cobraba completa. Medido, no supuesto.
//
// LA SOLUCION, que es la doctrina del propio proyecto: la cabecera pasa a ser una
// CACHE y la VERDAD vive en los eventos de `auditEvents`, que son append-only con
// id propio y por tanto se fusionan fila por fila: un evento no se puede perder.
// Es lo mismo que `products.stock` (cache) frente al libro mayor (verdad), y el
// mismo patron de `remittancesRepo.reconcileFromDeliveries`, que repara una
// cabecera de entrega perdida por este mismo LWW.
//
// REGLA: manda el ULTIMO evento por fecha. Poner -> ese %; quitar -> 0.
//
// EMPATE (misma fecha al milisegundo): gana QUITAR. Decision escrita a proposito,
// porque los relojes de dos telefonos estan desfasados ~21 s y el orden puede
// salir invertido: un descuento aplicado sin querer cuesta dinero, y uno que no se
// aplico se vuelve a poner en dos toques.
//
// Sin eventos devuelve `null` = "no hay evidencia": quien repare NO debe tocar la
// cabecera en ese caso (podria ser una mesa anterior a esta funcion).
export function discountFromEvents(events) {
  const rows = (events || []).filter(
    (e) => e && (e.action === ORDER_AUDIT_ACTIONS.DISCOUNT || e.action === ORDER_AUDIT_ACTIONS.DISCOUNT_REMOVED)
  )
  if (!rows.length) return null
  const winner = rows.reduce((best, e) => {
    if (!best) return e
    const a = String(e.createdAt || '')
    const b = String(best.createdAt || '')
    if (a > b) return e
    if (a < b) return best
    // Empate exacto: gana QUITAR.
    return e.action === ORDER_AUDIT_ACTIONS.DISCOUNT_REMOVED ? e : best
  }, null)
  if (winner.action === ORDER_AUDIT_ACTIONS.DISCOUNT_REMOVED) {
    return { pct: 0, by: winner.userId || null, at: winner.createdAt || null, action: winner.action }
  }
  return { pct: cleanPct(winner.pct), by: winner.userId || null, at: winner.createdAt || null, action: winner.action }
}

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
