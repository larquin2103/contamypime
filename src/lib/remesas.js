// Capa de PRESENTACION del modulo 'remesas' (Entregas): resume el estado detallado
// de una entrega en tres grupos que el dueno lee de un vistazo —Por cobrar / En
// proceso / Completado (mas las cerradas por excepcion)—. Es PURO y DERIVADO: no
// cambia el estado real ni la base de datos, solo lo agrupa para la UI. Recibe la
// ENTREGA completa (no solo el estado) para poder afinarse en fases futuras —el
// cobro contra entrega (grupo "Por cobrar") se activa cuando exista el modo de
// cobro— sin cambiar la firma.
// Import CON extension .js (a diferencia del resto del proyecto) a proposito: asi
// este modulo —que es puro— se puede ejecutar con node para probarlo
// (`node src/lib/remesas.test.mjs`), como custodyMath/productCustodyMath. Vite lo
// resuelve igual; `db/constants` tampoco importa nada, por lo que la cadena es pura.
import { REMITTANCE_STATUS, PAYMENT_MODE, DELIVERY_RESULT, FOREIGN_PRICE_CURRENCIES } from '../db/constants.js'
import { round2 } from './currency.js'

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

// --- Reconciliacion derivada de la CONSTANCIA -------------------------------
// Estados desde los que el libro de entregas puede corregir la cabecera: la
// entrega esta EN CURSO (con mensajero) y todavia no tiene desenlace registrado.
const RECONCILABLE = new Set([REMITTANCE_STATUS.ASSIGNED, REMITTANCE_STATUS.IN_ROUTE])

// ¿Hay que promover esta entrega a ENTREGADA a partir de su libro de entregas?
//
// La cabecera (`remittances`) se fusiona por "ultima escritura gana", asi que una
// transicion puede perderse si el reloj del dispositivo que la sella va atrasado.
// La CONSTANCIA (`deliveries`) no: es append-only y con id determinista, asi que
// llega siempre. Es la misma situacion de `products.stock`, que puede llegar mal
// como cabecera y se RE-DERIVA del libro mayor.
//
// La regla es DELIBERADAMENTE ESTRECHA —solo sube de ASIGNADA/EN RUTA a ENTREGADA
// cuando hay una fila con resultado ENTREGADA y sin anular—: no regresa ningun
// estado (liquidada/cerrada/cancelada no se tocan), no interpreta fallos (el
// MOTIVO de una falla vive en el estado, no en la constancia: no es derivable) y
// no toca las eliminadas. PURA: recibe la entrega y sus filas, no lee la base.
export function shouldReconcileDelivered(remittance, deliveries = []) {
  if (!remittance || remittance.deletedAt) return false
  if (!RECONCILABLE.has(remittance.status)) return false
  return (deliveries || []).some(
    (d) => d && d.result === DELIVERY_RESULT.DELIVERED && d.voided !== true
  )
}

// --- Equivalente INFORMATIVO en la otra moneda (modulos 'remesas' + 'divisas') ---
//
// Una entrega guarda su monto en UNA moneda (`amount` + `currency`). Para que el
// mando vea "cuanto es eso" en la otra, al CREARLA se congela la tasa vigente
// (`rate`) y de que moneda es (`rateCurrency`) — exactamente como una linea de venta
// congela `priceCurrency`/`priceRate`: si mañana cambia la tasa, la entrega de hoy
// sigue diciendo lo que valia hoy. Sin congelarla, el historico cambiaria de valor
// cada vez que el dueño mueve la tasa (es el mismo motivo por el que el panel de
// cuentas NO convierte los conceptos a MN).
//
// Es INFORMATIVO y nada mas: no entra en la custodia, ni en la liquidacion, ni en
// ninguna suma ni reporte. Es texto en pantalla.
//
// Que tasa hace falta, segun la moneda de la entrega:
//   - Entrega en DIVISA (USD/MLC) -> equivalente en la BASE: amount x tasa.
//   - Entrega en la BASE (MN)     -> equivalente en la divisa de REFERENCIA
//                                    (la primera de FOREIGN_PRICE_CURRENCIES, hoy
//                                    USD): amount / tasa.
const REFERENCE_CURRENCY = FOREIGN_PRICE_CURRENCIES[0] || 'USD'

// De QUE moneda hay que congelar la tasa para una entrega en `currency`. Devuelve
// null cuando no hay nada que convertir (no deberia pasar con la config de hoy).
export function rateCurrencyFor(currency, base = 'MN') {
  const cur = String(currency || base)
  if (cur !== base) return cur
  return REFERENCE_CURRENCY === base ? null : REFERENCE_CURRENCY
}

// Equivalente de la entrega con su tasa CONGELADA, o null si no se puede decir nada
// (sin monto, sin tasa, o con una tasa que no corresponde a esta moneda). PURA: no
// lee la base ni la tasa de hoy, solo lo que la entrega lleva dentro.
export function remittanceEquivalent(r, base = 'MN') {
  const amount = Number(r?.amount) || 0
  const rate = Number(r?.rate) || 0
  const cur = String(r?.currency || base)
  const rateCur = String(r?.rateCurrency || '')
  if (amount <= 0 || rate <= 0 || !rateCur) return null
  // La tasa congelada tiene que ser la de ESTA moneda. Si no cuadra (una entrega
  // vieja, o una moneda corregida sin recalcular) no se inventa nada: no se muestra.
  if (rateCur !== rateCurrencyFor(cur, base)) return null
  return cur !== base
    ? { amount: round2(amount * rate), currency: base }
    : { amount: round2(amount / rate), currency: rateCur }
}
