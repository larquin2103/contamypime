import { getFirebase } from '../../lib/firebase'
import { syncConfig } from './syncService'
import { SYNC_COLLECTIONS } from './collections'
import { pushChanges } from './pushEngine'
import { mergeIncoming, recomputeStock } from './pullEngine'

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

let listeners = []
let starting = false

// Procesa una tanda entrante y, si toca inventario, recalcula stock.
async function handleIncoming(col, docs) {
  try {
    const affected = await mergeIncoming(col, docs)
    if (affected.size) await recomputeStock(affected)
  } catch (e) {
    console.warn('[sync] merge', col.name, e?.message)
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

    for (const col of SYNC_COLLECTIONS) {
      const ref = collection(fs, 'businesses', businessId, col.name)
      const unsub = onSnapshot(
        ref,
        (snap) => {
          const docs = snap
            .docChanges()
            .filter((c) => c.type === 'added' || c.type === 'modified')
            // c es un DocumentChange: el documento (con .data()) esta en c.doc.
            .map((c) => c.doc.data())
          if (docs.length) handleIncoming(col, docs)
        },
        (err) => console.warn('[sync] onSnapshot', col.name, err?.code || err?.message)
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
