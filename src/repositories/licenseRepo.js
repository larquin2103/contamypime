import { db } from '../db/db'
import { now } from '../lib/dates'

// Acceso a la licencia de activacion. Vive en `config` bajo 'licenseToken' y es
// una clave LOCAL de cada dispositivo (no viaja a la nube; ver collections.js):
// la compuerta debe poder operar antes de que exista cualquier sincronizacion.
const KEY = 'licenseToken'
const LAST_SEEN = 'licenseLastSeen'

export const licenseRepo = {
  async getToken() {
    const row = await db.config.get(KEY)
    return row ? row.value : null
  },

  async setToken(token) {
    await db.config.put({ key: KEY, value: String(token || '').trim(), updatedAt: now() })
  },

  async clear() {
    await db.config.delete(KEY)
  },

  // Marca de agua de fecha (anti-trampa de reloj): la mayor fecha YYYY-MM-DD que
  // la app ha visto. Solo avanza, nunca retrocede; tambien es config LOCAL.
  async getLastSeen() {
    const row = await db.config.get(LAST_SEEN)
    return row ? row.value : null
  },

  async setLastSeen(dateStr) {
    await db.config.put({ key: LAST_SEEN, value: dateStr, updatedAt: now() })
  }
}
