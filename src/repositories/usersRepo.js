import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { hashPin, verifyPin, normalizeRecoveryCode } from '../lib/pin'
import { ROLES } from '../db/constants'

// Roles OPERATIVOS a los que se puede mover un usuario (Fase 8 - B2). El DUEÑO
// queda fuera a propósito: su rol es la identidad del negocio (uid = businessId,
// licencia, código de recuperación) y ni se cambia ni se asigna a nadie.
const ASSIGNABLE_ROLES = [ROLES.SELLER, ROLES.ADMIN, ROLES.ELABORATION]

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

  // Renombra un usuario (Fase 8 - B2). El nombre es solo etiqueta: NO es la
  // identidad del negocio (esa es el uid/businessId), por eso se puede cambiar a
  // cualquiera, incluido el dueño. Actualiza updatedAt para que sincronice.
  async setName(id, name) {
    const clean = String(name || '').trim()
    if (!clean) throw new Error('El nombre no puede estar vacío')
    await db.users.update(id, { name: clean, updatedAt: now() })
  },

  // Borrado logico: nunca se elimina un usuario (auditoria).
  async setActive(id, active) {
    await db.users.update(id, { active, updatedAt: now() })
  },

  // Cambia el rol de un usuario (Fase 8 - B2). Solo lo invoca la pantalla de
  // Usuarios (dueño). Las REGLAS DURAS viven aqui, en la capa de datos, no solo
  // en la UI: el rol de DUEÑO nunca se cambia ni se asigna, y solo se permite
  // mover entre roles operativos. Escribe rol + updatedAt y deja constancia
  // INMUTABLE en auditEvents (rol anterior -> nuevo). Todo en una transaccion;
  // sincroniza como cualquier cambio (users y auditEvents estan en SYNC_COLLECTIONS).
  // El gate del modulo 'elaboracion' se aplica en la UI (igual que en el alta).
  async setRole(id, newRole, { actorId = null, note = '' } = {}) {
    if (!ASSIGNABLE_ROLES.includes(newRole)) throw new Error('Rol no válido')
    const ts = now()
    await db.transaction('rw', db.users, db.auditEvents, async () => {
      const u = await db.users.get(id)
      if (!u) throw new Error('Usuario no encontrado')
      if (u.role === ROLES.OWNER) throw new Error('El rol de dueño no se puede cambiar')
      if (u.role === newRole) return // sin cambios: no se toca nada ni se audita
      await db.users.update(id, { role: newRole, updatedAt: ts })
      await db.auditEvents.add({
        id: newId(),
        entity: 'user',
        entityId: id,
        action: 'role_change',
        name: u.name,
        fromRole: u.role,
        toRole: newRole,
        userId: actorId,
        note: String(note || '').trim(),
        createdAt: ts
      })
    })
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
    // Preferir el dueño ACTIVO: tras el alta por sync pueden quedar duplicados
    // y uno desactivado; si devolvieramos el inactivo, su PIN no autorizaria.
    return all.find((u) => u.role === ROLES.OWNER && u.active)
      || all.find((u) => u.role === ROLES.OWNER)
      || null
  },

  // Autorizacion del dueño: comprueba el PIN contra TODOS los dueños activos y
  // devuelve el que coincida (o null). Robusto ante dueños duplicados.
  async verifyOwnerPin(pin) {
    const owners = (await db.users.toArray()).filter((u) => u.role === ROLES.OWNER && u.active)
    for (const o of owners) {
      if (await verifyPin(pin, o.pinSalt, o.pinHash)) return o
    }
    return null
  },

  // Autorizacion "de mando" (Bloque 20.6): comprueba el PIN contra cualquier
  // dueño O administrativo activo. Lo usa OwnerAuthModal para que el vendedor
  // pueda ser autorizado tanto por el dueño como por un administrativo.
  async verifyManagerPin(pin) {
    const mgrs = (await db.users.toArray())
      .filter((u) => (u.role === ROLES.OWNER || u.role === ROLES.ADMIN) && u.active)
    for (const m of mgrs) {
      if (await verifyPin(pin, m.pinSalt, m.pinHash)) return m
    }
    return null
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
