import { db } from '../db/db'
import { now } from '../lib/dates'
import { DEFAULT_SEMAPHORE_CONFIG } from '../db/constants'

// Acceso a la configuracion (almacen key-value).
export const configRepo = {
  async get(key, fallback = null) {
    const row = await db.config.get(key)
    return row ? row.value : fallback
  },

  async set(key, value) {
    await db.config.put({ key, value, updatedAt: now() })
  },

  async all() {
    return db.config.toArray()
  },

  async getBaseCurrency() {
    return this.get('baseCurrency', 'MN')
  },

  async getSemaphoreConfig() {
    return this.get('semaphore', DEFAULT_SEMAPHORE_CONFIG)
  }
}
