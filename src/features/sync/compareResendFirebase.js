import { db } from '../../db/db'
import { syncConfig } from './syncService'
import { getFirebase } from '../../lib/firebase'
import { logSyncEvent } from '../../lib/syncLog'
import { createCompareResender } from './compareResendEngine'

// Conexion REAL del reenvio que compara (spec 2026-09-23): Dexie para lo local y
// una transaccion de Firestore por documento (lee del SERVIDOR, compara y escribe
// atomicamente; si otro aparato escribe entre medias, Firestore la repite).
// Firebase se carga con import() dinamico, como en toda la app.
let cached = null

async function ready() {
  if (!(await syncConfig.isEnabled())) return 'La sincronización no está activa en este aparato'
  if (!(await syncConfig.businessId())) return 'Este aparato no tiene un negocio vinculado a la nube'
  const { auth } = await getFirebase()
  if (!auth.currentUser) return 'No hay sesión abierta con la nube en este aparato'
  return null
}

async function runTx(name, id, fn) {
  const { db: fs } = await getFirebase()
  const businessId = await syncConfig.businessId()
  const { doc, runTransaction } = await import('firebase/firestore')
  const ref = doc(fs, 'businesses', businessId, name, id)
  return runTransaction(fs, async (tx) => {
    const snap = await tx.get(ref)
    const r = await fn(snap.exists() ? snap.data() : null)
    if (r.write) tx.set(ref, r.write)
    return r.decision
  })
}

function resender() {
  if (!cached) {
    cached = createCompareResender({
      listLocal: (name) => db[name].toArray(),
      getLocal: (name, id) => db[name].get(id),
      pkOf: () => 'id',
      ready,
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
      runTx,
      log: logSyncEvent
    })
  }
  return cached
}

export const countCompareResend = (name, sinceIso) => resender().count(name, sinceIso)
export const compareResend = (name, sinceIso, opts) => resender().run(name, sinceIso, opts)
