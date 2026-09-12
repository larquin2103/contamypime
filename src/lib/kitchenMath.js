import { COCINA, MOVEMENT_TYPES } from '../db/constants.js'

// ---------------------------------------------------------------------------
// Matematica PURA del motor de elaboracion (modulos 'cocina' y 'cocteleria').
// Sin Dexie: se puede probar con node (patron de custodyMath / productCustodyMath).
//
// Aqui vive lo que se puede decidir SIN tocar la base: cuantas unidades se pueden
// elaborar con una cache de stock, y QUE movimientos del libro mayor genera una
// elaboracion. El candado real (validar contra el libro mayor dentro de la
// transaccion) sigue viviendo en kitchenRepo, que es quien tiene acceso a la BD.
// ---------------------------------------------------------------------------

// Cuantas unidades del elaborado se pueden hacer con el stock ACTUAL de una
// ubicacion (solo lectura, para el tablero). N = min sobre insumos de
// floor(stock(insumo, location) / consumoPorUnidad). Sin insumos, o con algun
// insumo en 0/faltante -> 0. `productById` es el mapa id->producto (con su cache
// `stockByLocation`). `location` por defecto la COCINA = comportamiento clasico.
export function canMake(recipe, productById, location = COCINA) {
  const items = recipe?.items || []
  if (!items.length) return 0
  let n = Infinity
  for (const it of items) {
    const per = Number(it.qty) || 0
    if (per <= 0) return 0
    const p = productById?.[it.productId]
    const have = Number(p?.stockByLocation?.[location] || 0)
    n = Math.min(n, Math.floor(have / per))
    if (n <= 0) return 0
  }
  return Number.isFinite(n) ? n : 0
}

// Movimientos del libro mayor que genera UNA elaboracion, en orden. Devuelve
// descriptores `{ productId, qty, type, location }`; kitchenRepo les añade id,
// refType/refId, unitCost, usuario y fecha, y los escribe en su transaccion.
//
// Dos casos, y el segundo es la razon de existir de esta funcion:
//  - `from !== to` (COCINA -> area, el clasico): se consumen los insumos en la
//    cocina, se CREA el elaborado en la cocina y ENSEGUIDA sale hacia el area
//    (TRANSFER_OUT/IN). Neto en la cocina = 0; el total sube +u y termina en el area.
//  - `from === to` (cocteleria: el area elabora para si misma): los insumos y el
//    elaborado viven en la MISMA ubicacion, asi que NO se emiten traspasos. Emitir
//    un TRANSFER_OUT y un TRANSFER_IN en la misma ubicacion seria neto cero pero
//    ensuciaria el submayor con traspasos que nunca ocurrieron.
// En AMBOS casos el efecto sobre la cache es el mismo: la ubicacion de destino
// gana +u del elaborado y el total del producto sube +u.
export function productionMovements({ from, to, units, ingredients = [], outputProductId }) {
  const u = Number(units) || 0
  const out = []
  for (const ing of ingredients) {
    out.push({ productId: ing.productId, qty: -Number(ing.qty), type: MOVEMENT_TYPES.CONVERSION_OUT, location: from })
  }
  out.push({ productId: outputProductId, qty: u, type: MOVEMENT_TYPES.CONVERSION_IN, location: from })
  if (from !== to) {
    out.push({ productId: outputProductId, qty: -u, type: MOVEMENT_TYPES.TRANSFER_OUT, location: from })
    out.push({ productId: outputProductId, qty: u, type: MOVEMENT_TYPES.TRANSFER_IN, location: to })
  }
  return out
}
