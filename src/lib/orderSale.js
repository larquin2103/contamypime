import { ORDER_STATUS } from '../db/constants.js'

// Auditoria Burger Premium (H1): una mesa esta COBRADA si existe una venta viva
// con su orderId. Se mira la venta (append-only, id propio: no se pisa ni se
// pierde) y NO order.status, que vive en la cabecera y se fusiona por LWW de
// documento entero: puede llegar tarde o no llegar.
export function isLiveSaleOf(sale, orderId) {
  if (!sale || !orderId) return false
  return sale.orderId === orderId && !sale.voided
}

// Revision de la rama (hallazgo 4): antes mandaba a "revisar la venta en el
// turno", pero la salida real es la reparacion (H2), que ahora corre en el acto
// al rechazar: la mesa se cierra con su venta y sale del salon y del turno.
export const MSG_MESA_COBRADA =
  'Esta mesa ya se cobró: no se puede anular ni quitar consumo. Queda cerrada con su venta.'

// H2 (auditoria Burger Premium): la cabecera dice "open" pero la venta viva ya
// existe -> el cierre no llego por la sync (o el cobro se corto entre las dos
// transacciones de TableScreen). Deliberadamente ESTRECHA, como
// shouldReconcileDelivered: solo promueve open -> closed; no regresa ningun
// estado y no toca anuladas ni reservadas.
export function shouldReconcileClosed(order, sale) {
  if (!order || order.status !== ORDER_STATUS.OPEN) return false
  return isLiveSaleOf(sale, order.id)
}
