// Suite del modulo PURO de la bajada diferida (spec 2026-09-24-reduccion-cuota,
// §10 y §10.5). Se corre con:  node src/features/sync/deferred.test.mjs
import assert from 'node:assert/strict'
import {
  SEALED, isSealed, seal, upToMillis, stripUp,
  pullCursorKey, parseCursor, formatCursor, CURSOR_MARGIN_MS, nextCursor
} from './deferred.js'

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++ }

// --- 1) Que se sella, y que NO -----------------------------------------------
eq(SEALED, ['stockMovements', 'sales'], 'exactamente dos colecciones llevan sello')
ok(isSealed('stockMovements') && isSealed('sales'), 'las dos selladas')
ok(!isSealed('products') && !isSealed('orders') && !isSealed('counts'),
  'NINGUNA otra lleva sello (el eco del §10.4 lo haria caro)')

// --- 2) El sello va DESPUES de serializar ------------------------------------
const centinela = () => ({ __centinela: true })
const sellado = seal('stockMovements', { id: 'm1', qty: 5 }, centinela)
eq(sellado.id, 'm1', 'conserva el documento')
eq(sellado._up, { __centinela: true }, 'el centinela llega VIVO, no aplanado')

const pisado = seal('stockMovements', { id: 'm1', _up: '2026-01-01T00:00:00.000Z' }, centinela)
eq(pisado._up, { __centinela: true }, 'pisa un _up viejo que un build viejo dejara en Dexie')

const intacto = seal('products', { id: 'p1' }, centinela)
eq(intacto, { id: 'p1' }, 'una coleccion sin sello sale IDENTICA (objeto sin _up)')
ok(!('_up' in intacto), 'y sin la clave siquiera')

// --- 3) FOCO 2: _up llega en cuatro formas ------------------------------------
const ms = Date.UTC(2026, 8, 25, 12, 0, 0)
eq(upToMillis({ toMillis: () => ms }), ms, 'Timestamp del SDK')
eq(upToMillis({ seconds: ms / 1000, nanoseconds: 0 }), ms, 'Timestamp plano (cache/serializado)')
eq(upToMillis(new Date(ms)), ms, 'Date')
eq(upToMillis('2026-09-25T12:00:00.000Z'), ms, 'cadena ISO (tolerada al leer, nunca al filtrar)')
eq(upToMillis(undefined), null, 'ausente -> null, NUNCA NaN')
eq(upToMillis(null), null, 'null -> null')
eq(upToMillis({}), null, 'objeto raro -> null')
eq(upToMillis('no es fecha'), null, 'basura -> null')
ok(!Number.isNaN(upToMillis({})), 'jamas devuelve NaN (envenenaria el cursor)')

// --- 4) stripUp: P2, no entra en Dexie ---------------------------------------
const tanda = [
  { id: 'a', qty: 1, _up: { toMillis: () => 100 } },
  { id: 'b', qty: 2, _up: { toMillis: () => 300 } },
  { id: 'c', qty: 3 } // build viejo: sin sello
]
const r = stripUp(tanda)
eq(r.maxUpMs, 300, 'devuelve el maximo visto')
ok(r.docs.every((d) => !('_up' in d)), '_up NO entra en Dexie (ni en respaldos, ni se resube)')
eq(r.docs.map((d) => d.id), ['a', 'b', 'c'], 'no pierde ni reordena documentos')
eq(r.docs[0].qty, 1, 'no toca el resto del documento')
eq(stripUp([]).maxUpMs, null, 'tanda vacia -> sin maximo')
eq(stripUp([{ id: 'x' }]).maxUpMs, null, 'tanda sin ningun sello -> sin maximo')

// --- 5) FOCO 1: el cursor se GUARDA texto y se USA en milisegundos ------------
eq(pullCursorKey('neg1', 'stockMovements'), 'pull:neg1:stockMovements',
  'la clave lleva el negocio (unlinkDevice NO limpia syncState)')
ok(pullCursorKey('neg1', 'sales') !== pullCursorKey('neg2', 'sales'),
  'dos negocios no comparten cursor')

eq(typeof formatCursor(ms), 'string', 'se guarda como texto (legible en syncState)')
eq(formatCursor(ms), '2026-09-25T12:00:00.000Z', 'y es ISO')
eq(parseCursor('2026-09-25T12:00:00.000Z'), ms, 'se lee de vuelta a milisegundos')
eq(typeof parseCursor('2026-09-25T12:00:00.000Z'), 'number',
  'parseCursor SIEMPRE devuelve NUMERO: un Timestamp nunca se compara con una cadena')
eq(parseCursor(''), null, 'sin cursor -> null (primera bajada: sin filtro)')
eq(parseCursor(null), null, 'sin fila -> null')
eq(parseCursor('basura'), null, 'basura -> null, NUNCA NaN')
ok(!Number.isNaN(parseCursor('basura')), 'jamas NaN')
eq(parseCursor(ms), null, 'un numero suelto NO es un cursor guardado valido')

// --- 6) FOCO 3: margen, empates y que nunca retroceda -------------------------
eq(CURSOR_MARGIN_MS, 120000, 'margen de 120 s (con hora del servidor no hay relojes que cubrir)')

eq(nextCursor({ prevMs: null, maxUpMs: ms, fromServer: true }), ms - CURSOR_MARGIN_MS,
  'primer avance: maximo menos el margen')
eq(nextCursor({ prevMs: ms, maxUpMs: ms - 1000, fromServer: true }), ms,
  'NUNCA retrocede aunque la tanda traiga marcas mas viejas')
eq(nextCursor({ prevMs: 0, maxUpMs: ms, fromServer: false }), 0,
  'FOCO 5: si la respuesta vino de CACHE, el cursor no se mueve')
eq(nextCursor({ prevMs: 10, maxUpMs: null, fromServer: true }), 10,
  'tanda sin sellos: no mueve el cursor')
const dos = nextCursor({ prevMs: null, maxUpMs: ms, fromServer: true })
ok(ms - dos === CURSOR_MARGIN_MS,
  'el solapamiento hace que un empate al milisegundo vuelva a bajar (el limite es >)')

console.log(`deferred (sello y cursor): ${n} aserciones OK`)
