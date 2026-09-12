// Pruebas PURAS del motor de elaboracion (modulos 'cocina' y 'cocteleria').
// Sin framework: ejecutar con  `node src/lib/kitchenMath.test.mjs`.
//
// QUE EXISTE ESTA SUITE PARA CAZAR:
//  1) Que el flujo CLASICO (cocina -> area) siga generando EXACTAMENTE los mismos
//     cuatro movimientos de siempre. Si alguien rompe eso, el submayor, el kardex y
//     el stock de un negocio en produccion se van al suelo en silencio.
//  2) Que la cocteleria (origen == destino) NO emita traspasos. Emitir un
//     TRANSFER_OUT y un TRANSFER_IN en la misma ubicacion daria neto cero y por eso
//     el stock "cuadraria", pero el reporte de traspasos mostraria movimientos que
//     nunca ocurrieron.
//  3) Que `canMake` mire la ubicacion que se le pide y no siempre la cocina.
import { canMake, productionMovements } from './kitchenMath.js'
import { COCINA, MOVEMENT_TYPES } from '../db/constants.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${e}\n  obtenido: ${a}`)
}
function ok(cond, label) { eq(!!cond, true, label) }

// --- Utilidades de los casos -------------------------------------------------
const AREA = 'Terraza'
const OTRA = 'Restaurante'

// Producto con existencia por ubicacion (la cache que lee el tablero).
const prod = (id, byLoc) => ({ id, name: id, unit: 'u', stockByLocation: byLoc })

// --- 1) canMake: el minimo sobre los insumos, en la ubicacion pedida ---------
{
  const receta = { items: [{ productId: 'ron', qty: 0.05 }, { productId: 'menta', qty: 2 }] }
  const byId = {
    ron: prod('ron', { [COCINA]: 0, [AREA]: 1 }), // 1 / 0.05 = 20
    menta: prod('menta', { [AREA]: 30 }) // 30 / 2 = 15
  }
  eq(canMake(receta, byId, AREA), 15, 'canMake toma el MINIMO sobre los insumos')
  eq(canMake(receta, byId, COCINA), 0, 'canMake mira la ubicacion pedida (en la cocina no hay)')
  eq(canMake(receta, byId), 0, 'canMake sin ubicacion = cocina (default clasico)')
  eq(canMake(receta, byId, OTRA), 0, 'canMake en un area sin insumos da 0')
}
{
  // El default clasico sigue siendo la cocina: con existencia SOLO en la cocina,
  // llamar sin ubicacion tiene que seguir dando el numero de siempre.
  const receta = { items: [{ productId: 'harina', qty: 0.25 }] }
  const byId = { harina: prod('harina', { [COCINA]: 5 }) }
  eq(canMake(receta, byId), 20, 'canMake sin ubicacion usa la cocina (5 / 0.25 = 20)')
  eq(canMake(receta, byId, COCINA), 20, 'canMake con la cocina explicita da lo mismo')
}
{
  eq(canMake({ items: [] }, {}, AREA), 0, 'receta sin insumos -> 0')
  eq(canMake(null, {}, AREA), 0, 'receta nula -> 0')
  eq(canMake(undefined, undefined, AREA), 0, 'sin receta ni mapa -> 0')
  eq(canMake({ items: [{ productId: 'x', qty: 0 }] }, { x: prod('x', { [AREA]: 10 }) }, AREA), 0,
    'consumo 0 por unidad -> 0 (no se divide por cero)')
  eq(canMake({ items: [{ productId: 'x', qty: -1 }] }, { x: prod('x', { [AREA]: 10 }) }, AREA), 0,
    'consumo negativo -> 0')
  eq(canMake({ items: [{ productId: 'falta', qty: 1 }] }, {}, AREA), 0,
    'insumo que no esta en el mapa -> 0')
  eq(canMake({ items: [{ productId: 'x', qty: 1 }] }, { x: prod('x', { [AREA]: -3 }) }, AREA), 0,
    'existencia NEGATIVA -> 0 (no se puede elaborar en descubierto sin permiso)')
  eq(canMake({ items: [{ productId: 'x', qty: 3 }] }, { x: prod('x', { [AREA]: 8 }) }, AREA), 2,
    'redondea hacia abajo (8 / 3 = 2, no 2.67)')
}

// --- 2) Movimientos del flujo CLASICO: cocina -> area ------------------------
{
  const ingredients = [
    { productId: 'harina', qty: 0.5 },
    { productId: 'queso', qty: 0.2 }
  ]
  const movs = productionMovements({ from: COCINA, to: AREA, units: 2, ingredients, outputProductId: 'pizza' })
  eq(movs, [
    { productId: 'harina', qty: -0.5, type: MOVEMENT_TYPES.CONVERSION_OUT, location: COCINA },
    { productId: 'queso', qty: -0.2, type: MOVEMENT_TYPES.CONVERSION_OUT, location: COCINA },
    { productId: 'pizza', qty: 2, type: MOVEMENT_TYPES.CONVERSION_IN, location: COCINA },
    { productId: 'pizza', qty: -2, type: MOVEMENT_TYPES.TRANSFER_OUT, location: COCINA },
    { productId: 'pizza', qty: 2, type: MOVEMENT_TYPES.TRANSFER_IN, location: AREA }
  ], 'cocina -> area: la secuencia EXACTA de siempre (consumo, creacion, traspaso)')
  eq(movs.length, 5, 'cocina -> area con 2 insumos: 5 movimientos')

  // El elaborado queda neto 0 en la cocina y +u en el area; el total sube +u.
  const netoEn = (loc) => movs.filter((m) => m.productId === 'pizza' && m.location === loc)
    .reduce((a, m) => a + m.qty, 0)
  eq(netoEn(COCINA), 0, 'el elaborado no se queda en la cocina (se crea y sale)')
  eq(netoEn(AREA), 2, 'el elaborado termina en el area de destino')
  eq(movs.filter((m) => m.productId === 'pizza').reduce((a, m) => a + m.qty, 0), 2,
    'el total del elaborado sube +u (la creacion suma, el traspaso no)')
}

// --- 3) Cocteleria: origen == destino, SIN traspasos ------------------------
{
  const ingredients = [
    { productId: 'ron', qty: 0.05 },
    { productId: 'menta', qty: 2 },
    { productId: 'azucar', qty: 0.02 }
  ]
  const movs = productionMovements({ from: AREA, to: AREA, units: 3, ingredients, outputProductId: 'mojito' })
  eq(movs, [
    { productId: 'ron', qty: -0.05, type: MOVEMENT_TYPES.CONVERSION_OUT, location: AREA },
    { productId: 'menta', qty: -2, type: MOVEMENT_TYPES.CONVERSION_OUT, location: AREA },
    { productId: 'azucar', qty: -0.02, type: MOVEMENT_TYPES.CONVERSION_OUT, location: AREA },
    { productId: 'mojito', qty: 3, type: MOVEMENT_TYPES.CONVERSION_IN, location: AREA }
  ], 'area -> misma area: consumo + creacion, y NADA mas')
  ok(!movs.some((m) => m.type === MOVEMENT_TYPES.TRANSFER_OUT), 'no emite TRANSFER_OUT')
  ok(!movs.some((m) => m.type === MOVEMENT_TYPES.TRANSFER_IN), 'no emite TRANSFER_IN')
  eq(movs.length, 4, 'area -> misma area con 3 insumos: 4 movimientos (no 6)')
  eq(movs.filter((m) => m.productId === 'mojito').reduce((a, m) => a + m.qty, 0), 3,
    'el trago queda +u en su area')
  ok(movs.every((m) => m.location === AREA), 'todo ocurre en la misma ubicacion')
}

// --- 4) Casos borde de los movimientos --------------------------------------
{
  const movs = productionMovements({ from: COCINA, to: AREA, units: 1, ingredients: [], outputProductId: 'x' })
  eq(movs.length, 3, 'sin insumos: creacion + los dos traspasos (el candado de insumos vive en el repo)')
  eq(movs[0].type, MOVEMENT_TYPES.CONVERSION_IN, 'el primero es la creacion')
}
{
  // Un area distinta del origen SI genera traspaso (no es el caso de cocteleria,
  // pero es la regla: la rama depende de from !== to, no del tipo de receta).
  const movs = productionMovements({ from: AREA, to: OTRA, units: 1, ingredients: [{ productId: 'a', qty: 1 }], outputProductId: 'y' })
  eq(movs.map((m) => m.type), [
    MOVEMENT_TYPES.CONVERSION_OUT, MOVEMENT_TYPES.CONVERSION_IN,
    MOVEMENT_TYPES.TRANSFER_OUT, MOVEMENT_TYPES.TRANSFER_IN
  ], 'origen != destino entre dos areas: tambien lleva traspasos')
  eq(movs[2].location, AREA, 'el TRANSFER_OUT sale del origen')
  eq(movs[3].location, OTRA, 'el TRANSFER_IN entra al destino')
}
{
  const movs = productionMovements({ from: AREA, to: AREA, units: 0.5, ingredients: [{ productId: 'a', qty: 0.1 }], outputProductId: 'y' })
  eq(movs[1].qty, 0.5, 'unidades fraccionarias se respetan tal cual')
  eq(movs.length, 2, 'fraccion en la misma ubicacion: 2 movimientos')
}

console.log(`${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
