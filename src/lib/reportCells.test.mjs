// Pruebas PURAS de la conversion de celdas para el Excel (Control de Ventas Diarias).
// Sin framework: `node src/lib/reportCells.test.mjs`.
//
// QUE CAZA: que una celda "a lo ancho" ({ content, colSpan }) llegue al Excel como
// objeto crudo (SheetJS la guarda sin valor y el texto se pierde); y, sobre todo, que
// la conversion toque NADA de las filas de los reportes que ya existen.
import { plainRows } from './reportCells.js'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}
const d = new Date('2026-09-21T12:00:00.000Z')
const rows = [['Agua', 3, 0, '600.00 MN', null, undefined, '', d, true], [{ content: 'Texto a lo ancho', colSpan: 10 }]]
const out = plainRows(rows)
eq(out[1][0], 'Texto a lo ancho', 'celda a lo ancho -> su texto')
eq(out[1].length, 1, 'la fila de texto sigue siendo de una celda')
// Todo lo que NO es una celda a lo ancho queda IDENTICO (mismo valor y mismo tipo).
eq(JSON.stringify(out[0].slice(0, 7)), JSON.stringify(rows[0].slice(0, 7)), 'valores normales intactos')
eq(out[0][7], d, 'una fecha no se toca (mismo objeto)')
eq(out[0][8], true, 'un booleano no se toca')
eq(out[0][4], null, 'null no se toca')
// Una fila sin ninguna celda a lo ancho se devuelve TAL CUAL (el mismo array).
eq(plainRows([rows[0]])[0], rows[0], 'fila sin celdas a lo ancho: el mismo array')
eq(plainRows(rows)[0] === rows[0], true, 'y dentro de una lista mixta tambien')
// Un objeto sin `content` (no es una celda a lo ancho) no se toca.
const o = { t: 's', v: 'x' }
eq(plainRows([[o]])[0][0], o, 'objeto sin content: intacto')
eq(Array.isArray(plainRows(undefined)), true, 'sin filas: lista vacia')

console.log(`reportCells: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
