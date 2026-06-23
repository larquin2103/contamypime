import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { hashPin, verifyPin, normalizeRecoveryCode } from '../lib/pin'
import { ROLES } from '../db/constants'

// Usuarios y autenticacion por PIN.
export const usersRepo = {
  async count() {
    return db.users.count()
  },

  async list() {
    return db.users.toArray()
  },

  // Usuarios activos (para la pantalla de login).
  async listActive() {
    const all = await db.users.toArray()
    return all.filter((u) => u.active)
  },

  async get(id) {
    return db.users.get(id)
  },

  async create({ name, role = ROLES.SELLER, pin }) {
    const { hash, salt } = await hashPin(pin)
    const id = newId()
    const ts = now()
    await db.users.add({
      id,
      name: name.trim(),
      role,
      pinHash: hash,
      pinSalt: salt,
      active: true,
      createdAt: ts,
      updatedAt: ts
    })
    return id
  },

  async setPin(id, pin) {
    const { hash, salt } = await hashPin(pin)
    await db.users.update(id, { pinHash: hash, pinSalt: salt, updatedAt: now() })
  },

  // Borrado logico: nunca se elimina un usuario (auditoria).
  async setActive(id, active) {
    await db.users.update(id, { active, updatedAt: now() })
  },

  // Devuelve el usuario si el PIN coincide y esta activo; si no, null.
  async verifyLogin(id, pin) {
    const user = await db.users.get(id)
    if (!user || !user.active) return null
    const ok = await verifyPin(pin, user.pinSalt, user.pinHash)
    return ok ? user : null
  },

  async getOwner() {
    const all = await db.users.toArray()
    return all.find((u) => u.role === ROLES.OWNER) || null
  },

  // --- Codigo de recuperacion (solo para el dueño) ---
  async setRecoveryCode(id, code) {
    const { hash, salt } = await hashPin(normalizeRecoveryCode(code))
    await db.users.update(id, { recoveryHash: hash, recoverySalt: salt, updatedAt: now() })
  },

  async verifyRecovery(id, code) {
    const u = await db.users.get(id)
    if (!u || !u.recoveryHash) return false
    return verifyPin(normalizeRecoveryCode(code), u.recoverySalt, u.recoveryHash)
  }
}
