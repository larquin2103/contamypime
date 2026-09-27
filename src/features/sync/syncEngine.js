import { getFirebase } from '../../lib/firebase'
import { syncConfig } from './syncService'
import { SYNC_COLLECTIONS } from './collections'
import { pushChanges } from './pushEngine'
import { mergeIncoming, recomputeStock } from './pullEngine'
import { logSyncEvent } from '../../lib/syncLog'
import { db } from '../../db/db'
import {
  verdictKey, parseDeferred, pullCursorKey, parseCursor, formatCursor, nextCursor,
  hasForeignChange
} from './deferred'

// ---------------------------------------------------------------------------
// Fase 4 - Orquestador de sincronizacion.
//
//  - syncNow(): sube los cambios locales (Bloque 23).
//  - startRealtime()/stopRealtime(): escucha Firestore en vivo y fusiona en
//    Dexie con LWW, recalculando stock desde el libro mayor (Bloque 24).
// ---------------------------------------------------------------------------

export async function syncNow() {
  const up = await pushChanges()
  return { up }
}

// Lo que ESTA sesion NO escucha en vivo. No se inyecta desde fuera: se fija
// dentro de `startRealtime`, leyendo el veredicto que dejo escrito el arranque
// anterior, y SIEMPRE antes de suscribir. Ahi esta el invariante del hallazgo
// H-B: un aparato que filtra no llama a onSnapshot sobre las diferidas en ningun
// arranque. Si la decision se tomara despues -con una comprobacion de red, por
// ejemplo- el oyente ya habria enganchado, que es EXACTAMENTE el coste que esto
// viene a quitar. Vacio = comportamiento clasico.
let diferidasSesion = new Set()

// Lo que este aparato esta difiriendo AHORA. Lo leen `pullDiferido` y el panel.
export function getDeferred() {
  return new Set(diferidasSesion)
}

async function leerVeredicto(businessId) {
  try {
    const row = await db.syncState.get(verdictKey(businessId))
    return parseDeferred(row?.value)
  } catch {
    return new Set() // ante cualquier duda, el vivo de siempre
  }
}

// Descarga inicial de una sola pasada (getDocs). A diferencia del listener en
// tiempo real (onSnapshot, streaming que algunos proxies/VPN bloquean), esto
// usa peticiones normales y es mas fiable para el primer "bajar todo". Lanza
// el error real de Firestore si falla (para poder diagnosticar).
export async function initialPull() {
  if (!(await syncConfig.isEnabled())) return { ok: false, reason: 'sync desactivada', total: 0 }
  const businessId = await syncConfig.businessId()
  if (!businessId) return { ok: false, reason: 'sin negocio vinculado', total: 0 }

  const { db: fs, auth } = await getFirebase()
  if (!auth.currentUser) return { ok: false, reason: 'sin sesion de nube', total: 0 }
  const { collection, getDocs } = await import('firebase/firestore')

  let total = 0
  // ¿Al menos una respuesta vino del SERVIDOR (no de la cache)? Firestore, con
  // cache persistente, NO lanza cuando el servidor no responde: sirve la cache y
  // resuelve igual. Por eso, para una salud honesta, hay que mirar
  // metadata.fromCache: si TODO viene de cache, hay "conexion" segun el SO pero
  // el servidor no contesto (antivirus/proxy que corta Firestore, red sin salida
  // o token muerto). Eso NO es una sincronizacion confirmada.
  let fromServer = false
  const affected = new Set()
  for (const col of SYNC_COLLECTIONS) {
    // Las diferidas no bajan por aqui: sin oyente, este getDocs sin filtro dejaria
    // de ser gratis y seria una consulta real de la coleccion ENTERA cada 45 s.
    // Bajan por `pullDiferido`, que pide solo lo llegado desde el cursor.
    if (diferidasSesion.has(col.name)) continue
    const snap = await getDocs(collection(fs, 'businesses', businessId, col.name))
    if (!snap.metadata.fromCache) fromServer = true
    const docs = snap.docs.map((d) => d.data())
    if (docs.length) {
      const aff = await mergeIncoming(col, docs)
      aff.forEach((x) => affected.add(x))
      total += docs.length
    }
  }
  if (affected.size) await recomputeStock(affected)
  return { ok: true, total, fromServer }
}


// Cerrojo de la bajada diferida. Sin el, el timbre, la red de seguridad de 60 min
// y el tiron al traer la app al frente pueden solaparse: se pagarian las mismas
// lecturas dos veces y las dos pasadas se pisarian el cursor. `runPull` ya lleva
// el suyo por lo mismo.
let bajandoDiferido = false

// Bajada de las colecciones DIFERIDAS: una consulta por coleccion, filtrada por
// la marca de llegada. Sin oyente, esto SI es una consulta real y cuesta lo que
// devuelve -- que es justo el punto: devuelve lo nuevo, no la historia entera.
export async function pullDiferido() {
  const cols = getDeferred()
  if (!cols.size) return { ok: true, total: 0, porColeccion: {} }
  if (bajandoDiferido) return { ok: false, reason: 'ya hay una bajada en curso', total: 0 }
  if (!(await syncConfig.isEnabled())) return { ok: false, reason: 'sync desactivada', total: 0 }
  const businessId = await syncConfig.businessId()
  if (!businessId) return { ok: false, reason: 'sin negocio vinculado', total: 0 }

  const { db: fs, auth } = await getFirebase()
  if (!auth.currentUser) return { ok: false, reason: 'sin sesion de nube', total: 0 }
  const { collection, getDocs, query, where, Timestamp } = await import('firebase/firestore')

  bajandoDiferido = true
  let total = 0
  const porColeccion = {}
  const affected = new Set()
  try {
    for (const col of SYNC_COLLECTIONS) {
      if (!cols.has(col.name)) continue
      const clave = pullCursorKey(businessId, col.name)
      const fila = await db.syncState.get(clave)
      // EL TIPO IMPORTA (spec §10.5, H-A). El cursor se guarda como texto ISO y se
      // reconstruye a Timestamp para la consulta. Pasar la cadena tal cual haria que
      // Firestore comparase tipos distintos (Timestamp=3 < String=5) y devolviera
      // CERO documentos, sin error, sin excepcion y para siempre: la coleccion
      // dejaria de bajar y el stock de este aparato quedaria mal de forma permanente.
      const desdeMs = parseCursor(fila?.value)
      const ref = collection(fs, 'businesses', businessId, col.name)
      const q = desdeMs == null ? ref : query(ref, where('_up', '>', Timestamp.fromMillis(desdeMs)))

      const snap = await getDocs(q)
      const docs = snap.docs.map((d) => d.data())
      const delServidor = !snap.metadata.fromCache
      porColeccion[col.name] = { leidos: docs.length, fromCache: snap.metadata.fromCache }

      let maxUpMs = null
      if (docs.length) {
        const aff = await mergeIncoming(col, docs)
        maxUpMs = aff.maxUpMs ?? null
        aff.forEach((x) => affected.add(x))
        total += docs.length
      }
      // El cursor avanza SOLO si la respuesta vino del SERVIDOR de ESTA coleccion
      // (no del O global de initialPull): avanzarlo con una respuesta de cache
      // dejaria un hueco permanente en el libro.
      const siguiente = nextCursor({ prevMs: desdeMs, maxUpMs, fromServer: delServidor })
      if (siguiente != null && siguiente !== desdeMs) {
        await db.syncState.put({ key: clave, value: formatCursor(siguiente) })
      }
    }

    // Igual que en el vivo: primero fusionar, DESPUES derivar el stock; al reves
    // parpadearia unos segundos con el valor viejo (recomputeStock lee el libro local).
    if (affected.size) await recomputeStock(affected)
  } finally {
    bajandoDiferido = false
  }
  return { ok: true, total, porColeccion }
}

let listeners = []
let starting = false

// EL TIMBRE. Lo toca el oyente de una coleccion que SIGUE en vivo y lo atiende
// el proveedor (que es quien tiene el antirrebete y el tope). Se fija igual que
// el veredicto: sin handler, no suena nada y todo queda como hoy.
let onRing = null
export function setRingHandler(fn) {
  onRing = typeof fn === 'function' ? fn : null
}

// Procesa una tanda entrante y, si toca inventario, recalcula stock.
async function handleIncoming(col, docs) {
  try {
    const affected = await mergeIncoming(col, docs)
    if (affected.size) await recomputeStock(affected)
  } catch (e) {
    console.warn('[sync] merge', col.name, e?.message)
    // El lote se pierde aqui: onSnapshot no lo vuelve a entregar salvo que cambie.
    logSyncEvent('bajada-fusion-descartada', col.name, e, `${docs.length} doc(s)`)
  }
}

export async function startRealtime() {
  if (listeners.length || starting) return
  if (!(await syncConfig.isEnabled())) return
  const businessId = await syncConfig.businessId()
  if (!businessId) return

  starting = true
  try {
    const { db: fs, auth } = await getFirebase()
    if (!auth.currentUser) return
    const { collection, onSnapshot } = await import('firebase/firestore')

    // AQUI, y no despues: lo que se lea ahora decide a que se suscribe este
    // arranque. El veredicto lo dejo escrito el arranque anterior (SyncProvider),
    // asi que es una lectura local y rapida, sin red de por medio.
    diferidasSesion = await leerVeredicto(businessId)

    for (const col of SYNC_COLLECTIONS) {
      if (diferidasSesion.has(col.name)) continue
      const ref = collection(fs, 'businesses', businessId, col.name)
      const unsub = onSnapshot(
        ref,
        (snap) => {
          // c es un DocumentChange: el documento (con .data()) esta en c.doc.
          const cambios = snap
            .docChanges()
            .filter((c) => c.type === 'added' || c.type === 'modified')
          if (!cambios.length) return
          handleIncoming(col, cambios.map((c) => c.doc.data()))
          // El timbre solo lo tocan los cambios de OTRO aparato: una escritura
          // propia vuelve por aqui al instante con hasPendingWrites, y bajar lo
          // diferido por ella seria pagar una consulta que no trae ninguna novedad.
          if (onRing && hasForeignChange(cambios.map((c) => c.doc.metadata.hasPendingWrites))) {
            onRing(col.name)
          }
        },
        (err) => {
          console.warn('[sync] onSnapshot', col.name, err?.code || err?.message)
          // Firestore da el oyente por MUERTO tras este callback: la coleccion deja
          // de bajar en vivo hasta que algo llame a restartRealtime.
          logSyncEvent('bajada-oyente-caido', col.name, err)
        }
      )
      listeners.push(unsub)
    }
  } finally {
    starting = false
  }
}

export function stopRealtime() {
  for (const unsub of listeners) {
    try {
      unsub()
    } catch {
      /* noop */
    }
  }
  listeners = []
}

export function isRealtimeOn() {
  return listeners.length > 0
}

// FASE 2: reabre los listeners en vivo (p.ej. tras renovar un token caducado o
// al reconectar). Cierra los actuales y vuelve a suscribir. Seguro: solo afecta
// a las SUSCRIPCIONES de lectura (onSnapshot), nunca a la cola de escrituras del
// SDK (esa la administra Firestore y sobrevive a esto).
export async function restartRealtime() {
  stopRealtime()
  await startRealtime()
}
