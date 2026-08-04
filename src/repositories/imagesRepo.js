import { db } from '../db/db'
import { now } from '../lib/dates'

// Repositorio de imagenes (Fase 8 - B3, modulo 'imagenes'). Guarda UNA miniatura
// por referencia (un producto, un usuario, un item de la carta). El acceso a
// datos va SIEMPRE por aqui (como el resto de repos), nunca tocando Dexie desde
// las pantallas.

// Id DETERMINISTA por referencia: dos dispositivos que editan la MISMA foto
// generan el MISMO doc -> la sync "ultima escritura gana" fusiona en vez de
// duplicar (igual que las cuentas de sistema con id fijo). refType agrupa por
// destino ('product' | 'user' | ...); refId es el id de esa entidad.
const imageId = (refType, refId) => `img:${refType}:${refId}`

export const imagesRepo = {
  // La miniatura de una referencia (o undefined si nunca se guardo).
  async get(refType, refId) {
    return db.images.get(imageId(refType, refId))
  },

  // dataUrl solo (o '' si no hay foto / fue quitada). Comodo para pintar.
  async getDataUrl(refType, refId) {
    const row = await db.images.get(imageId(refType, refId))
    return row?.dataUrl || ''
  },

  // Upsert append-only: siempre el mismo id, actualiza dataUrl + updatedAt (de
  // ahi depende la sync). `dataUrl` es una miniatura JPEG (ver lib/image.js).
  async set(refType, refId, dataUrl) {
    const id = imageId(refType, refId)
    await db.images.put({
      id,
      refType,
      refId: String(refId),
      dataUrl: String(dataUrl || ''),
      updatedAt: now()
    })
    return id
  },

  // "Quitar" NO borra (el delete esta prohibido por las reglas de sync): deja el
  // doc con dataUrl vacio -> los consumidores lo tratan como "sin foto".
  async clear(refType, refId) {
    return this.set(refType, refId, '')
  },

  // Mapa refId -> dataUrl de todas las imagenes de un tipo (p.ej. 'product'),
  // para pintar listas sin una consulta por fila. Solo incluye las que tienen foto.
  async mapByType(refType) {
    const rows = await db.images.where('refType').equals(refType).toArray()
    const m = new Map()
    for (const r of rows) if (r.dataUrl) m.set(r.refId, r.dataUrl)
    return m
  }
}
