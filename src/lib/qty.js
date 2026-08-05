// Limpieza de CANTIDADES de inventario. NO es dinero (por eso vive aparte de
// currency.js/round2): son unidades y pesos.
//
// El stock REAL se deriva sumando el libro mayor (stockMovements). Con productos
// por PESO, sumar y restar fracciones deja RESIDUOS de punto flotante: una
// existencia que deberia ser 0 aparece como 2.6645352591003757e-15, o un 2.5
// como 2.4999999999999996. `cleanQty` redondea a 3 decimales (la milesima: el
// detalle mas fino de una bascula) para eliminar ese residuo sin perder el
// pesaje real, y normaliza el -0 a 0. Un valor no finito cae a 0.
const QTY_DECIMALS = 3
const QTY_FACTOR = 10 ** QTY_DECIMALS

export function cleanQty(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  const r = Math.round((x + Number.EPSILON) * QTY_FACTOR) / QTY_FACTOR
  return Object.is(r, -0) ? 0 : r
}
