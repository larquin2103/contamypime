// Candado del hallazgo H-A (spec 2026-09-24-reduccion-cuota §10.5), que es el
// critico: si el cursor de la bajada diferida llega al `where` como CADENA en vez
// de como Timestamp, Firestore compara tipos distintos (Timestamp=3 < String=5),
// devuelve CERO documentos SIN ERROR y la coleccion deja de bajar para siempre.
// No hay forma de cazar eso en ejecucion sin Firestore, y no hay linter: se
// comprueba sobre el FUENTE, que es donde se decide.
//   node src/features/sync/cursorType.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const fuente = readFileSync(join(aqui, 'syncEngine.js'), 'utf8')

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }

const filtros = fuente.split('\n').filter((l) => l.includes("where('_up'"))
ok(filtros.length === 1, `hay UNA sola consulta filtrada por _up (hay ${filtros.length})`)

const linea = filtros[0] || ''
ok(linea.includes('Timestamp.fromMillis('),
  'el valor del filtro se construye con Timestamp.fromMillis: NUNCA se pasa el cursor en crudo')
ok(!/where\('_up',\s*'>',\s*['"`]/.test(linea),
  'y el tercer argumento no es una cadena literal')
ok(!/where\('_up',\s*'>',\s*desdeMs\s*\)/.test(linea),
  'ni el numero pelado: Firestore no compara un numero con un Timestamp')

// El cursor se guarda como texto y se lee como numero. Si alguien guardara el
// Timestamp tal cual en `syncState`, el respaldo y la fila dejarian de ser
// legibles y `parseCursor` devolveria null para siempre (y volveria a bajarlo todo).
ok(fuente.includes('formatCursor(siguiente)'), 'el cursor se GUARDA con formatCursor (texto ISO)')
ok(fuente.includes('parseCursor(fila?.value)'), 'y se LEE con parseCursor (numero o null)')

// El cursor solo avanza si esa coleccion vino del servidor (FOCO 5).
ok(/fromServer:\s*delServidor/.test(fuente),
  'el avance del cursor cuelga del fromServer de ESA coleccion, no del O global de initialPull')

console.log(`cursorType (candado del tipo del cursor): ${n} aserciones OK`)
