import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { cleanQty } from '../lib/qty'
import {
  REMITTANCE_STATUS, PAYMENT_MODE, CUSTODY_MOVEMENT_TYPES, DELIVERY_RESULT, ROLES,
  DELIVERY_KIND, MOVEMENT_TYPES, ENTREGAS_AREA
} from '../db/constants'
import { custodyRepo } from './custodyRepo'
import { deliveriesRepo } from './deliveriesRepo'
import { productCustodyRepo } from './productCustodyRepo'
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

// Lineas de PRODUCTO de una entrega (snapshot): { productId, name, qty } con qty > 0.
function cleanItems(items = []) {
  return (items || [])
    .map((it) => ({
      productId: it.productId,
      name: String(it.name || '').trim(),
      qty: Math.abs(Number(it.qty) || 0)
    }))
    .filter((it) => it.productId && it.qty > 0)
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
  async create({ amount, currency = 'MN', sender = {}, beneficiary = {}, fee = 0, note = '', paymentMode = PAYMENT_MODE.UPFRONT, kind = DELIVERY_KIND.MONEY, items = [], createdBy = null }) {
    const isProduct = kind === DELIVERY_KIND.PRODUCT
    const amt = round2(Number(amount) || 0)
    // El monto es obligatorio en entregas de DINERO; en producto puede ser 0 (sin cobro).
    if (!isProduct && amt <= 0) throw new Error('El monto debe ser mayor que cero')
    const s = cleanParty(sender)
    const b = cleanParty(beneficiary)
    if (!s.name) throw new Error('El nombre del remitente es obligatorio')
    if (!b.name) throw new Error('El nombre del beneficiario es obligatorio')
    const lines = isProduct ? cleanItems(items) : []
    if (isProduct && lines.length === 0) throw new Error('Agrega al menos un producto que entregar')
    // Modo de cobro: producto = contra entrega (se entrega y se cobra despues si hay
    // monto). Dinero: solo dos validos; cualquier otro cae al clasico (anticipado).
    const mode = isProduct
      ? PAYMENT_MODE.ON_CREDIT
      : (paymentMode === PAYMENT_MODE.ON_CREDIT ? PAYMENT_MODE.ON_CREDIT : PAYMENT_MODE.UPFRONT)
    const id = newId()
    const ts = now()
    await db.transaction('rw', db.remittances, db.auditEvents, async () => {
      await db.remittances.add({
        id,
        status: REMITTANCE_STATUS.CREATED,
        kind: isProduct ? DELIVERY_KIND.PRODUCT : DELIVERY_KIND.MONEY,
        items: lines,
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
      if (fields.items != null) patch.items = cleanItems(fields.items)
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
      // El pago del remitente ya NO entra a la custodia: en AMBOS modos va a una
      // cuenta de tesoreria por el cobro (remittancesRepo.collect). setStatus solo
      // etiqueta la etapa; el efectivo que reparte el mensajero es su FONDO (F4).
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
    await db.transaction('rw', db.remittances, db.custodyMovements, db.auditEvents, db.users, db.stockMovements, db.products, db.productCustody, async () => {
      const r = await db.remittances.get(id)
      if (!r) throw new Error('Entrega no encontrada')
      if (r.status !== REMITTANCE_STATUS.FUNDS_AVAILABLE) {
        throw new Error('Solo se asigna una entrega con fondos disponibles')
      }
      const courier = await db.users.get(courierId)
      if (!courier || courier.role !== ROLES.COURIER || !courier.active) {
        throw new Error('El mensajero no es valido')
      }
      if (r.kind === DELIVERY_KIND.PRODUCT) {
        // CARGA de producto: valida existencia en el area "Entregas" (candado por
        // cache, como los traspasos: solo el mando la mueve), rebaja el area en el
        // libro mayor + su cache, y suma a la custodia de PRODUCTO del mensajero (libro
        // aparte, aislado del inventario). Ids deterministas -> idempotente.
        const lines = Array.isArray(r.items) ? r.items : []
        if (lines.length === 0) throw new Error('La entrega de producto no tiene productos')
        for (const it of lines) {
          const p = await db.products.get(it.productId)
          const avail = Number(p?.stockByLocation?.[ENTREGAS_AREA] || 0)
          if (Math.abs(Number(it.qty) || 0) > avail) {
            throw new Error(`No hay suficiente "${it.name || 'producto'}" en Entregas (disponible ${avail})`)
          }
        }
        for (const it of lines) {
          const q = Math.abs(Number(it.qty) || 0)
          const outId = `delivery-out:${id}:${it.productId}`
          if (!(await db.stockMovements.get(outId))) {
            await db.stockMovements.add({
              id: outId, productId: it.productId, qty: -q,
              type: MOVEMENT_TYPES.DELIVERY_OUT, refType: 'remittance', refId: id,
              unitCost: null, shiftId: null, userId: actorId, note: 'Carga a mensajero',
              location: ENTREGAS_AREA, createdAt: ts
            })
            const p = await db.products.get(it.productId)
            if (p) {
              const byLoc = { ...(p.stockByLocation || {}) }
              byLoc[ENTREGAS_AREA] = cleanQty(Number(byLoc[ENTREGAS_AREA] || 0) - q)
              await db.products.update(it.productId, {
                stock: cleanQty(Number(p.stock || 0) - q), stockByLocation: byLoc, updatedAt: ts
              })
            }
          }
          const inId = `pcustody:load:${id}:${it.productId}`
          if (!(await db.productCustody.get(inId))) {
            await productCustodyRepo.addMovementRaw({
              id: inId, holder: courierId, productId: it.productId, name: it.name, qty: q,
              refType: 'remittance', refId: id, byUserId: actorId, createdAt: ts
            })
          }
        }
      }
      // El dinero (efectivo) ya NO se mueve al asignar: en AMBOS modos el mensajero
      // reparte desde su FONDO (F4), que la entrega descuenta al confirmarse. Asignar
      // solo lo designa y (en producto) le carga la mercancia.
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
    await db.transaction('rw', db.remittances, db.custodyMovements, db.deliveries, db.auditEvents, db.productCustody, async () => {
      const r = await db.remittances.get(id)
      if (!r) throw new Error('Entrega no encontrada')
      if (r.status !== REMITTANCE_STATUS.ASSIGNED && r.status !== REMITTANCE_STATUS.IN_ROUTE) {
        throw new Error('Solo se puede entregar una entrega asignada')
      }
      if (!r.assignedCourierId) throw new Error('La entrega no tiene mensajero asignado')
      if (r.kind === DELIVERY_KIND.PRODUCT) {
        // Producto: SALE de la custodia de PRODUCTO del mensajero al beneficiario.
        const lines = Array.isArray(r.items) ? r.items : []
        for (const it of lines) {
          const q = Math.abs(Number(it.qty) || 0)
          const outId = `pcustody:deliver:${id}:${it.productId}`
          if (!(await db.productCustody.get(outId))) {
            await productCustodyRepo.addMovementRaw({
              id: outId, holder: r.assignedCourierId, productId: it.productId, name: it.name, qty: -q,
              refType: 'remittance', refId: id, byUserId: actorId, createdAt: ts
            })
          }
        }
      } else {
        // Dinero: DEBITA la custodia de EFECTIVO del mensajero (salda lo asignado en
        // anticipado; descuenta su fondo en contra entrega). En ambos su saldo baja
        // igual. Id determinista -> idempotente entre dispositivos.
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

  // Entrega fallida: el mensajero NO pudo entregar y CONSERVA lo que llevaba (su fondo
  // de efectivo no bajo, porque la entrega no se confirmo; el producto sigue en su
  // custodia). Solo registra la entrega FALLIDA (append-only) y pasa a DEVUELTA; lo que
  // conserva lo devuelve al cerrar (fondo) o con "Devolver producto". Solo ASIGNADA / EN RUTA.
  async failReturn(id, { note = '', actorId = null } = {}) {
    const ts = now()
    await db.transaction('rw', db.remittances, db.custodyMovements, db.deliveries, db.auditEvents, async () => {
      const r = await db.remittances.get(id)
      if (!r) throw new Error('Entrega no encontrada')
      if (r.status !== REMITTANCE_STATUS.ASSIGNED && r.status !== REMITTANCE_STATUS.IN_ROUTE) {
        throw new Error('Solo se devuelve una entrega asignada')
      }
      if (!r.assignedCourierId) throw new Error('La entrega no tiene mensajero asignado')
      // NO se mueve custodia: el mensajero conserva el efectivo (su fondo no bajo) o el
      // producto (su custodia sigue igual). Solo queda la constancia de la falla.
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
      if (r.collectedAt) return // ya cobrado: idempotente, no duplica
      // Contra entrega: el cobro es DESPUES de entregar. Anticipado: es el PAGO, antes
      // de asignar. En ambos el dinero va a una cuenta de tesoreria (no a la custodia).
      if (r.paymentMode === PAYMENT_MODE.ON_CREDIT && r.status !== REMITTANCE_STATUS.DELIVERED) {
        throw new Error('Solo se cobra una entrega ya entregada')
      }

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
      const patch = {
        collectedAt: ts,
        collectedAccountId: acc ? accountId : null,
        collectedAmount: amt,
        collectedCurrency: cur,
        updatedAt: ts
      }
      // Anticipado: el pago se registra ANTES de asignar -> queda lista para asignar.
      if (r.paymentMode !== PAYMENT_MODE.ON_CREDIT && r.status !== REMITTANCE_STATUS.DELIVERED) {
        patch.status = REMITTANCE_STATUS.FUNDS_AVAILABLE
      }
      await db.remittances.update(id, patch)
      await db.auditEvents.add({
        id: newId(), entity: 'remittance', entityId: id, action: 'collect',
        amount: amt, currency: cur, accountId: acc ? accountId : null,
        userId: actorId, createdAt: ts
      })
    })
  },

  // Devuelve al area "Entregas" el producto que un mensajero ya no entregara (sobrante
  // o entrega fallida). Rebaja su custodia de PRODUCTO y reingresa al area (libro mayor
  // + cache). Valida que no devuelva mas de lo que lleva. Atomico y auditado.
  async returnProduct({ courierId, items = [], actorId = null }) {
    if (!courierId) throw new Error('Falta el mensajero')
    const lines = cleanItems(items)
    if (lines.length === 0) throw new Error('Indica el producto a devolver')
    const ts = now()
    await db.transaction('rw', db.productCustody, db.stockMovements, db.products, db.auditEvents, async () => {
      const carried = await productCustodyRepo.holderProducts(courierId)
      for (const it of lines) {
        const have = Number(carried[it.productId] || 0)
        if (it.qty > have) throw new Error(`El mensajero no lleva tanto "${it.name || 'producto'}" (lleva ${have})`)
      }
      // Id de la operacion DERIVADO de su contenido (mensajero + instante), no
      // aleatorio: este movimiento toca el INVENTARIO REAL, asi que un doble envio
      // (doble toque, reintento tras error, o la misma fila reprocesada) NO puede
      // duplicar existencia. Dos devoluciones DISTINTAS ocurren en instantes
      // distintos -> ids distintos -> se registran las dos, como debe ser. Es el
      // mismo candado determinista de `assign`, que tambien mueve inventario.
      const op = `${courierId}:${ts}`
      for (const it of lines) {
        const q = Math.abs(Number(it.qty) || 0)
        const inId = `delivery-in:${op}:${it.productId}`
        if (await db.stockMovements.get(inId)) continue // ya registrada: idempotente
        await productCustodyRepo.addMovementRaw({
          id: `pcustody:return:${op}:${it.productId}`, holder: courierId, productId: it.productId,
          name: it.name, qty: -q, refType: 'productReturn', refId: courierId, byUserId: actorId, createdAt: ts
        })
        await db.stockMovements.add({
          id: inId, productId: it.productId, qty: q,
          type: MOVEMENT_TYPES.DELIVERY_IN, refType: 'productReturn', refId: courierId,
          unitCost: null, shiftId: null, userId: actorId, note: 'Devolucion de mensajero',
          location: ENTREGAS_AREA, createdAt: ts
        })
        const p = await db.products.get(it.productId)
        if (p) {
          const byLoc = { ...(p.stockByLocation || {}) }
          byLoc[ENTREGAS_AREA] = cleanQty(Number(byLoc[ENTREGAS_AREA] || 0) + q)
          await db.products.update(it.productId, {
            stock: cleanQty(Number(p.stock || 0) + q), stockByLocation: byLoc, updatedAt: ts
          })
        }
      }
      await db.auditEvents.add({
        id: newId(), entity: 'productCustody', entityId: courierId, action: 'product_return',
        courierId, userId: actorId, createdAt: ts
      })
    })
  }
}
