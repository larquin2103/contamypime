import { db } from '../db/db'
import { now } from '../lib/dates'
import { DEFAULT_SEMAPHORE_CONFIG, DEFAULT_DENOMINATIONS } from '../db/constants'
import { normalizeUnits, cleanUnits, activeUnits, hasActive } from '../lib/unitsConfig'

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

  // Mesas por area (modulo 'mesas'). Mapa { area: ['Mesa 1', 'Mesa 2', ...] }.
  // Vacio = el area no usa mesas (venta directa clasica). Quitar una mesa de la
  // lista NO borra sus pedidos ni ventas (append-only): solo deja de ofrecerse.
  async getTables() {
    const map = await this.get('tables', {})
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {}
  },

  // Mesas de UN area concreta (lista de nombres, sin duplicados).
  async getTablesFor(area) {
    const map = await this.getTables()
    const list = map[String(area || '').trim()]
    return Array.isArray(list) ? list : []
  },

  async setTablesFor(area, list) {
    const key = String(area || '').trim()
    if (!key) return []
    const clean = (Array.isArray(list) ? list : [])
      .map((s) => String(s).trim())
      .filter(Boolean)
    const seen = new Set()
    const uniq = []
    for (const t of clean) {
      const k = t.toLowerCase()
      if (!seen.has(k)) { seen.add(k); uniq.push(t) }
    }
    const map = await this.getTables()
    await this.set('tables', { ...map, [key]: uniq })
    return uniq
  },

  // Cargo por servicio por AREA (modulo 'mesas'): % que se suma al total de la
  // cuenta. Mapa { area: porcentaje }. 0 o ausente = sin cargo (clasico).
  async getServiceCharges() {
    const map = await this.get('serviceCharge', {})
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {}
  },

  async getServiceChargeFor(area) {
    const map = await this.getServiceCharges()
    const pct = Number(map[String(area || '').trim()])
    return Number.isFinite(pct) && pct > 0 ? pct : 0
  },

  async setServiceChargeFor(area, pct) {
    const key = String(area || '').trim()
    if (!key) return 0
    const n = Math.max(0, Math.min(100, Number(pct) || 0))
    const map = await this.getServiceCharges()
    await this.set('serviceCharge', { ...map, [key]: n })
    return n
  },

  // --- U1: unidades de medida configurables (solo el dueño las gestiona) -------
  // Clave AUSENTE = las 8 de fabrica, asi que un negocio que no las toque se
  // comporta exactamente como hoy: ni migracion ni cambio visible. La lista viaja
  // por la sincronizacion como cualquier otra clave de `config`.
  async getUnits() {
    const list = await this.get('units', null)
    return normalizeUnits(list) // repara lo que llegue roto (ver lib/units)
  },

  // Las que se ofrecen en un desplegable: activas y en orden alfabetico.
  async getActiveUnits() {
    return activeUnits(await this.get('units', null))
  },

  // Guarda la lista. RECHAZA dejar el negocio sin ninguna unidad activa: sin eso el
  // alta de producto se quedaria sin una sola opcion.
  //
  // Usa `cleanUnits` y NO `normalizeUnits` a proposito: la segunda REPARA el
  // invariante, asi que comprobar sobre ella haria que este rechazo no saltara jamas
  // -se caza en las pruebas- y el dueño veria una unidad reactivarse sola, sin
  // mensaje. El que escribe mira lo que le dieron; el que lee repara.
  async setUnits(list) {
    const clean = cleanUnits(list)
    if (!hasActive(clean)) throw new Error('Debe quedar al menos una unidad activa')
    await this.set('units', clean)
    return clean
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
