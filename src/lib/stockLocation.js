import { WAREHOUSE } from '../db/constants.js'

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
