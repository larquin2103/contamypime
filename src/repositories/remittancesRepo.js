import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { REMITTANCE_STATUS } from '../db/constants'

// Remesas (modulo 'remesas') — CABECERA de la orden. Capa NUEVA y AISLADA: solo
// escribe `remittances` y deja constancia en `auditEvents` (que ya sincroniza).
// NO toca ventas, caja, inventario ni tesoreria; la CUSTODIA de efectivo y la
// asignacion a mensajeros llegan en fases posteriores con su propio libro.
//
// Disciplina del proyecto (append-only): nada se borra —cancelar es un ESTADO—;
// el remitente/beneficiario/monto se CONGELAN al crear (snapshot, como el precio
// de una venta) y la cabecera solo se edita ANTES del pago. Toda mutacion
// actualiza `updatedAt` (la sincronizacion es "ultima escritura gana" por marca
// de tiempo) y registra un evento en auditoria.

// Estados en los que la cabecera aun puede corregirse (antes de cobrar).
const EDITABLE_STATUSES = new Set([REMITTANCE_STATUS.CREATED])

// Normaliza los datos de una parte (remitente/beneficiario): cadenas recortadas.
function cleanParty(p = {}) {
  return {
    name: String(p.name || '').trim(),
    phone: String(p.phone || '').trim(),
    idDoc: String(p.idDoc || '').trim(),
    address: String(p.address || '').trim()
  }
}

export const remittancesRepo = {
  async list() {
    const rows = await db.remittances.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async get(id) {
    return db.remittances.get(id)
  },

  // Crea la orden. Congela remitente/beneficiario/monto (snapshot). Estado inicial
  // CREATED. Todo en una transaccion junto al evento de auditoria.
  async create({ amount, currency = 'MN', sender = {}, beneficiary = {}, fee = 0, note = '', createdBy = null }) {
    const amt = round2(Number(amount) || 0)
    if (amt <= 0) throw new Error('El monto debe ser mayor que cero')
    const s = cleanParty(sender)
    const b = cleanParty(beneficiary)
    if (!s.name) throw new Error('El nombre del remitente es obligatorio')
    if (!b.name) throw new Error('El nombre del beneficiario es obligatorio')
    const id = newId()
    const ts = now()
    await db.transaction('rw', db.remittances, db.auditEvents, async () => {
      await db.remittances.add({
        id,
        status: REMITTANCE_STATUS.CREATED,
        amount: amt,
        currency,
        fee: round2(Number(fee) || 0),
        sender: s,
        beneficiary: b,
        // Se asignara a un mensajero en una fase posterior (con el libro de custodia).
        assignedCourierId: null,
        note: String(note || '').trim(),
        createdBy,
        createdAt: ts,
        updatedAt: ts
      })
      await db.auditEvents.add({
        id: newId(),
        entity: 'remittance',
        entityId: id,
        action: 'create',
        amount: amt,
        currency,
        toStatus: REMITTANCE_STATUS.CREATED,
        userId: createdBy,
        createdAt: ts
      })
    })
    return id
  },

  // Corrige la cabecera SOLO mientras esta en CREATED (antes del pago). Despues del
  // cobro queda congelada. Actualiza updatedAt y audita el cambio.
  async update(id, fields = {}, { actorId = null } = {}) {
    const ts = now()
    await db.transaction('rw', db.remittances, db.auditEvents, async () => {
      const r = await db.remittances.get(id)
      if (!r) throw new Error('Remesa no encontrada')
      if (!EDITABLE_STATUSES.has(r.status)) {
        throw new Error('La remesa ya no se puede editar (solo antes del pago)')
      }
      const patch = { updatedAt: ts }
      if (fields.amount != null) {
        const amt = round2(Number(fields.amount) || 0)
        if (amt <= 0) throw new Error('El monto debe ser mayor que cero')
        patch.amount = amt
      }
      if (fields.currency != null) patch.currency = fields.currency
      if (fields.fee != null) patch.fee = round2(Number(fields.fee) || 0)
      if (fields.note != null) patch.note = String(fields.note).trim()
      if (fields.sender != null) {
        const s = cleanParty(fields.sender)
        if (!s.name) throw new Error('El nombre del remitente es obligatorio')
        patch.sender = s
      }
      if (fields.beneficiary != null) {
        const b = cleanParty(fields.beneficiary)
        if (!b.name) throw new Error('El nombre del beneficiario es obligatorio')
        patch.beneficiary = b
      }
      await db.remittances.update(id, patch)
      await db.auditEvents.add({
        id: newId(),
        entity: 'remittance',
        entityId: id,
        action: 'edit',
        userId: actorId,
        createdAt: ts
      })
    })
  },

  // Avanza el estado (append-only, auditado). No mueve dinero: solo etiqueta la
  // etapa y deja el rastro. Las transiciones que mueven efectivo (asignacion en
  // adelante) se cablearan con el libro de custodia en su fase; la UI de esta fase
  // solo expone las etapas PREVIAS a la custodia (pago/validacion) y la cancelacion.
  async setStatus(id, toStatus, { actorId = null, note = '' } = {}) {
    if (!Object.values(REMITTANCE_STATUS).includes(toStatus)) throw new Error('Estado no valido')
    const ts = now()
    await db.transaction('rw', db.remittances, db.auditEvents, async () => {
      const r = await db.remittances.get(id)
      if (!r) throw new Error('Remesa no encontrada')
      if (r.status === toStatus) return // sin cambios: no se audita
      const fromStatus = r.status
      await db.remittances.update(id, { status: toStatus, updatedAt: ts })
      await db.auditEvents.add({
        id: newId(),
        entity: 'remittance',
        entityId: id,
        action: 'status_change',
        fromStatus,
        toStatus,
        userId: actorId,
        note: String(note || '').trim(),
        createdAt: ts
      })
    })
  }
}
