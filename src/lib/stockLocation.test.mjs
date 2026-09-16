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
import { stockAtLocation, negativeLocations, ledgerQty, resolveSourceLocation } from './stockLocation.js'
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

// --- 8) ledgerQty: la existencia REAL, sumando el libro mayor (F3) -----------
// El stock de verdad NO es la cache: es la suma de los movimientos. `approve`
// escribe un asiento append-only en el libro, asi que tiene que calcular el delta
// contra el libro y no contra una cache que puede ir por detras. Paso esto por su
// propia funcion porque la suma esta repetida inline en salesRepo, ordersRepo,
// kitchenRepo y stockRepo, y es donde se cuela el residuo de punto flotante.
{
  const m = (qty) => ({ qty })
  eq(ledgerQty([]), 0, 'libro vacio: cero')
  eq(ledgerQty([m(10)]), 10, 'un solo movimiento')
  eq(ledgerQty([m(10), m(-3), m(-2)]), 5, 'entradas y salidas se compensan')
  eq(ledgerQty([m(5), m(-8)]), -3, 'el resultado NEGATIVO se conserva, no se recorta a cero')
}
{
  // El caso que motivo F3: Galletas de soda. El libro daba -3 y la cache decia 48;
  // `approve` calculo 7 - 48 y clavo un -41 append-only. Con el libro, 7 - (-3) = 10.
  const libro = [{ qty: 14 }, { qty: -12 }, { qty: -5 }]
  eq(ledgerQty(libro), -3, 'F3: el libro de Galletas da -3 (la cache decia 48)')
  eq(round(7 - ledgerQty(libro)), 10, 'F3: el delta correcto es +10, no -41')
}
{
  // Residuo de punto flotante al restar pesos: sin limpiar, un cero real sale
  // como 2.66e-15 y `approve` escribiria un ajuste fantasma de esa nada.
  eq(ledgerQty([{ qty: 0.1 }, { qty: 0.2 }, { qty: -0.3 }]), 0,
    'residuo de punto flotante: un cero real es CERO, no 2.66e-15')
  eq(ledgerQty([{ qty: 2.5 }, { qty: -0.25 }]), 2.25, 'fracciones reales se conservan')
}
{
  // Entradas defectuosas: cero, nunca NaN. Un NaN aqui se propagaria al delta y
  // `stockRepo.adjust` escribiria un movimiento con cantidad NaN en el libro.
  eq(ledgerQty(null), 0, 'libro nulo: cero')
  eq(ledgerQty(undefined), 0, 'libro indefinido: cero')
  eq(ledgerQty([{}, { qty: null }, { qty: 4 }]), 4, 'movimientos sin cantidad cuentan como cero')
  eq(ledgerQty([{ qty: 'x' }, { qty: 3 }]), 3, 'una cantidad no numerica no envenena la suma')
}
function round(n) { return Math.round((n + Number.EPSILON) * 1000) / 1000 }

// --- 9) resolveSourceLocation: de DONDE sale el producto (F4) ----------------
// La deuda interna rebaja de `sourceLocation || area del turno || almacen`. Esa
// regla estaba escrita DOS VECES y distinto —una en `debtsRepo` y otra en
// `CashScreen`—, y por eso la pantalla enseñaba un numero que no era el que se iba
// a descontar: con un mando CON turno pero SIN area, el repo rebajaba del almacen y
// la pantalla mostraba el total del producto en todas las ubicaciones. Ahora la
// regla vive en un sitio y las dos la llaman, asi que no pueden volver a separarse.
{
  eq(resolveSourceLocation('', 'Tienda'), 'Tienda', 'sin eleccion explicita: el area del turno')
  eq(resolveSourceLocation(WAREHOUSE, 'Tienda'), WAREHOUSE,
    'con eleccion explicita (mayorista): manda esa, no el area')
  eq(resolveSourceLocation('', ''), WAREHOUSE,
    'mando CON turno pero SIN area: el almacen — ESTE es el caso que la pantalla enseñaba mal')
  eq(resolveSourceLocation(null, null), WAREHOUSE, 'sin nada: el almacen')
  eq(resolveSourceLocation(undefined, undefined), WAREHOUSE, 'indefinidos: el almacen')
}
{
  // Los espacios se recortan en los dos niveles: un area " " no es un area.
  eq(resolveSourceLocation('  ', 'Tienda'), 'Tienda', 'eleccion en blanco: cae al area')
  eq(resolveSourceLocation('', '  '), WAREHOUSE, 'area en blanco: cae al almacen')
  eq(resolveSourceLocation('  Tienda  ', ''), 'Tienda', 'la eleccion se recorta')
  eq(resolveSourceLocation('', '  Carniceria  '), 'Carniceria', 'el area se recorta')
}

console.log(`${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
