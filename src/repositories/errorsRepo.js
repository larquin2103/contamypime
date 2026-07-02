import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'

// Bloque 33 - Registro local de errores (diagnostico). Append-only y LOCAL de
// este dispositivo: no se sincroniza ni viaja en respaldos. Para que no crezca
// sin limite se conserva solo la cola mas reciente (es diagnostico, no
// contabilidad: aqui si se puede podar).
const MAX_ENTRIES = 200

export const errorsRepo = {
  // Guarda un error. Nunca lanza: el registro jamas debe tumbar la app.
  async add({ source, message, stack = '', route = '', appVersion = '' }) {
    try {
      await db.errorLog.add({
        id: newId(),
        source,                      // 'window' | 'promise' | 'react'
        message: String(message || 'Error desconocido').slice(0, 500),
        stack: String(stack || '').slice(0, 2000),
        route,
        appVersion,
        userAgent: navigator.userAgent,
        createdAt: now()
      })
      // Poda: conserva las MAX_ENTRIES mas recientes.
      const total = await db.errorLog.count()
      if (total > MAX_ENTRIES) {
        const extra = await db.errorLog.orderBy('createdAt').limit(total - MAX_ENTRIES).primaryKeys()
        await db.errorLog.bulkDelete(extra)
      }
    } catch { /* sin almacenamiento disponible: se pierde el registro, no la app */ }
  },

  // Ultimos errores, del mas reciente al mas viejo.
  async listRecent(limit = 50) {
    return db.errorLog.orderBy('createdAt').reverse().limit(limit).toArray()
  },

  async count() {
    return db.errorLog.count()
  },

  // Vaciar el registro (accion explicita del dueño desde la pantalla).
  async clear() {
    return db.errorLog.clear()
  }
}
