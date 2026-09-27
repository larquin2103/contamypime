// Suite del modulo PURO de la bajada diferida (spec 2026-09-24-reduccion-cuota,
// §10 y §10.5). Se corre con:  node src/features/sync/deferred.test.mjs
import assert from 'node:assert/strict'
import {
  SEALED, isSealed, seal, upToMillis, stripUp,
  pullCursorKey, parseCursor, formatCursor, CURSOR_MARGIN_MS, nextCursor,
  STALE_DEVICE_MS, guardState, ranLegacyBuild,
  deferredSet, verdictKey, parseDeferred,
  RING_DEBOUNCE_MS, RING_WINDOW_MS, RING_MAX_PER_WINDOW, SAFETY_NET_MS,
  ringDecision, hasForeignChange, reconciledKey, transitionPlan, mapSeals
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

// --- 10) El timbre, su tope (R2) y la red de seguridad (R2b) ------------------
eq(RING_DEBOUNCE_MS, 5000, 'antirrebote de 5 s (el medido: 38 pulsaciones/dia y aparato)')
eq(RING_WINDOW_MS, 600000, 'la ventana del tope son 10 minutos')
eq(RING_MAX_PER_WINDOW, 6, 'y caben 6 bajadas en ella')
eq(SAFETY_NET_MS, 3600000, 'red de seguridad cada 60 min por si el timbre se pierde')

const t0 = 1000000
let est = []
for (let i = 0; i < RING_MAX_PER_WINDOW; i++) {
  const d = ringDecision({ nowMs: t0 + i, recientes: est })
  ok(d.suena, `pulsacion ${i + 1} dentro del tope: suena`)
  est = d.recientes
}
ok(!ringDecision({ nowMs: t0 + 100, recientes: est }).suena,
  'R2: pasado el tope, NO suena (si no, el alta de un negocio serian 86.400 lecturas/dia)')
ok(ringDecision({ nowMs: t0 + RING_WINDOW_MS + 1, recientes: est }).suena,
  'y vuelve a sonar cuando la ventana pasa')
eq(ringDecision({ nowMs: t0 + RING_WINDOW_MS + 10, recientes: est }).recientes.length, 1,
  'pasada la ventana entera, la lista se poda y solo queda la de ahora')
ok(ringDecision({ nowMs: t0 + RING_WINDOW_MS + 1, recientes: est }).recientes.length <= RING_MAX_PER_WINDOW,
  'la lista NUNCA crece por encima del tope, aunque la ventana solo se haya pasado a medias')
ok(ringDecision({ nowMs: t0, recientes: undefined }).suena, 'sin historial, suena')
ok(ringDecision({ nowMs: t0, recientes: 'basura' }).suena, 'con un historial ilegible, tambien')

// R6: el timbre lo tocan los cambios de OTRO aparato, no las escrituras propias.
// Una venta escribe `products`, el oyente la devuelve al instante con
// hasPendingWrites=true, y sin este filtro el aparato se llamaria a si mismo:
// hasta 864 consultas al dia por puro eco, sin una sola novedad que traer.
ok(!hasForeignChange([true, true]), 'solo escrituras propias pendientes -> NO suena')
ok(hasForeignChange([true, false]), 'si alguna viene confirmada del servidor -> suena')
ok(hasForeignChange([false]), 'un cambio ajeno basta')
ok(!hasForeignChange([]), 'sin cambios no suena')
ok(!hasForeignChange(undefined), 'ni con una lista ilegible (lado barato)')
ok(!hasForeignChange(null), 'ni con null')

// --- 11) La marca de reconciliacion ------------------------------------------
eq(reconciledKey('neg1'), 'pull:neg1:reconciliado', 'la marca tambien va atada al negocio')
ok(reconciledKey('neg1').startsWith('pull:'),
  'empieza por pull: -> la Tarea 10 la excluye del respaldo junto con los cursores')
ok(reconciledKey('neg1') !== verdictKey('neg1'), 'y no choca con la del veredicto')
ok(reconciledKey('neg1') !== pullCursorKey('neg1', 'sales'), 'ni con la de ningun cursor')

// --- 12) La transicion: que hacer cuando cambia el veredicto ------------------
// Encender el filtro NO reabre el tiempo real: la sesion de transicion se queda
// en vivo, como hoy, y el aparato empieza a filtrar en el arranque siguiente.
// Cerrar y reabrir aqui costaria un enganche de las otras 32 colecciones, que es
// justo lo que este trabajo viene a quitar.
eq(transitionPlan({ prevCols: new Set([]), nextCols: new Set(['stockMovements']) }),
  { restart: false, resetReconcile: false },
  'empezar a filtrar no reabre el tiempo real')

// Volver al vivo SI: mientras este aparato filtraba nadie escuchaba esa
// coleccion, asi que hay que resuscribirse ya, y volver a reconciliar despues
// (esa relectura es la que rellena lo que se hubiera perdido).
eq(transitionPlan({ prevCols: new Set(['stockMovements', 'sales']), nextCols: new Set([]) }),
  { restart: true, resetReconcile: true },
  'dejar de filtrar reabre el vivo y obliga a reconciliar otra vez')
eq(transitionPlan({ prevCols: new Set(['stockMovements', 'sales']), nextCols: new Set(['stockMovements']) }),
  { restart: true, resetReconcile: true },
  'si una sola coleccion vuelve al vivo, tambien: nadie la estaba escuchando')

eq(transitionPlan({ prevCols: new Set(['stockMovements']), nextCols: new Set(['stockMovements']) }),
  { restart: false, resetReconcile: false }, 'sin cambios no se toca nada')
eq(transitionPlan({ prevCols: new Set([]), nextCols: new Set([]) }),
  { restart: false, resetReconcile: false }, 'y con todo en vivo, menos aun')
eq(transitionPlan({ prevCols: new Set(['stockMovements']), nextCols: new Set(['stockMovements', 'sales']) }),
  { restart: false, resetReconcile: false },
  'anadir una coleccion al filtro tampoco reabre: se aplica en el arranque siguiente')

// --- 13) El build viejo corriendo AHORA (hallazgo C1 de la revision) ---------
// La guarda miraba `caps.up` y `legacyAt`, y NINGUNO ve una sesion de build
// viejo EN CURSO: el viejo no escribe `caps` y el setDoc va con merge, asi que
// el `caps.up` del build nuevo sigue en la fila; y `legacyAt` solo se escribe
// cuando ese aparato VUELVE al build nuevo. Mientras tanto, los demas filtraban
// y sus filas sin `_up` no bajaban por ninguna consulta: hueco permanente.
const conBuildViejoAhora = {
  id: 'b', name: 'b', active: true, caps: { up: 1 },
  sealSeenAt: ahora - 100000, // sello de la ultima vez que corrio el build nuevo
  lastSeenAt: ahora - 1000 // pero se le vio DESPUES, sin volver a sellar
}
const conViejo = guarda([vivo('a'), conBuildViejoAhora])
ok(!conViejo.ok, 'un aparato que ACABA de correr un build sin sello bloquea, aunque conserve caps.up')
eq(conViejo.bloqueantes.map((x) => x.id), ['b'], 'y lo nombra')

// Y no puede dar falsos positivos: el build nuevo escribe los dos sellos en el
// MISMO setDoc, asi que comparten el instante del commit.
ok(guarda([vivo('a'), vivo('b')]).ok, 'con los dos sellos iguales no bloquea nadie')
ok(guarda([{ ...vivo('c'), sealSeenAt: ahora - 1000, lastSeenAt: ahora - 1000 }]).ok,
  'ni con sellos iguales en otro instante')
ok(guarda([{ id: 'd', name: 'd', active: true, caps: { up: 1 }, lastSeenAt: ahora - 1000 }]).ok,
  'un aparato sin sealSeenAt no se juzga por aqui: de ese ya se encarga caps')

// Un aparato RETIRADO o DORMIDO no bloquea aunque haya corrido un build viejo.
ok(guarda([vivo('a'), { ...conBuildViejoAhora, active: false }]).ok,
  'retirado a mano: no bloquea')
ok(guarda([vivo('a'), { ...conBuildViejoAhora, lastSeenAt: ahora - STALE_DEVICE_MS - 1 }]).ok,
  'dormido hace mas de 30 dias: no bloquea')

// --- 14) Sellos que llegaron como MAPA (hallazgo I4 de la revision) ----------
// Un build VIEJO baja una fila sellada, guarda el `_up` en su Dexie (donde el
// Timestamp pierde el prototipo) y el eco del §10.4 la vuelve a subir con su
// `toCloud`, que es JSON.stringify: en la nube queda un MAPA. Y un mapa ordena
// POR ENCIMA de cualquier Timestamp (ObjectValue=11 > TimestampValue=3), asi
// que satisface `> cualquier cursor` y vuelve a bajar EN CADA consulta, para
// siempre. No se puede arreglar desde la bajada; se CUENTA para poder medirlo.
eq(mapSeals([{ _up: { toMillis: () => 1 } }]), 0, 'un Timestamp de verdad no cuenta')
eq(mapSeals([{ _up: { seconds: 1, nanoseconds: 0 } }]), 1, 'un mapa plano SI')
eq(mapSeals([{ _up: { seconds: 1 } }, { _up: { seconds: 2 } }]), 2, 'se cuentan todos')
eq(mapSeals([{ id: 'a' }, { _up: null }]), 0, 'sin sello no hay mapa')
eq(mapSeals([]), 0, 'tanda vacia')
eq(mapSeals(null), 0, 'lista ilegible -> 0, no lanza')

console.log(`deferred (sello y cursor): ${n} aserciones OK`)
