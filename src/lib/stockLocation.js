import { WAREHOUSE } from '../db/constants.js'
import { cleanQty } from './qty.js'

// Existencia de un producto en UNA ubicacion, leida de la cache
// (`products.stockByLocation`). Funcion PURA y sin Dexie: por eso tiene su suite
// propia (`stockLocation.test.mjs`), como `custodyMath` o `kitchenMath`.
//
// La fuente de verdad del stock sigue siendo el LIBRO MAYOR (`stockMovements`);
// esto lee la cache, que es lo que pintan las pantallas y lo que validan los repos
// que no re-derivan del libro. Quien necesite la verdad de ultima instancia usa
// `stockRepo.stockAt` (asincrona, suma el libro por `[productId+location]`).
//
// POR QUE EXISTE (F1, 15-09-2026). Esta expresion estaba COPIADA en doce sitios, y
// once de ellos arrastraban un respaldo heredado de la v5: cuando faltaba la clave
// de la ubicacion, devolvian `p.stock` -el TOTAL del producto en TODAS las
// ubicaciones- como si estuviera en el almacen central. Ese respaldo tenia sentido
// en la v5, cuando habia productos sin mapa; pero la migracion (`db.js`) le puso
// `stockByLocation` a todo lo que existia entonces, asi que desde entonces una
// clave ausente significa CERO, no "mira el total".
//
// Lo que costaba, medido sobre los dos respaldos del negocio del 12-09-2026:
// 58 productos que solo habian vivido en Tienda figuraban con su existencia en el
// ALMACEN. Aprobar un conteo del almacen con eso dentro clavaba -1482 unidades
// negativas en el libro mayor (append-only: no se pueden quitar), y el traspaso
// dejaba sacar esas mismas 1482 unidades de un almacen vacio.
//
// Y NO es un residuo de una migracion vieja que se vaya solo: `recomputeStock`
// (pullEngine) reconstruye el mapa con las ubicaciones que TIENEN movimientos, asi
// que un producto que nunca paso por el almacen se queda sin esa clave despues de
// cada bajada de sync. Reaparecia solo.
//
// Con la clave presente -305 de 305 casos en los dos respaldos- devuelve
// EXACTAMENTE lo de siempre: es una correccion de defecto, no un cambio de conducta.
export function stockAtLocation(p, location) {
  const byLoc = p?.stockByLocation
  // Hay mapa: manda el mapa. Clave ausente = 0 (el libro mayor dice 0).
  if (byLoc) return Number(byLoc[location] || 0)
  // Sin mapa = producto anterior a la v5: para el, y solo para el, el total ES su
  // existencia en el almacen. Se conserva para no romper bases viejas.
  return location === WAREHOUSE ? Number(p?.stock || 0) : 0
}

// De DONDE sale el producto de una operacion: la ubicacion elegida explicitamente
// si la hay, si no el area del turno, y si tampoco, el almacen central.
//
// POR QUE EXISTE (F4). Esta regla estaba escrita DOS VECES y distinto: una en
// `debtsRepo.create` y otra en `CashScreen`. Resultado: con un mando CON turno pero
// SIN area, el repo rebajaba del ALMACEN y la pantalla enseñaba `p.stock` —el total
// del producto en TODAS las ubicaciones—, o sea un numero que no era el que se iba a
// descontar. Ahora la regla vive en un sitio y la llaman los dos, asi que no pueden
// volver a separarse. Es la misma leccion de F1: una expresion copiada a mano acaba
// divergiendo.
export function resolveSourceLocation(explicit, shiftArea) {
  return String(explicit || '').trim() || String(shiftArea || '').trim() || WAREHOUSE
}

// Existencia REAL derivada del LIBRO MAYOR: la suma de las cantidades de una lista
// de movimientos (los de un producto en una ubicacion, normalmente traidos por el
// indice `[productId+location]`).
//
// POR QUE EXISTE (F3). La cache es una foto que puede ir por detras del libro —y en
// una fusion de sync puede llegar directamente MAL—, mientras que el libro es
// append-only y es la fuente de verdad. Donde se ESCRIBE un asiento hay que calcular
// contra el libro: el conteo de Galletas de soda registro `systemStock: 48` cuando el
// libro daba -3, `approve` calculo 7-48 y clavo un -41 permanente. 41 de las 44
// unidades negativas de ese producto las puso el conteo, no las ventas.
//
// Se limpia con `cleanQty` porque sumar y restar pesos deja residuos: un cero real
// sale como 2.66e-15 y provocaria un ajuste fantasma por esa nada. Una cantidad
// ausente o no numerica cuenta como 0 y NO envenena la suma con NaN, que se
// propagaria al delta y acabaria escrito en el libro.
export function ledgerQty(movements) {
  if (!Array.isArray(movements)) return 0
  let total = 0
  for (const m of movements) {
    const q = Number(m?.qty)
    if (Number.isFinite(q)) total += q
  }
  return cleanQty(total)
}

// Ubicaciones de un producto que estan en NEGATIVO, con su cantidad:
// `[{ location, qty }]`, vacio si no hay ninguna.
//
// POR QUE HACE FALTA (F2). El negativo no es un fallo que se pueda eliminar del
// todo, y por eso hay que poder VERLO y CORREGIRLO:
//  - El descubierto AUTORIZADO lo crea a proposito (`allowShortProduction`), y el
//    propio diseño dice que queda en negativo "hasta que una entrada, un traspaso
//    o EL CONTEO la neteen".
//  - Y en una app offline-first no hay candado que lo impida: dos vendedores sin
//    internet consultan cada uno SU copia del libro mayor, los dos ven la ultima
//    unidad, los dos venden, y al fusionar el libro suma -1. Los dos candados
//    funcionaron. Ademas el stock derivado del libro no se recorta a cero en
//    ninguna parte de la app: el negativo es posible por construccion.
//
// El CERO no se reporta: agotado es un estado normal, no algo que cuadrar.
//
// Se limpia con `cleanQty` porque restar pesos deja residuos de punto flotante
// (-2.66e-15): sin eso, un producto que cuadra perfecto se avisaria como negativo.
export function negativeLocations(p) {
  const byLoc = p?.stockByLocation
  if (byLoc) {
    const out = []
    for (const loc of Object.keys(byLoc)) {
      const q = cleanQty(byLoc[loc])
      if (q < 0) out.push({ location: loc, qty: q })
    }
    return out
  }
  // Pre-v5 sin mapa: su existencia vive en el almacen (ver `stockAtLocation`).
  const total = cleanQty(p?.stock)
  return total < 0 ? [{ location: WAREHOUSE, qty: total }] : []
}
