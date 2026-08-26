import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { REMITTANCE_STATUS, PAYMENT_MODE, CUSTODY_MOVEMENT_TYPES, REMESA_CENTRAL, DELIVERY_RESULT, ROLES } from '../db/constants'
import { custodyRepo } from './custodyRepo'
import { deliveriesRepo } from './deliveriesRepo'
import { addAccountMovementRaw } from './accountsRepo'

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
  async create({ amount, currency = 'MN', sender = {}, beneficiary = {}, fee = 0, note = '', paymentMode = PAYMENT_MODE.UPFRONT, createdBy = null }) {
    const amt = round2(Number(amount) || 0)
    if (amt <= 0) throw new Error('El monto debe ser mayor que cero')
    const s = cleanParty(sender)
    const b = cleanParty(beneficiary)
    if (!s.name) throw new Error('El nombre del remitente es obligatorio')
    if (!b.name) throw new Error('El nombre del beneficiario es obligatorio')
    // Modo de cobro: solo dos validos; cualquier otro cae al clasico (anticipado).
    const mode = paymentMode === PAYMENT_MODE.ON_CREDIT ? PAYMENT_MODE.ON_CREDIT : PAYMENT_MODE.UPFRONT
    const id = newId()
    const ts = now()
    await db.transaction('rw', db.remittances, db.auditEvents, async () => {
      await db.remittances.add({
        id,
        status: REMITTANCE_STATUS.CREATED,
        amount: amt,
        currency,
        fee: round2(Number(fee) || 0),
        paymentMode: mode,
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
      if (fields.paymentMode != null) {
        patch.paymentMode = fields.paymentMode === PAYMENT_MODE.ON_CREDIT ? PAYMENT_MODE.ON_CREDIT : PAYMENT_MODE.UPFRONT
      }
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
      // SOLO cobro anticipado (clasico): en "contra entrega" el remitente paga
      // DESPUES (entra por el cobro a la cuenta), asi que no hay ingreso a custodia.
      if (toStatus === REMITTANCE_STATUS.PAID && r.paymentMode !== PAYMENT_MODE.ON_CREDIT) {
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
      // Custodia SOLO en cobro anticipado (clasico): el efectivo del negocio pasa de
      // la caja central al mensajero (neto cero). En "contra entrega" el efectivo que
      // reparte el mensajero es su FONDO (F4), no se mueve aqui; el dinero entra luego
      // por el cobro a la cuenta. El modo clasico queda IDENTICO.
      if (r.paymentMode !== PAYMENT_MODE.ON_CREDIT) {
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
      // Custodia SOLO en cobro anticipado: el efectivo sale de la custodia del
      // mensajero al beneficiario. En "contra entrega" ese efectivo es su fondo (F4);
      // aqui solo queda la constancia de la entrega. El modo clasico queda IDENTICO.
      if (r.paymentMode !== PAYMENT_MODE.ON_CREDIT) {
        const movId = `custody:deliver:${id}`
        if (!(await db.custodyMovements.get(movId))) {
          await custodyRepo.addMovementRaw({
            id: movId, holder: r.assignedCourierId, direction: 'debit',
            amount: r.amount, currency: r.currency, type: CUSTODY_MOVEMENT_TYPES.DELIVER,
            refType: 'remittance', refId: id, byUserId: actorId, createdAt: ts
          })
        }
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
      // Custodia SOLO en cobro anticipado: se devuelve el efectivo del mensajero a la
      // caja central. En "contra entrega" no hubo movimiento de custodia que devolver
      // (el efectivo es el fondo del mensajero, F4); solo queda la constancia fallida.
      if (r.paymentMode !== PAYMENT_MODE.ON_CREDIT) {
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
  },

  // Registra el COBRO al remitente de una entrega CONTRA ENTREGA ya entregada: acredita
  // la CUENTA de tesoreria elegida (modulo 'cuentas') con el monto recibido y marca la
  // entrega como cobrada (collectedAt) -> sale de "por cobrar". Deja un snapshot
  // append-only en `collections` (comprobante y pagador). Es un dinero DISTINTO del
  // fondo del mensajero (la custodia): aqui entra el REEMBOLSO del remitente al negocio.
  // Reusa el MISMO helper que ventas y terceros (addAccountMovementRaw, concepto
  // 'entrega'): no toca ninguna ruta de dinero existente, solo agrega un ingreso.
  // Todo en UNA transaccion; idempotente por id determinista (dos dispositivos que
  // cobren la misma entrega generan el MISMO doc y la sync no duplica). Sin licencia
  // 'cuentas' (accountId nulo) se marca cobrada SIN acreditar cuenta (degradacion: se
  // puede regularizar luego con el ajuste manual de tesoreria).
  async collect(id, { accountId = null, amount = null, currency = null, payerName = '', proofDataUrl = '', note = '', actorId = null } = {}) {
    const ts = now()
    await db.transaction('rw', db.remittances, db.collections, db.accounts, db.accountMovements, db.auditEvents, async () => {
      const r = await db.remittances.get(id)
      if (!r) throw new Error('Entrega no encontrada')
      if (r.paymentMode !== PAYMENT_MODE.ON_CREDIT) throw new Error('Solo se cobra una entrega contra entrega')
      if (r.status !== REMITTANCE_STATUS.DELIVERED) throw new Error('Solo se cobra una entrega ya entregada')
      if (r.collectedAt) return // ya cobrada: idempotente, no duplica

      // Cuenta destino (si hay modulo 'cuentas'): valida y fija la moneda del cobro.
      let acc = null
      if (accountId) {
        acc = await db.accounts.get(accountId)
        if (!acc) throw new Error('Cuenta de tesoreria no encontrada')
      }
      const cur = acc ? acc.currency : (currency || r.currency || 'MN')
      const amt = round2(Number(amount != null ? amount : r.amount) || 0)
      if (amt <= 0) throw new Error('El monto del cobro debe ser mayor que cero')

      // Snapshot append-only del cobro (id determinista -> no duplica entre dispositivos).
      const colId = `collection:${id}`
      if (!(await db.collections.get(colId))) {
        await db.collections.add({
          id: colId,
          remittanceId: id,
          accountId: acc ? accountId : null,
          amount: amt,
          currency: cur,
          payerName: String(payerName || '').trim(),
          proofDataUrl: proofDataUrl || '',
          note: String(note || '').trim(),
          byUserId: actorId,
          createdAt: ts
        })
      }

      // Acredita la cuenta de tesoreria elegida (mismo helper que ventas/terceros),
      // con id determinista propio para que no se duplique el ingreso.
      if (acc) {
        const movId = `acctmov:collect:${id}`
        if (!(await db.accountMovements.get(movId))) {
          await addAccountMovementRaw({
            id: movId,
            accountId,
            direction: 'credit',
            amount: amt,
            currency: acc.currency,
            refType: 'remittance',
            concept: 'entrega',
            refId: id,
            note: String(payerName || note || '').trim(),
            userId: actorId,
            createdAt: ts
          })
        }
      }

      // Marca la entrega como cobrada -> deja de contar como "por cobrar".
      await db.remittances.update(id, {
        collectedAt: ts,
        collectedAccountId: acc ? accountId : null,
        collectedAmount: amt,
        collectedCurrency: cur,
        updatedAt: ts
      })
      await db.auditEvents.add({
        id: newId(), entity: 'remittance', entityId: id, action: 'collect',
        amount: amt, currency: cur, accountId: acc ? accountId : null,
        userId: actorId, createdAt: ts
      })
    })
  }
}
