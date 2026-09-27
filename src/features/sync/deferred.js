// ---------------------------------------------------------------------------
// Bajada diferida por marca de llegada (spec 2026-09-24-reduccion-cuota).
// MODULO PURO: sin Dexie, sin Firestore, sin React. Todo lo externo se inyecta,
// asi que se prueba entero con node. El cableado vive en pushEngine/pullEngine/
// syncEngine/SyncProvider. Mismo patron que compareResend.js.
// ---------------------------------------------------------------------------

// Colecciones que llevan el sello `_up`. SON SOLO ESTAS DOS, y ampliarlas exige
// medir antes: mientras el eco del §10.4 siga ahi, cada resubida de una fila
// sellada lleva un _up nuevo y cuesta una lectura en los demas aparatos.
export const SEALED = ['stockMovements', 'sales']
export const isSealed = (name) => SEALED.includes(name)

// El sello va DESPUES de serializar. JSON.stringify(serverTimestamp()) da
// {"_methodName":"serverTimestamp"} (ejecutado, §10.2): puesto antes, en la nube
// quedaria un MAPA inerte, y un mapa no entra en ningun filtro de rango. Ademas
// asi pisa cualquier _up que un build viejo hubiera guardado en Dexie.
export function seal(name, plain, sentinel) {
  if (!isSealed(name)) return plain
  return { ...plain, _up: sentinel() }
}

// `_up` puede llegar de cuatro formas: Timestamp del SDK, Timestamp plano
// ({seconds,nanoseconds}) cuando viene serializado, Date, o AUSENTE (documento
// que subio un build viejo). Devuelve milisegundos o null. NUNCA NaN: un NaN en
// el cursor lo envenena para siempre y la coleccion deja de bajar en silencio.
export function upToMillis(v) {
  if (v == null) return null
  // Milisegundos sueltos. `_up` nunca llega asi desde Firestore, pero esta funcion
  // tambien mide `lastSeenAt` y `legacyAt`, y negarse a entender un numero dejaria
  // ese aparato como "visto ahora mismo": el lado que BLOQUEA el ahorro en silencio.
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v.toMillis === 'function') {
    const ms = v.toMillis()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof v.seconds === 'number') {
    const ms = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6)
    return Number.isFinite(ms) ? ms : null
  }
  if (v instanceof Date) {
    const ms = v.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

// P2: quita `_up` antes de que la tanda entre en Dexie (no viaja en respaldos ni
// se resube) y devuelve el maximo visto, que es lo unico que se conserva de el.
export function stripUp(docs) {
  let maxUpMs = null
  const out = docs.map((d) => {
    const ms = upToMillis(d?._up)
    if (ms != null && (maxUpMs == null || ms > maxUpMs)) maxUpMs = ms
    if (d && '_up' in d) {
      const copia = { ...d }
      delete copia._up
      return copia
    }
    return d
  })
  return { docs: out, maxUpMs }
}

// El cursor va atado al NEGOCIO: unlinkDevice no limpia syncState (solo apaga el
// flag), asi que un cursor de otro negocio dejaria huecos permanentes en este.
//
// Se llama `pullCursorKey` y no `cursorKey` a proposito: en pushEngine.js ya hay
// un `cursorKey` que significa otra cosa (`push:<coleccion>`), y ese fichero
// tambien importa de aqui.
export const pullCursorKey = (businessId, name) => `pull:${businessId}:${name}`

// EL TIPO DEL CURSOR (hallazgo H-A del §10.5, el critico). Se GUARDA como texto
// ISO —la convencion de la casa, legible en syncState— y se USA en milisegundos.
// parseCursor devuelve SIEMPRE un numero o null, para que sea imposible pasarle
// una cadena al `where`: Firestore ordena primero por TIPO (Timestamp=3,
// String=5), asi que comparar un Timestamp contra una cadena devuelve CERO
// documentos, sin error y para siempre.
export function parseCursor(stored) {
  if (typeof stored !== 'string' || !stored) return null
  const ms = Date.parse(stored)
  return Number.isFinite(ms) ? ms : null
}

export function formatCursor(ms) {
  return new Date(ms).toISOString()
}

// Solapamiento deliberado: Firestore no garantiza entregar en orden de `_up`, y
// el limite de la consulta es ESTRICTO (>), asi que sin margen se perderia el
// documento que empate al milisegundo. Con la hora del SERVIDOR ya no hay relojes
// de telefono que cubrir: basta con superar el plazo de un commit (60 s).
export const CURSOR_MARGIN_MS = 120000

// El cursor avanza SOLO si la respuesta vino del servidor de ESA coleccion, y
// NUNCA retrocede.
export function nextCursor({ prevMs, maxUpMs, fromServer }) {
  const base = Number.isFinite(prevMs) ? prevMs : null
  if (!fromServer || maxUpMs == null) return base
  const candidato = maxUpMs - CURSOR_MARGIN_MS
  if (base == null) return candidato
  return candidato > base ? candidato : base
}


// Un aparato que el dueno no ha retirado a mano sigue `active:true` PARA SIEMPRE
// (removeDevice es la unica via). Sin este umbral, un telefono perdido, roto o
// reinstalado bloquearia el filtro eternamente y el ahorro no se encenderia nunca
// —sin ningun error, que es lo peor—. 30 dias: quien no abre la app en un mes no
// va a recibir una bajada que le importe.
export const STALE_DEVICE_MS = 30 * 24 * 60 * 60 * 1000

// ¿Puede este aparato filtrar? Solo si TODOS los aparatos activos y recientes
// publican que sellan (`caps.up`), y si ninguno ejecuto un build viejo DESPUES de
// nuestra ultima reconciliacion. Ante la duda —lista vacia, ilegible— devuelve
// NO: el lado seguro es no filtrar, nunca filtrar por omision.
export function guardState({ devices, nowMs, reconciledAtMs }) {
  if (!Array.isArray(devices) || devices.length === 0) {
    return { ok: false, bloqueantes: [], motivo: 'No se pudo leer la lista de dispositivos.' }
  }
  const bloqueantes = []
  for (const d of devices) {
    if (!d || d.active === false) continue
    const visto = upToMillis(d.lastSeenAt)
    // Sin `lastSeenAt` NO se le da por dormido: no se sabe cuando se vio, y darlo
    // por muerto seria filtrar por omision, que es justo lo que no se puede hacer.
    if (visto != null && nowMs - visto > STALE_DEVICE_MS) continue
    if (!(d.caps && d.caps.up)) {
      bloqueantes.push({ id: d.id, name: d.name || d.id, motivo: 'no ha actualizado la app' })
      continue
    }
    // Un build viejo corriendo AHORA MISMO en ese aparato (hallazgo C1 de la
    // revision). `caps.up` no lo delata -el viejo no escribe `caps` y el setDoc va
    // con merge, asi que conserva el del build nuevo- y `legacyAt` es
    // RETROSPECTIVO: solo se escribe cuando ese aparato vuelve al build nuevo.
    // Entre medias, los demas filtrarian y sus filas sin `_up` no bajarian por
    // ninguna consulta: hueco permanente y silencioso en el libro. Lo que SI deja
    // huella en el acto es que el viejo toca `lastSeenAt` y no `sealSeenAt`.
    if (ranLegacyBuild(d)) {
      bloqueantes.push({ id: d.id, name: d.name || d.id, motivo: 'está usando una versión antigua' })
      continue
    }
    // Y uno que ya volvio al build nuevo, pero corrio uno viejo DESPUES de nuestra
    // reconciliacion: lo que subio entonces va sin sello y hay que volver al vivo.
    const legacy = upToMillis(d.legacyAt)
    if (legacy != null && reconciledAtMs != null && legacy > reconciledAtMs) {
      bloqueantes.push({ id: d.id, name: d.name || d.id, motivo: 'abrio una version antigua' })
    }
  }
  if (bloqueantes.length) {
    const nombres = bloqueantes.map((b) => `${b.name} (${b.motivo})`).join(', ')
    return { ok: false, bloqueantes, motivo: `Esperando a: ${nombres}.` }
  }
  return { ok: true, bloqueantes: [], motivo: '' }
}

// ¿Corrio un build VIEJO en este aparato despues de la ultima vez que sello?
//
// No se puede detectar comparando capacidades: el build viejo no escribe `caps`,
// y como el `setDoc` va con merge:true, el `caps.up` que dejo el build nuevo sigue
// en la fila. Lo que si deja huella es que el viejo toca `lastSeenAt` y NO
// `sealSeenAt`: si el visto es posterior al sellado, por ahi paso un build que no
// sella, y todo lo que subio va sin `_up`, asi que ninguna consulta filtrada lo
// devolveria. Los aparatos que ya filtraban tienen que volver al tiempo real.
//
// Los dos son hora del SERVIDOR y el build nuevo los escribe en la MISMA
// escritura, asi que en marcha normal salen iguales, nunca uno mayor.
// OJO: `guardState` la llama, y esta declarada DESPUES. Es una `function` (sube
// por hoisting); convertirla en `const` la rompe.
export function ranLegacyBuild(prev) {
  const visto = upToMillis(prev?.lastSeenAt)
  const sellado = upToMillis(prev?.sealSeenAt)
  if (visto == null || sellado == null) return false
  return visto > sellado
}

// Que colecciones salen del tiempo real. Por defecto NINGUNA: con la bandera
// apagada o la guarda sin pasar, la app se comporta EXACTAMENTE como hoy.
//
// `sales` solo sale si el negocio no tiene mesas, y hacen falta las DOS pruebas:
// la licencia (que es LOCAL de cada aparato y puede ir desfasada) y que `orders`
// este vacia (que es dato sincronizado). Con mesas, el cobro de una mesa escribe
// `sales` y `orders`, la cabecera se pierde por LWW (H2) y el candado contra el
// doble cobro lee `db.sales` LOCAL: sin `sales` en vivo, el candado no dispara.
// Cuesta poco dejarla: en el negocio con mesas medido es el 1,3 % de D.
export function deferredSet({ flagOn, guardOk, sinMesas, ordersVacia } = {}) {
  if (!flagOn || !guardOk) return new Set()
  const out = new Set(['stockMovements'])
  if (sinMesas && ordersVacia) out.add('sales')
  return out
}

// EL VEREDICTO PERSISTIDO. Aqui es donde vive el invariante del hallazgo H-B:
// "un aparato con el filtro activo NO llama a onSnapshot sobre las diferidas, en
// ningun arranque". Para que eso sea cierto, la decision no puede depender de una
// comprobacion asincrona que corre DESPUES de que el tiempo real ya arranco: se
// guarda en `syncState` y `startRealtime` la lee antes de suscribir.
//
// Va bajo el prefijo `pull:` para que la Tarea 10 lo saque del respaldo junto con
// los cursores: restaurar un respaldo viejo no puede dejar a un aparato filtrando
// con una guarda que ya no se cumple.
export const verdictKey = (businessId) => `pull:${businessId}:diferidas`

// Marca de "este aparato ya reconcilio con el servidor para este negocio". Se
// borra (se deja en blanco) cuando la guarda se rompe, para que el arranque
// siguiente vuelva a reconciliar con las colecciones otra vez en vivo.
export const reconciledKey = (businessId) => `pull:${businessId}:reconciliado`

// Marca de "este aparato ya bajo TODAS las colecciones del servidor al menos una
// vez para este negocio". Va bajo `pull:` como las demas: no viaja en el respaldo,
// porque en otro aparato seria mentira.
export const fullPullKey = (businessId) => `pull:${businessId}:bajadaCompleta`

// Lee el veredicto guardado. Solo admite colecciones CON SELLO: un valor viejo o
// corrupto no puede sacar del tiempo real una coleccion que nadie sella, porque
// esa no bajaria por ningun otro camino y desapareceria del aparato en silencio.
export function parseDeferred(stored) {
  if (!Array.isArray(stored)) return new Set()
  return new Set(stored.filter((n) => typeof n === 'string' && isSealed(n)))
}

// EL TIMBRE (P6): la bajada diferida se dispara por EVENTO, no por reloj. El
// sondeo paga el silencio; medido sobre el libro real de tres negocios, el timbre
// con antirrebote de 5 s cuesta 3,8 veces menos que sondear cada 15 minutos Y
// ademas borra el retraso. No es un compromiso: gana en los dos ejes.
export const RING_DEBOUNCE_MS = 5000
// R2 — tormenta de timbre: el alta de un negocio son 6.622 documentos y haria
// sonar el timbre muchas veces. Con tope, el peor caso es la red de seguridad.
export const RING_WINDOW_MS = 10 * 60 * 1000
export const RING_MAX_PER_WINDOW = 6
// R2b — si el timbre no suena (el aparato estaba dormido): el peor caso pasa de
// "nunca" a "una hora".
export const SAFETY_NET_MS = 60 * 60 * 1000

export function ringDecision({ nowMs, recientes }) {
  const previas = Array.isArray(recientes) ? recientes : []
  const enVentana = previas.filter((t) => nowMs - t < RING_WINDOW_MS)
  if (enVentana.length >= RING_MAX_PER_WINDOW) return { suena: false, recientes: enVentana }
  return { suena: true, recientes: [...enVentana, nowMs] }
}

// ¿Esta tanda del oyente trae algo de OTRO aparato? Se le pasa el
// `hasPendingWrites` de cada cambio. Una escritura propia llega al instante con
// la marca puesta; sin este filtro, cada venta de este mismo aparato tocaria el
// timbre y se pagaria una consulta que no puede traer ninguna novedad.
//
// La confirmacion del servidor de esa misma escritura NO vuelve a disparar el
// oyente: sin `includeMetadataChanges`, un cambio que solo toca metadatos no se
// entrega. Asi que filtrar aqui no pierde ningun aviso ajeno.
export function hasForeignChange(pendingWrites) {
  if (!Array.isArray(pendingWrites)) return false
  return pendingWrites.some((p) => !p)
}

// Que hacer cuando el veredicto cambia. Dos reglas, y las dos importan:
//
//  - EMPEZAR a filtrar no reabre el tiempo real. La sesion en la que se decide
//    se queda en vivo -exactamente como hoy- y el filtro entra en el arranque
//    siguiente, que es cuando `startRealtime` lee el veredicto antes de
//    suscribir. Cerrar y reabrir aqui costaria un enganche en frio de las otras
//    32 colecciones en cada arranque: justo el coste que se quiere quitar.
//
//  - DEJAR de filtrar si reabre, y ademas borra la marca de reconciliacion.
//    Mientras este aparato filtraba nadie escuchaba esas colecciones, asi que
//    hay que resuscribirse ya; y la reconciliacion tiene que rehacerse para
//    rellenar lo que un build sin sello hubiera subido sin `_up`. Sin ese
//    borrado, un `legacyAt` posterior dejaba la guarda cerrada PARA SIEMPRE.
export function transitionPlan({ prevCols, nextCols }) {
  const antes = prevCols instanceof Set ? prevCols : new Set()
  const despues = nextCols instanceof Set ? nextCols : new Set()
  const vuelveAlVivo = [...antes].some((c) => !despues.has(c))
  return { restart: vuelveAlVivo, resetReconcile: vuelveAlVivo }
}

// Cuantas filas de la tanda traen el sello como MAPA en vez de como Timestamp.
//
// Pasa asi: un aparato con el build VIEJO baja una fila ya sellada y la guarda
// en su Dexie, donde el Timestamp pierde el prototipo y queda {seconds,
// nanoseconds}; el eco del §10.4 la vuelve a subir con `JSON.stringify`, y en la
// nube queda un mapa. Firestore ordena por TIPO antes que por valor, y
// ObjectValue (11) va POR ENCIMA de TimestampValue (3): esa fila satisface
// `_up > cualquier cursor` y vuelve a bajar en CADA consulta filtrada, para
// siempre. Desde la bajada no hay forma de excluirla -ningun cursor la deja
// fuera-, asi que lo unico honesto es CONTARLA y que se vea en el registro.
//
// Del servidor, un campo timestamp llega SIEMPRE como Timestamp del SDK (con su
// `toMillis`); un campo mapa llega como objeto pelado. Por ahi se distinguen.
export function mapSeals(docs) {
  if (!Array.isArray(docs)) return 0
  let n = 0
  for (const doc of docs) {
    const v = doc?._up
    if (v != null && typeof v.toMillis !== 'function') n++
  }
  return n
}
