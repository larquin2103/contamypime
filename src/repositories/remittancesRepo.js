import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { REMITTANCE_STATUS, CUSTODY_MOVEMENT_TYPES, REMESA_CENTRAL, DELIVERY_RESULT, ROLES } from '../db/constants'
import { custodyRepo } from './custodyRepo'
import { deliveriesRepo } from './deliveriesRepo'

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
      if (!r) throw new Error('Entrega no encontrada')
      if (!EDITABLE_STATUSES.has(r.status)) {
        throw new Error('La entrega ya no se puede editar (solo antes del pago)')
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
    await db.transaction('rw', db.remittances, db.auditEvents, db.custodyMovements, async () => {
      const r = await db.remittances.get(id)
      if (!r) throw new Error('Entrega no encontrada')
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
      // Ingreso a la CAJA CENTRAL de custodia al marcar PAGADA: el efectivo del
      // remitente entra al negocio. Id DETERMINISTA (custody:intake:<remesa>) e
      // idempotente (solo si aun no existe): re-marcar, o una doble llegada offline
      // desde dos dispositivos, NO duplica el ingreso (ambos generan el MISMO doc y
      // la sync lo fusiona por id). Dentro de ESTA misma transaccion (atomico con el
      // estado). El resto de transiciones no mueven efectivo (identico a antes).
      if (toStatus === REMITTANCE_STATUS.PAID) {
        const intakeId = `custody:intake:${id}`
        const already = await db.custodyMovements.get(intakeId)
        if (!already) {
          await custodyRepo.addMovementRaw({
            id: intakeId,
            holder: REMESA_CENTRAL,
            direction: 'credit',
            amount: r.amount,
            currency: r.currency,
            type: CUSTODY_MOVEMENT_TYPES.INTAKE,
            refType: 'remittance',
            refId: id,
            byUserId: actorId,
            createdAt: ts
          })
        }
      }
    })
  },

  // Asigna una remesa con FONDOS DISPONIBLES a un mensajero: mueve el efectivo de
  // la caja central a la custodia del mensajero (neto cero, como un traspaso
  // almacen->area) y pasa la remesa a ASIGNADA. Atomico y auditado. Ids
  // deterministas -> re-asignar o una doble llegada offline NO duplica el efectivo
  // (el dinero se conserva; en el raro caso de dos asignaciones simultaneas a
  // mensajeros distintos, la sync converge por LWW y queda para revisar, como los
  // turnos duplicados). Solo desde FONDOS DISPONIBLES.
  async assign(id, courierId, { actorId = null } = {}) {
    if (!courierId) throw new Error('Falta el mensajero')
    const ts = now()
    await db.transaction('rw', db.remittances, db.custodyMovements, db.auditEvents, db.users, async () => {
      const r = await db.remittances.get(id)
      if (!r) throw new Error('Entrega no encontrada')
      if (r.status !== REMITTANCE_STATUS.FUNDS_AVAILABLE) {
        throw new Error('Solo se asigna una entrega con fondos disponibles')
      }
      const courier = await db.users.get(courierId)
      if (!courier || courier.role !== ROLES.COURIER || !courier.active) {
        throw new Error('El mensajero no es valido')
      }
      const outId = `custody:assign-out:${id}`
      if (!(await db.custodyMovements.get(outId))) {
        await custodyRepo.addMovementRaw({
          id: outId, holder: REMESA_CENTRAL, direction: 'debit',
          amount: r.amount, currency: r.currency, type: CUSTODY_MOVEMENT_TYPES.ASSIGN,
          refType: 'remittance', refId: id, byUserId: actorId, createdAt: ts
        })
      }
      const inId = `custody:assign-in:${id}`
      if (!(await db.custodyMovements.get(inId))) {
        await custodyRepo.addMovementRaw({
          id: inId, holder: courierId, direction: 'credit',
          amount: r.amount, currency: r.currency, type: CUSTODY_MOVEMENT_TYPES.ASSIGN,
          refType: 'remittance', refId: id, byUserId: actorId, createdAt: ts
        })
      }
      await db.remittances.update(id, {
        assignedCourierId: courierId, status: REMITTANCE_STATUS.ASSIGNED, updatedAt: ts
      })
      await db.auditEvents.add({
        id: newId(), entity: 'remittance', entityId: id, action: 'assign',
        courierId, toStatus: REMITTANCE_STATUS.ASSIGNED, userId: actorId, createdAt: ts
      })
    })
  },

  // Entrega al beneficiario: DEBITA la custodia del mensajero asignado (el efectivo
  // sale a manos del beneficiario), registra la entrega (append-only, con
  // comprobante opcional) y pasa la remesa a ENTREGADA. Atomico, auditado,
  // idempotente por ids deterministas. Solo desde ASIGNADA / EN RUTA.
  async deliver(id, { proofDataUrl = '', note = '', actorId = null } = {}) {
    const ts = now()
    await db.transaction('rw', db.remittances, db.custodyMovements, db.deliveries, db.auditEvents, async () => {
      const r = await db.remittances.get(id)
      if (!r) throw new Error('Entrega no encontrada')
      if (r.status !== REMITTANCE_STATUS.ASSIGNED && r.status !== REMITTANCE_STATUS.IN_ROUTE) {
        throw new Error('Solo se puede entregar una entrega asignada')
      }
      if (!r.assignedCourierId) throw new Error('La entrega no tiene mensajero asignado')
      const movId = `custody:deliver:${id}`
      if (!(await db.custodyMovements.get(movId))) {
        await custodyRepo.addMovementRaw({
          id: movId, holder: r.assignedCourierId, direction: 'debit',
          amount: r.amount, currency: r.currency, type: CUSTODY_MOVEMENT_TYPES.DELIVER,
          refType: 'remittance', refId: id, byUserId: actorId, createdAt: ts
        })
      }
      const delId = `delivery:${id}`
      if (!(await db.deliveries.get(delId))) {
        await deliveriesRepo.addRaw({
          id: delId, remittanceId: id, courierId: r.assignedCourierId,
          result: DELIVERY_RESULT.DELIVERED, proofDataUrl, note, byUserId: actorId, createdAt: ts
        })
      }
      await db.remittances.update(id, { status: REMITTANCE_STATUS.DELIVERED, updatedAt: ts })
      await db.auditEvents.add({
        id: newId(), entity: 'remittance', entityId: id, action: 'deliver',
        courierId: r.assignedCourierId, toStatus: REMITTANCE_STATUS.DELIVERED, userId: actorId, createdAt: ts
      })
    })
  },

  // Entrega fallida: se DEVUELVE el efectivo. Debita la custodia del mensajero y lo
  // reintegra a la caja central; registra la entrega FALLIDA (append-only) y pasa
  // la remesa a DEVUELTA. Asi el efectivo del mensajero nunca queda sin resolver.
  // Atomico, auditado, idempotente. Solo desde ASIGNADA / EN RUTA.
  async failReturn(id, { note = '', actorId = null } = {}) {
    const ts = now()
    await db.transaction('rw', db.remittances, db.custodyMovements, db.deliveries, db.auditEvents, async () => {
      const r = await db.remittances.get(id)
      if (!r) throw new Error('Entrega no encontrada')
      if (r.status !== REMITTANCE_STATUS.ASSIGNED && r.status !== REMITTANCE_STATUS.IN_ROUTE) {
        throw new Error('Solo se devuelve una entrega asignada')
      }
      if (!r.assignedCourierId) throw new Error('La entrega no tiene mensajero asignado')
      const outId = `custody:return-out:${id}`
      if (!(await db.custodyMovements.get(outId))) {
        await custodyRepo.addMovementRaw({
          id: outId, holder: r.assignedCourierId, direction: 'debit',
          amount: r.amount, currency: r.currency, type: CUSTODY_MOVEMENT_TYPES.RETURN,
          refType: 'remittance', refId: id, byUserId: actorId, createdAt: ts
        })
      }
      const inId = `custody:return-in:${id}`
      if (!(await db.custodyMovements.get(inId))) {
        await custodyRepo.addMovementRaw({
          id: inId, holder: REMESA_CENTRAL, direction: 'credit',
          amount: r.amount, currency: r.currency, type: CUSTODY_MOVEMENT_TYPES.RETURN,
          refType: 'remittance', refId: id, byUserId: actorId, createdAt: ts
        })
      }
      const delId = `delivery:${id}`
      if (!(await db.deliveries.get(delId))) {
        await deliveriesRepo.addRaw({
          id: delId, remittanceId: id, courierId: r.assignedCourierId,
          result: DELIVERY_RESULT.FAILED, note, byUserId: actorId, createdAt: ts
        })
      }
      await db.remittances.update(id, { status: REMITTANCE_STATUS.RETURNED, updatedAt: ts })
      await db.auditEvents.add({
        id: newId(), entity: 'remittance', entityId: id, action: 'fail_return',
        courierId: r.assignedCourierId, toStatus: REMITTANCE_STATUS.RETURNED, userId: actorId, createdAt: ts
      })
    })
  }
}
