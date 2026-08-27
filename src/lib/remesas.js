// Capa de PRESENTACION del modulo 'remesas' (Entregas): resume el estado detallado
// de una entrega en tres grupos que el dueno lee de un vistazo —Por cobrar / En
// proceso / Completado (mas las cerradas por excepcion)—. Es PURO y DERIVADO: no
// cambia el estado real ni la base de datos, solo lo agrupa para la UI. Recibe la
// ENTREGA completa (no solo el estado) para poder afinarse en fases futuras —el
// cobro contra entrega (grupo "Por cobrar") se activa cuando exista el modo de
// cobro— sin cambiar la firma.
import { REMITTANCE_STATUS, PAYMENT_MODE } from '../db/constants'

const S = REMITTANCE_STATUS

// Terminada bien: la entrega se concreto o el efectivo se concilio.
const DONE = new Set([S.DELIVERED, S.SETTLED, S.CLOSED])
// Cerrada por EXCEPCION (no se borra nada: son estados, no eliminaciones).
const CLOSED_EXC = new Set([
  S.CANCELLED, S.RETURNED, S.FAILED, S.REJECTED, S.EXPIRED,
  S.BENEFICIARY_UNAVAILABLE, S.WRONG_ADDRESS, S.DISPUTED
])

// Grupos legibles con su "tono" (semaforo, el mismo lenguaje del resto de la app).
export const REMITTANCE_GROUP = {
  PENDING_COLLECTION: { key: 'por_cobrar', label: 'Por cobrar', tone: 'bad' },
  IN_PROCESS: { key: 'en_proceso', label: 'En proceso', tone: 'muted' },
  DONE: { key: 'completado', label: 'Completado', tone: 'ok' },
  CLOSED: { key: 'cerrada', label: 'Cerrada', tone: 'warn' }
}

// Entrega con cobro CONTRA ENTREGA, ya ENTREGADA y aun sin registrar el cobro del
// remitente = "por cobrar". El cobro que la concluye (marca `collectedAt`) llega en
// la fase de cobro a cuenta; hasta entonces la entrega queda pendiente de cobro.
export function isPendingCollection(r) {
  return (
    r?.paymentMode === PAYMENT_MODE.ON_CREDIT &&
    Number(r?.amount) > 0 &&
    r?.status === REMITTANCE_STATUS.DELIVERED &&
    !r?.collectedAt
  )
}

// Grupo legible de una entrega. El orden importa: primero las cerradas por
// excepcion, luego "por cobrar" (contra entrega sin cobrar), luego completado y
// finalmente en proceso.
export function remittanceGroup(r) {
  const s = r?.status
  if (CLOSED_EXC.has(s)) return REMITTANCE_GROUP.CLOSED
  if (isPendingCollection(r)) return REMITTANCE_GROUP.PENDING_COLLECTION
  if (DONE.has(s)) return REMITTANCE_GROUP.DONE
  return REMITTANCE_GROUP.IN_PROCESS
}
