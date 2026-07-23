import { db } from '../db/db'
import { now } from '../lib/dates'
import { DEFAULT_SEMAPHORE_CONFIG, DEFAULT_DENOMINATIONS } from '../db/constants'

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
  },

  async getDenominations() {
    return this.get('denominations', DEFAULT_DENOMINATIONS)
  },

  // Areas de venta del punto (Fase 6 - Bloque 19). Lista de nombres definida
  // por el dueño. Vacia = un solo punto sin areas (comportamiento clasico).
  async getAreas() {
    const list = await this.get('areas', [])
    return Array.isArray(list) ? list : []
  },

  // Centro de elaboracion (modulo 'elaboracion'). `enabled` lo activa el dueño en
  // Ajustes (solo visible con el modulo); `name` es el nombre visible editable.
  // Sin el modulo, `enabled` queda en false y nada de elaboracion aparece.
  async getElaboration() {
    const enabled = await this.get('elaborationEnabled', false)
    const name = await this.get('elaborationName', 'Elaboración')
    return { enabled: !!enabled, name: String(name || 'Elaboración').trim() || 'Elaboración' }
  },

  async setAreas(list) {
    const clean = (Array.isArray(list) ? list : [])
      .map((s) => String(s).trim())
      .filter(Boolean)
    // Sin duplicados, conservando el orden de aparicion.
    const seen = new Set()
    const uniq = []
    for (const a of clean) {
      const key = a.toLowerCase()
      if (!seen.has(key)) { seen.add(key); uniq.push(a) }
    }
    await this.set('areas', uniq)
    return uniq
  }
}
