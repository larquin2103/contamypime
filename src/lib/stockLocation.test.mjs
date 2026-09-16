// Pruebas PURAS de la lectura de existencia POR UBICACION.
// Sin framework: ejecutar con  `node src/lib/stockLocation.test.mjs`.
//
// QUE EXISTE ESTA SUITE PARA CAZAR:
//  1) EL DEFECTO QUE LA MOTIVO (F1). La version vieja tenia un respaldo heredado de
//     la v5 que, cuando faltaba la clave `__almacen`, devolvia `p.stock` -el TOTAL
//     del producto en TODAS las ubicaciones- como si estuviera en el almacen. En los
//     dos respaldos del negocio *De todo un tin* (12-09-2026) eso afectaba a 58
//     productos: el almacen decia tener 240 hamburguesas que solo existian en Tienda.
//     Aprobar un conteo del almacen con eso dentro clavaba -1482 unidades negativas
//     en el libro mayor, y el traspaso dejaba sacar esas mismas 1482 de un almacen
//     vacio. Si alguien restaura ese respaldo, esta suite se pone roja.
//  2) Que el camino SANO no cambie. Con la clave presente -305 de 305 casos en los
//     respaldos- el resultado tiene que ser identico al de siempre, byte a byte: es
//     una correccion de defecto, no un cambio de comportamiento.
//  3) Que la rama pre-v5 siga viva. Un producto anterior a la v5 no tiene el mapa
//     `stockByLocation`, y para el -y SOLO para el- el total sigue siendo su
//     existencia en el almacen. Quitar esa rama romperia bases viejas.
//  4) Que no invente existencia en un AREA. La copia de `conversionsRepo` caia al
//     total en CUALQUIER ubicacion, no solo en el almacen: era la peor de las doce.
import { stockAtLocation, negativeLocations } from './stockLocation.js'
import { WAREHOUSE } from '../db/constants.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (Object.is(actual, expected)) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}

const AREA = 'Tienda'
const OTRA = 'Carniceria'

// --- 1) Camino SANO: la clave esta presente -> identico a siempre -------------
{
  const p = { stock: 10, stockByLocation: { [WAREHOUSE]: 7, [AREA]: 3 } }
  eq(stockAtLocation(p, WAREHOUSE), 7, 'clave presente en el almacen: devuelve la suya, no el total')
  eq(stockAtLocation(p, AREA), 3, 'clave presente en un area: devuelve la suya')
  eq(stockAtLocation(p, OTRA), 0, 'area sin clave en un producto repartido: cero')
}

// --- 2) EL DEFECTO: mapa presente, clave del almacen AUSENTE ------------------
// Caso real del respaldo: byLoc={"Tienda":240} y p.stock=240. La version vieja
// devolvia 240 para el ALMACEN. El libro mayor decia 0.
{
  const hamburguesa = { stock: 240, stockByLocation: { [AREA]: 240 } }
  eq(stockAtLocation(hamburguesa, WAREHOUSE), 0,
    'F1: producto que solo vivio en un area NO tiene existencia en el almacen')
  eq(stockAtLocation(hamburguesa, AREA), 240,
    'F1: y en su area sigue teniendo las 240 de siempre')
}
{
  // La copia de conversionsRepo caia al total tambien en un AREA.
  const p = { stock: 50, stockByLocation: { [AREA]: 50 } }
  eq(stockAtLocation(p, OTRA), 0,
    'F1: tampoco inventa existencia en OTRA area (era el fallo de conversionsRepo)')
}

// --- 3) Rama pre-v5: sin mapa, el total ES el almacen -------------------------
// La migracion v5 (db.js) le puso `stockByLocation` a todo lo que existia entonces,
// asi que esta rama solo la pisa un producto anterior. Se conserva tal cual.
{
  const viejo = { stock: 12 }
  eq(stockAtLocation(viejo, WAREHOUSE), 12, 'pre-v5 sin mapa: el total es su existencia en el almacen')
  eq(stockAtLocation(viejo, AREA), 0, 'pre-v5 sin mapa: en un area, cero')
}

// --- 4) Negativos: se conservan, no se recortan -------------------------------
// Los cuatro negativos del negocio viven en Tienda. El conteo tiene que poder
// verlos (F2), asi que aqui NO se pueden convertir en cero.
{
  const galletas = { stock: -30, stockByLocation: { [AREA]: -30 } }
  eq(stockAtLocation(galletas, AREA), -30, 'un negativo real de su area se devuelve tal cual')
  eq(stockAtLocation(galletas, WAREHOUSE), 0,
    'pero ese negativo NO se le atribuye al almacen (era el respaldo mintiendo)')
}

// --- 5) Entradas defectuosas: cero, nunca NaN ni excepcion -------------------
// Varios llamadores usan `p?.` porque el producto puede no existir todavia
// (`db.products.get` que no encuentra nada). Debe degradar a 0, no reventar.
{
  eq(stockAtLocation(null, WAREHOUSE), 0, 'producto nulo: cero')
  eq(stockAtLocation(undefined, AREA), 0, 'producto indefinido: cero')
  eq(stockAtLocation({}, WAREHOUSE), 0, 'producto sin stock ni mapa: cero')
  eq(stockAtLocation({ stockByLocation: {} }, WAREHOUSE), 0, 'mapa vacio: cero, no el total')
  eq(stockAtLocation({ stock: 5, stockByLocation: { [WAREHOUSE]: null } }, WAREHOUSE), 0,
    'clave presente pero nula: cero, no el total')
}

// --- 6) Fraccionarios: se respetan (productos por peso) -----------------------
{
  const arroz = { stock: 2.5, stockByLocation: { [AREA]: 2.5 } }
  eq(stockAtLocation(arroz, AREA), 2.5, 'un peso fraccionario no se redondea')
}

// --- 7) negativeLocations: donde hay que cuadrar algo (F2) --------------------
// El aviso al dueño y el conteo necesitan saber QUE ubicaciones de un producto
// estan en negativo. En un sistema offline-first el negativo no se puede impedir
// del todo (dos vendedores sin internet venden la misma ultima unidad y la fusion
// suma -1) y el descubierto autorizado lo crea a proposito, asi que hay que poder
// detectarlo y corregirlo. Devuelve SIEMPRE un array, para no obligar a nadie a
// comprobar null.
function eqJson(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${e}\n  obtenido: ${a}`)
}
{
  eqJson(negativeLocations({ stock: 10, stockByLocation: { [WAREHOUSE]: 7, [AREA]: 3 } }), [],
    'todo en positivo: ninguna ubicacion que cuadrar')
  eqJson(negativeLocations({ stock: 0, stockByLocation: { [AREA]: 0 } }), [],
    'cero NO es negativo: no se avisa de lo agotado')
  eqJson(negativeLocations({ stock: -30, stockByLocation: { [AREA]: -30 } }),
    [{ location: AREA, qty: -30 }],
    'un negativo en su area se reporta con su cantidad')
  eqJson(negativeLocations({ stock: -5, stockByLocation: { [WAREHOUSE]: 2, [AREA]: -7 } }),
    [{ location: AREA, qty: -7 }],
    'solo la ubicacion negativa, aunque otra este en positivo')
  eqJson(negativeLocations({ stock: -9, stockByLocation: { [WAREHOUSE]: -2, [AREA]: -7 } }),
    [{ location: WAREHOUSE, qty: -2 }, { location: AREA, qty: -7 }],
    'dos ubicaciones negativas: se reportan las dos')
}
{
  // Pre-v5 sin mapa: su existencia vive en el almacen, asi que un total negativo
  // es un negativo DEL ALMACEN. Coherente con `stockAtLocation`.
  eqJson(negativeLocations({ stock: -4 }), [{ location: WAREHOUSE, qty: -4 }],
    'pre-v5 sin mapa: el total negativo es del almacen')
  eqJson(negativeLocations({ stock: 4 }), [], 'pre-v5 en positivo: nada que cuadrar')
}
{
  // Entradas defectuosas: array vacio, nunca excepcion (lo recorre un barrido
  // sobre TODO el catalogo, y un producto a medio crear no puede tumbarlo).
  eqJson(negativeLocations(null), [], 'producto nulo: array vacio')
  eqJson(negativeLocations(undefined), [], 'producto indefinido: array vacio')
  eqJson(negativeLocations({}), [], 'producto sin stock ni mapa: array vacio')
}
{
  // Residuo de punto flotante: restar pesos deja -2.66e-15, que NO es un faltante.
  // Se limpia igual que hace `cleanQty` en el resto del inventario.
  eqJson(negativeLocations({ stockByLocation: { [AREA]: -0.0000000000000027 } }), [],
    'residuo de punto flotante: NO es un negativo real')
  eqJson(negativeLocations({ stockByLocation: { [AREA]: -0.5 } }), [{ location: AREA, qty: -0.5 }],
    'medio kilo en negativo SI es real')
}

console.log(`${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
