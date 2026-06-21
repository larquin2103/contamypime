import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'

// Categorias de producto. Orden estable para conteo/analisis (Fase 3).
export const categoriesRepo = {
  async list() {
    const all = await db.categories.toArray()
    return all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
  },

  async create(name) {
    const id = newId()
    const ts = now()
    const count = await db.categories.count()
    await db.categories.add({
      id,
      name: name.trim(),
      order: count,
      active: true,
      createdAt: ts,
      updatedAt: ts
    })
    return id
  },

  async rename(id, name) {
    await db.categories.update(id, { name: name.trim(), updatedAt: now() })
  },

  // Baja logica (nada se borra).
  async setActive(id, active) {
    await db.categories.update(id, { active, updatedAt: now() })
  }
}
