// Prueba CON BASE (fake-indexeddb) del selector de ubicaciones del Control de Ventas Diarias.
// No corre con node directo porque reportsService importa sin extension: se empaqueta.
//   npx esbuild src/features/reports/dailyControlLocations.test.mjs --bundle --platform=node \
//     --format=esm --outfile=<scratch>/dcl.bundle.mjs && node <scratch>/dcl.bundle.mjs
//
// QUE CAZA: que leer las claves del INDICE 'location' (sin barrer la tabla) pierda alguna
// ubicacion que el barrido completo si veia; y el orden y la desambiguacion de etiquetas.
import 'fake-indexeddb/auto'
import { db } from '../../db/db'
import { dailyControlLocations } from './reportsService'
import { WAREHOUSE, COCINA } from '../../db/constants'

let pass = 0
let fail = 0
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return }
  fail++
  console.error(`FAIL ${label}\n  esperado: ${expected}\n  obtenido: ${actual}`)
}
const mov = (id, location) => ({ id, productId: 'p', type: 'x', qty: 1, createdAt: '2026-09-20T12:00:00.000Z', ...(location === undefined ? {} : { location }) })

await db.open()
// Sin datos: el almacen siempre.
eq((await dailyControlLocations()).map((o) => o.value).join(','), WAREHOUSE, 'sin movimientos: solo el almacen')

// Areas configuradas primero (en su orden), luego el almacen y despues el resto con movimientos.
await db.config.put({ key: 'areas', value: ['Salones', 'Terraza'] })
await db.stockMovements.bulkPut([
  mov('m1', 'Salones'), mov('m2', COCINA), mov('m3', 'Cocina'), mov('m4', 'Bodega vieja'),
  mov('m5', undefined), // sin ubicacion: cuenta como almacen (no entra en el indice)
  mov('m6', ''), // cadena vacia: tambien almacen
  mov('m7', WAREHOUSE)
])
const locs = await dailyControlLocations()
const values = locs.map((o) => o.value)
eq(values.slice(0, 3).join(','), `Salones,Terraza,${WAREHOUSE}`, 'areas en su orden y luego el almacen')
eq(values.filter((v) => v === WAREHOUSE).length, 1, 'el almacen una sola vez')
// Lo que el barrido completo veria: cada ubicacion con movimientos esta en la lista.
const barrido = new Set((await db.stockMovements.toArray()).map((m) => m.location || WAREHOUSE))
eq([...barrido].every((l) => values.includes(l)), true, `el indice no pierde ninguna ubicacion del barrido (${[...barrido].join(',')})`)
eq(values.includes(''), false, 'la cadena vacia no sale como ubicacion propia')
// El area historica 'Cocina' y la cocina del modulo tienen la misma etiqueta: se distinguen.
const labels = locs.map((o) => o.label)
eq(new Set(labels).size, labels.length, `etiquetas sin repetir (${labels.join(' | ')})`)

console.log(`dailyControlLocations: ${pass} OK, ${fail} fallos`)
if (fail) process.exit(1)
