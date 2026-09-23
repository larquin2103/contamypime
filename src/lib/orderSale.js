// Auditoria Burger Premium (H1): una mesa esta COBRADA si existe una venta viva
// con su orderId. Se mira la venta (append-only, id propio: no se pisa ni se
// pierde) y NO order.status, que vive en la cabecera y se fusiona por LWW de
// documento entero: puede llegar tarde o no llegar.
export function isLiveSaleOf(sale, orderId) {
  if (!sale || !orderId) return false
  return sale.orderId === orderId && !sale.voided
}

export const MSG_MESA_COBRADA =
  'Esta mesa ya se cobró: no se puede anular ni quitar consumo. Revisa la venta en el turno.'
