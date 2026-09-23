// Pruebas PURAS del diagnostico de convergencia del catalogo (La Patrona, 23-09).
// Sin framework: ejecutar con  `node src/lib/convergence.test.mjs`.
//
// QUE CAZA: una version de la FICHA de un producto que este aparato no recibio.
// Todo lo que escribe en el libro mayor sella el producto con el MISMO ts en la
// misma transaccion, y changePrice sella la ficha despues del cambio. Asi que, en
// el aparato que escribio, ficha.updatedAt >= createdAt del movimiento / cambio.
import { findStaleCatalog } from './convergence.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}
const kinds = (r) => r.map((x) => x.kind).join(',')

const P = (id, updatedAt, price = 10) => ({ id, name: `P-${id}`, price, updatedAt })
const M = (productId, createdAt, type = 'sale_out') => ({ id: `m-${productId}-${createdAt}`, productId, createdAt, type })
const C = (productId, createdAt, newPrice) => ({ id: `c-${productId}-${createdAt}`, productId, createdAt, newPrice })

// 1. Misma transaccion: ficha y movimiento con el MISMO ts -> al dia.
eq(findStaleCatalog({ products: [P('a', 'T5')], stockMovements: [M('a', 'T5')] }).length, 0, 'mismo ts: al dia')
// 2. Movimiento posterior a la ficha -> ficha atrasada, con el dato del movimiento.
{
  const r = findStaleCatalog({ products: [P('a', 'T3')], stockMovements: [M('a', 'T2'), M('a', 'T7', 'purchase_in')] })
  eq(kinds(r), 'ficha-atrasada', 'movimiento posterior: ficha atrasada')
  eq(r[0].id, 'a', 'ficha atrasada: id del producto')
  eq(r[0].at, 'T7', 'ficha atrasada: fecha del ULTIMO movimiento')
  eq(/purchase_in/.test(r[0].detail) && /T3/.test(r[0].detail), true, 'ficha atrasada: detalle con tipo y marca de la ficha')
}
// 3. Solo cuenta el ULTIMO movimiento: uno viejo no la marca.
eq(findStaleCatalog({ products: [P('a', 'T5')], stockMovements: [M('a', 'T1'), M('a', 'T4')] }).length, 0, 'movimientos anteriores: al dia')
// 4. Producto sin movimientos, o movimiento de un producto que no esta: nada.
eq(findStaleCatalog({ products: [P('a', 'T1')], stockMovements: [M('zz', 'T9')] }).length, 0, 'sin movimientos propios: nada')
// 5. Cambio de precio posterior a la ficha y precio distinto -> no recibido.
{
  const r = findStaleCatalog({ products: [P('a', 'T3', 3800)], priceChanges: [C('a', 'T6', 4600)] })
  eq(kinds(r), 'precio-no-recibido', 'cambio posterior y precio distinto: no recibido')
  eq(/3800/.test(r[0].detail) && /4600/.test(r[0].detail), true, 'precio no recibido: detalle con los dos precios')
}
// 6. Cambio ya recibido (ficha sellada despues) -> nada.
eq(findStaleCatalog({ products: [P('a', 'T7', 4600)], priceChanges: [C('a', 'T6', 4600)] }).length, 0, 'cambio recibido: nada')
// 7. Solo cuenta el ULTIMO cambio de precio.
eq(findStaleCatalog({ products: [P('a', 'T5', 20)], priceChanges: [C('a', 'T2', 20), C('a', 'T9', 30)] }).length, 1, 'ultimo cambio no recibido')
eq(findStaleCatalog({ products: [P('a', 'T5', 20)], priceChanges: [C('a', 'T9', 20), C('a', 'T2', 30)] }).length, 0, 'ultimo cambio con el mismo precio: nada')
// 8. Las dos marcas a la vez en un mismo producto.
eq(kinds(findStaleCatalog({ products: [P('a', 'T1', 1)], stockMovements: [M('a', 'T4')], priceChanges: [C('a', 'T3', 2)] })),
  'precio-no-recibido,ficha-atrasada', 'dos marcas, ordenadas por fecha')
// 9. Tablas ausentes o vacias no lanzan.
eq(findStaleCatalog().length, 0, 'sin tablas')
eq(findStaleCatalog({ products: [P('a', '')], stockMovements: [M('a', 'T1')] }).length, 1, 'ficha sin marca con movimiento: atrasada')

console.log(`convergence: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
