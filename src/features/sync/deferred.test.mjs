// Suite del modulo PURO de la bajada diferida (spec 2026-09-24-reduccion-cuota,
// §10 y §10.5). Se corre con:  node src/features/sync/deferred.test.mjs
import assert from 'node:assert/strict'
import {
  SEALED, isSealed, seal, upToMillis, stripUp,
  pullCursorKey, parseCursor, formatCursor, CURSOR_MARGIN_MS, nextCursor,
  STALE_DEVICE_MS, guardState, ranLegacyBuild,
  deferredSet, verdictKey, parseDeferred
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
eq(upToMillis(ms), ms, 'milisegundos sueltos (asi los mide la guarda de aparatos)')
eq(upToMillis(Number.NaN), null, 'un numero que no es finito -> null')
eq(upToMillis(Infinity), null, 'ni infinito')
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


// --- 7) FOCO 4: la guarda de aparatos ----------------------------------------
const ahora = Date.UTC(2026, 8, 25, 12, 0, 0)
const vivo = (id, extra = {}) => ({
  id, name: id, active: true, caps: { up: 1 },
  sealSeenAt: ahora - 60000, lastSeenAt: ahora - 60000, ...extra
})
const guarda = (devices, reconciledAtMs = ahora) => guardState({ devices, nowMs: ahora, reconciledAtMs })

ok(guarda([vivo('a'), vivo('b')]).ok, 'todos sellan y estan recientes -> se puede filtrar')

const sinCaps = guarda([vivo('a'), vivo('b', { caps: {} })])
ok(!sinCaps.ok, 'un aparato con build viejo bloquea')
eq(sinCaps.bloqueantes.map((x) => x.id), ['b'], 'y lo NOMBRA (si no, el dueno no sabe cual es)')

ok(!guarda([]).ok, 'FOCO 4: lista VACIA -> NO se filtra (lado seguro, nunca "si" por omision)')
ok(!guarda(null).ok, 'FOCO 4: lista ilegible -> NO se filtra')
ok(!guarda(undefined).ok, 'FOCO 4: sin lista -> NO se filtra')

ok(guarda([vivo('a'), { id: 'z', active: false }]).ok,
  'un aparato retirado (active:false) no bloquea')

// H-C: y uno que lleva meses sin abrirse, TAMPOCO -- si no, el ahorro no se
// enciende jamas y nadie se entera.
const olvidado = { id: 'viejo', name: 'viejo', active: true, caps: {},
                   lastSeenAt: ahora - STALE_DEVICE_MS - 1 }
ok(guarda([vivo('a'), olvidado]).ok,
  'un aparato sin abrirse desde hace mas de STALE_DEVICE_MS no bloquea')
ok(!guarda([vivo('a'), { ...olvidado, lastSeenAt: ahora - STALE_DEVICE_MS + 1000 }]).ok,
  'pero uno visto AYER si bloquea (el umbral no es un coladero)')
ok(!guarda([vivo('a'), { id: 'x', name: 'x', active: true, caps: {} }]).ok,
  'y uno SIN lastSeenAt bloquea: no se sabe cuando se vio, asi que no se le da por dormido')
eq(STALE_DEVICE_MS, 30 * 24 * 60 * 60 * 1000, 'el umbral son 30 dias')

// legacyAt: un build viejo corrio DESPUES de que este aparato reconciliara.
ok(!guarda([vivo('a'), vivo('b', { legacyAt: ahora - 1000 })], ahora - 5000).ok,
  'si un build viejo corrio tras nuestra reconciliacion, se vuelve al tiempo real')
ok(guarda([vivo('a'), vivo('b', { legacyAt: ahora - 9000 })], ahora - 5000).ok,
  'un legacyAt ANTERIOR a la reconciliacion ya esta cubierto')
ok(guarda([vivo('a'), vivo('b', { legacyAt: ahora - 1000 })], null).ok,
  'sin marca de reconciliacion, legacyAt no bloquea: no hay nada que rellenar todavia')

// El sello de los tiempos llega como Timestamp, no como numero (viene de /devices).
const comoTimestamp = (ms) => ({ seconds: Math.floor(ms / 1000), nanoseconds: 0 })
ok(guarda([vivo('a', { lastSeenAt: comoTimestamp(ahora - 60000) })]).ok,
  'lastSeenAt como Timestamp de Firestore se entiende igual')
ok(!guarda([vivo('a'), vivo('b', { legacyAt: comoTimestamp(ahora - 1000) })], ahora - 5000).ok,
  'y legacyAt tambien')

ok(typeof guarda([]).motivo === 'string' && guarda([]).motivo.length > 0,
  'siempre da un motivo legible para el panel de /cloud')
ok(guarda([vivo('a')]).motivo === '', 'y cuando si se puede filtrar, no hay motivo que dar')
ok(sinCaps.motivo.includes('b'), 'el motivo NOMBRA al aparato que bloquea')

// --- 7bis) Detectar que en ese aparato corrio un build VIEJO ------------------
// El build viejo NO escribe `caps`, y el `setDoc` va con merge:true, asi que el
// `caps.up` que dejo el build nuevo SIGUE AHI: comparar capacidades no detecta
// nada. Lo que si deja huella es que el viejo toca `lastSeenAt` y no `sealSeenAt`.
ok(!ranLegacyBuild({ lastSeenAt: 1000, sealSeenAt: 1000 }), 'los dos sellos iguales (lo normal): no corrio ninguno viejo')
ok(ranLegacyBuild({ lastSeenAt: 2000, sealSeenAt: 1000 }), 'visto DESPUES de sellar -> corrio un build viejo')
ok(!ranLegacyBuild({ lastSeenAt: 1000, sealSeenAt: 2000 }), 'al reves no significa nada')
ok(!ranLegacyBuild({ lastSeenAt: 2000 }), 'sin sealSeenAt no se concluye nada (de eso ya se encarga caps)')
ok(!ranLegacyBuild({ sealSeenAt: 2000 }), 'sin lastSeenAt tampoco')
ok(!ranLegacyBuild(null), 'aparato nuevo: no hay fila previa')
ok(ranLegacyBuild({ lastSeenAt: { seconds: 2, nanoseconds: 0 }, sealSeenAt: { seconds: 1, nanoseconds: 0 } }), 'con Timestamps de Firestore tambien lo detecta')

// --- 8) Que se difiere -------------------------------------------------------
const todo = { flagOn: true, guardOk: true, sinMesas: true, ordersVacia: true }
eq([...deferredSet(todo)].sort(), ['sales', 'stockMovements'], 'sin mesas se difieren las dos')

eq([...deferredSet({ ...todo, sinMesas: false })], ['stockMovements'],
  'con licencia de mesas, `sales` se QUEDA en vivo (§7bis: toca dinero)')
eq([...deferredSet({ ...todo, ordersVacia: false })], ['stockMovements'],
  'y si hay algun pedido, tambien se queda, aunque la licencia diga que no hay mesas')

eq([...deferredSet({ ...todo, flagOn: false })], [],
  'bandera apagada -> NADA se difiere: identico al comportamiento de hoy')
eq([...deferredSet({ ...todo, guardOk: false })], [], 'guarda no pasada -> NADA se difiere')
eq([...deferredSet({})], [], 'sin datos -> NADA se difiere (lado seguro)')
eq([...deferredSet()], [], 'ni siquiera llamandola sin argumentos')
ok(deferredSet(todo) instanceof Set, 'devuelve un Set')

// --- 9) El VEREDICTO persistido: lo que hace que el invariante sea cierto -----
// `startRealtime` lo lee ANTES de suscribir, asi que un aparato que filtra no
// llama a onSnapshot sobre las diferidas en NINGUN arranque (hallazgo H-B).
eq(verdictKey('neg1'), 'pull:neg1:diferidas', 'el veredicto va atado al negocio')
ok(verdictKey('neg1').startsWith('pull:'),
  'y empieza por pull: -> la Tarea 10 lo excluye del respaldo con los cursores')

eq([...parseDeferred(['stockMovements'])], ['stockMovements'], 'se lee de vuelta')
eq([...parseDeferred(['stockMovements', 'sales'])].sort(), ['sales', 'stockMovements'], 'las dos')
eq([...parseDeferred(['products', 'orders', 'config'])], [],
  'un veredicto corrupto NUNCA puede sacar del vivo una coleccion que no lleva sello')
eq([...parseDeferred(['stockMovements', 'products'])], ['stockMovements'], 'y filtra solo lo bueno')
eq([...parseDeferred(null)], [], 'sin fila -> nada diferido (comportamiento clasico)')
eq([...parseDeferred(undefined)], [], 'sin valor -> nada')
eq([...parseDeferred('stockMovements')], [], 'una cadena suelta no es un veredicto')
eq([...parseDeferred({})], [], 'ni un objeto')
eq(parseDeferred(['stockMovements', 'stockMovements']).size, 1, 'sin duplicados')
ok(parseDeferred(null) instanceof Set, 'siempre un Set')

console.log(`deferred (sello y cursor): ${n} aserciones OK`)
