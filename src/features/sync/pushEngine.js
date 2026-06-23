import { getFirebase } from '../../lib/firebase'
import { db } from '../../db/db'
import { syncConfig } from './syncService'
import { SYNC_COLLECTIONS, LOCAL_CONFIG_KEYS, syncTs } from './collections'

// ---------------------------------------------------------------------------
// Fase 4 - Bloque 23: motor de SUBIDA (push).
//
// Por cada coleccion mantenemos un cursor (marca de agua) en `syncState`:
// solo se suben los registros cuya marca de sync supera el cursor. Como las
// colecciones inmutables nunca cambian (se suben una vez) y las mutables
// reescriben el doc completo, la nube siempre converge (ultima escritura gana).
//
// No esperamos la confirmacion del servidor: Firestore guarda la escritura en
// su cache persistente y la entrega sola al reconectar. Por eso avanzamos el
// cursor en cuanto encolamos (si esperaramos, sin internet quedaria colgado).
// ---------------------------------------------------------------------------

const BATCH = 400 // limite Firestore: 500 ops por lote
const cursorKey = (name) => `push:${name}`

async function getCursor(name) {
  const row = await db.syncState.get(cursorKey(name))
  return row?.value || ''
}
async function setCursor(name, value) {
  await db.syncState.put({ key: cursorKey(name), value })
}

// Quita undefined (Firestore no lo admite) serializando a JSON plano.
function toCloud(rec) {
  return JSON.parse(JSON.stringify(rec))
}

export async function pushChanges() {
  if (!(await syncConfig.isEnabled())) return { queued: 0, skipped: 'disabled' }
  const businessId = await syncConfig.businessId()
  if (!businessId) return { queued: 0, skipped: 'no-business' }

  const { db: fs, auth } = await getFirebase()
  if (!auth.currentUser) return { queued: 0, skipped: 'no-auth' }
  const { doc, writeBatch } = await import('firebase/firestore')

  let queued = 0
  for (const col of SYNC_COLLECTIONS) {
    const table = db[col.name]
    if (!table) continue

    const cursor = await getCursor(col.name)
    let rows = await table.toArray()
    if (col.name === 'config') rows = rows.filter((r) => !LOCAL_CONFIG_KEYS.has(r.key))

    const changed = rows
      .map((r) => ({ r, ts: syncTs(r) }))
      .filter((x) => x.ts && x.ts > cursor)
      .sort((a, b) => (a.ts < b.ts ? -1 : 1))
    if (!changed.length) continue

    let maxTs = cursor
    for (let i = 0; i < changed.length; i += BATCH) {
      const slice = changed.slice(i, i + BATCH)
      const batch = writeBatch(fs)
      for (const { r, ts } of slice) {
        const id = String(r[col.pk])
        batch.set(doc(fs, 'businesses', businessId, col.name, id), toCloud(r))
        if (ts > maxTs) maxTs = ts
      }
      // Encolar sin bloquear: durabilidad local garantizada por Firestore.
      batch.commit().catch((e) => console.warn('[sync] push', col.name, e?.code || e?.message))
      queued += slice.length
    }
    await setCursor(col.name, maxTs)
  }
  return { queued }
}
