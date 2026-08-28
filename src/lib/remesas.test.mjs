// Pruebas PURAS de la regla de RECONCILIACION del modulo 'remesas'.
// Sin framework: ejecutar con  `node src/lib/remesas.test.mjs`.
//
// La regla (shouldReconcileDelivered) es la que usa
// `remittancesRepo.reconcileFromDeliveries` para re-derivar la cabecera desde el
// libro append-only de entregas. Lo que se verifica es su ESTRECHEZ: que promueva
// exactamente el caso roto y NADA mas (no puede regresar un estado ya resuelto ni
// resucitar una entrega eliminada).
//
// Es la MISMA condicion que usa el candado de `failReturn` (Capa 3): si hay
// constancia de ENTREGADA, la entrega no puede marcarse fallida.
import { shouldReconcileDelivered, isPendingCollection, remittanceGroup, REMITTANCE_GROUP } from './remesas.js'
import { REMITTANCE_STATUS, DELIVERY_RESULT, PAYMENT_MODE } from '../db/constants.js'

let pass = 0
let fail = 0
const eq = (name, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${ok ? '' : `  got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`}`)
  ok ? pass++ : fail++
}

const rem = (status, extra = {}) => ({ id: 'R1', status, ...extra })
const entregada = (extra = {}) => ({ id: 'delivery:R1', remittanceId: 'R1', result: DELIVERY_RESULT.DELIVERED, voided: false, ...extra })
const fallida = () => ({ id: 'delivery:R1', remittanceId: 'R1', result: DELIVERY_RESULT.FAILED, voided: false })

// --- el caso ROTO que hay que reparar ---------------------------------------
eq('ASIGNADA con constancia de entregada -> se promueve',
  shouldReconcileDelivered(rem(REMITTANCE_STATUS.ASSIGNED), [entregada()]), true)
eq('EN RUTA con constancia de entregada -> se promueve',
  shouldReconcileDelivered(rem(REMITTANCE_STATUS.IN_ROUTE), [entregada()]), true)

// --- sin constancia no se toca nada -----------------------------------------
eq('ASIGNADA sin filas -> no se toca',
  shouldReconcileDelivered(rem(REMITTANCE_STATUS.ASSIGNED), []), false)
eq('ASIGNADA con constancia FALLIDA -> no se toca',
  shouldReconcileDelivered(rem(REMITTANCE_STATUS.ASSIGNED), [fallida()]), false)
eq('ASIGNADA con constancia entregada ANULADA -> no se toca',
  shouldReconcileDelivered(rem(REMITTANCE_STATUS.ASSIGNED), [entregada({ voided: true })]), false)
eq('mezcla: fallida + entregada viva -> se promueve',
  shouldReconcileDelivered(rem(REMITTANCE_STATUS.ASSIGNED), [fallida(), entregada()]), true)

// --- NUNCA regresa un estado ya resuelto ------------------------------------
for (const s of [
  REMITTANCE_STATUS.SETTLED,
  REMITTANCE_STATUS.CLOSED,
  REMITTANCE_STATUS.CANCELLED,
  REMITTANCE_STATUS.DELIVERED,
  REMITTANCE_STATUS.RETURNED,
  REMITTANCE_STATUS.FAILED,
  REMITTANCE_STATUS.REJECTED,
  REMITTANCE_STATUS.EXPIRED,
  REMITTANCE_STATUS.DISPUTED,
  REMITTANCE_STATUS.BENEFICIARY_UNAVAILABLE,
  REMITTANCE_STATUS.WRONG_ADDRESS,
  REMITTANCE_STATUS.CREATED,
  REMITTANCE_STATUS.PAYMENT_PENDING,
  REMITTANCE_STATUS.PAID,
  REMITTANCE_STATUS.VALIDATED,
  REMITTANCE_STATUS.FUNDS_AVAILABLE,
  REMITTANCE_STATUS.HANDED_TO_COURIER
]) {
  eq(`estado ${s} NO se reconcilia`, shouldReconcileDelivered(rem(s), [entregada()]), false)
}

// --- eliminadas y entradas invalidas ----------------------------------------
eq('eliminada (borrado logico) -> no se toca',
  shouldReconcileDelivered(rem(REMITTANCE_STATUS.ASSIGNED, { deletedAt: '2026-08-27T00:00:00.000Z' }), [entregada()]), false)
eq('entrega nula -> false', shouldReconcileDelivered(null, [entregada()]), false)
eq('filas nulas -> false', shouldReconcileDelivered(rem(REMITTANCE_STATUS.ASSIGNED), null), false)
eq('fila basura -> false', shouldReconcileDelivered(rem(REMITTANCE_STATUS.ASSIGNED), [null, {}]), false)

// --- idempotencia: tras reparar, la regla ya no dispara ---------------------
{
  const r = rem(REMITTANCE_STATUS.ASSIGNED)
  const filas = [entregada()]
  eq('1a pasada repara', shouldReconcileDelivered(r, filas), true)
  const reparada = { ...r, status: REMITTANCE_STATUS.DELIVERED }
  eq('2a pasada ya no hace nada', shouldReconcileDelivered(reparada, filas), false)
}

// --- coherencia con lo que ya existia (no se cambio nada de la presentacion) -
{
  const pendiente = { status: REMITTANCE_STATUS.DELIVERED, paymentMode: PAYMENT_MODE.ON_CREDIT, amount: 100 }
  eq('isPendingCollection sigue igual', isPendingCollection(pendiente), true)
  eq('remittanceGroup sigue igual', remittanceGroup(pendiente).key, REMITTANCE_GROUP.PENDING_COLLECTION.key)
  eq('una reparada cae en Completado',
    remittanceGroup({ status: REMITTANCE_STATUS.DELIVERED, paymentMode: PAYMENT_MODE.UPFRONT }).key,
    REMITTANCE_GROUP.DONE.key)
}

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
