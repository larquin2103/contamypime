import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { evalSemaphore } from '../lib/semaphore'
import { CASH_CURRENCIES, REMITTANCE_STATUS, DELIVERY_KIND } from '../db/constants'
import { isPendingCollection } from '../lib/remesas'
import { configRepo } from './configRepo'
import { custodyRepo } from './custodyRepo'

// Liquidacion de un mensajero (modulo 'remesas') — RECONCILIACION append-only del
// efectivo en custodia, con el MISMO patron que el cuadre de turno: TEORICO (lo que
// el libro de custodia dice que el mensajero tiene) vs FISICO (lo que el mando le
// cuenta) vs DIFERENCIA + semaforo. Es un SNAPSHOT (como mermas/producciones): NO
// mueve el libro ni ajusta el saldo; deja constancia para exigir cuentas. Si hay
// diferencia, queda marcada por el semaforo y se resuelve aparte. Solo escribe
// `settlements` + `auditEvents`: no toca ventas, caja, inventario ni tesoreria.
export const settlementsRepo = {
  async list() {
    const rows = await db.settlements.toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  async forCourier(courierId) {
    const rows = await db.settlements.where('courierId').equals(courierId).toArray()
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  },

  // Registra una liquidacion. `counted` = conteo FISICO por moneda { MN: x, USD: y }.
  // El TEORICO se DERIVA del libro de custodia al momento (snapshot). Semaforo sobre
  // la moneda base (esperado = teorico, declarado = fisico), igual que el cierre de
  // turno. Append-only + evento de auditoria; no ajusta el libro.
  //
  // Ademas MARCA COMO LIQUIDADAS las entregas del mensajero cuyo efectivo acaba de
  // conciliarse. Esa es la relacion real: al entregar, `remittancesRepo.deliver`
  // DEBITA la custodia del mensajero, asi que el saldo teorico que aqui se cuadra
  // CONTIENE precisamente esas entregas; liquidar es dar por conciliado ese efectivo.
  // Se marcan SOLO las que cumplen las tres condiciones:
  //   - ENTREGADAS (una que no se entrego no movio efectivo del mensajero),
  //   - de DINERO (las de producto no tocan la custodia de efectivo: su contraparte
  //     es la custodia de producto, que se concilia aparte),
  //   - SIN COBRO PENDIENTE al remitente. Esto es deliberado: "liquidada" habla del
  //     efectivo DEL MENSAJERO, y "por cobrar" del dinero QUE DEBE EL REMITENTE —son
  //     dos dineros distintos—. Marcarlas liquidadas las sacaria de "Por cobrar"
  //     (que filtra por estado ENTREGADA) y el dueño perderia de vista una deuda viva.
  //     Se quedan en ENTREGADA hasta que se cobren; la siguiente liquidacion las toma.
  async create({ courierId, counted = {}, note = '', settledBy = null }) {
    if (!courierId) throw new Error('Falta el mensajero')
    let base = await configRepo.getBaseCurrency()
    if (!CASH_CURRENCIES.includes(base)) base = CASH_CURRENCIES[0]
    const cfg = await configRepo.getSemaphoreConfig()

    const id = newId()
    const ts = now()
    let settledCount = 0
    await db.transaction('rw', db.settlements, db.auditEvents, db.custodyMovements, db.remittances, async () => {
      // El teorico se deriva DENTRO de la transaccion: el snapshot y las entregas que
      // se marcan salen de la misma foto del libro (antes se leia fuera).
      const theoretical = await custodyRepo.balanceOf(courierId) // { cur: monto } derivado

      const currencies = new Set([...Object.keys(theoretical), ...Object.keys(counted)])
      const countedClean = {}
      const difference = {}
      for (const c of currencies) {
        const cnt = round2(Number(counted[c]) || 0)
        const th = round2(Number(theoretical[c]) || 0)
        countedClean[c] = cnt
        difference[c] = round2(cnt - th) // fisico - teorico ( <0 falta, >0 sobra )
      }
      // Semaforo sobre la base: esperado = teorico, declarado = fisico.
      const sem = evalSemaphore(Number(theoretical[base]) || 0, Number(counted[base]) || 0, cfg)

      // Entregas de ESTE mensajero cuyo efectivo entra en la conciliacion (ver arriba).
      const mine = await db.remittances.where('assignedCourierId').equals(courierId).toArray()
      const toSettle = mine.filter(
        (r) =>
          !r.deletedAt &&
          r.status === REMITTANCE_STATUS.DELIVERED &&
          r.kind !== DELIVERY_KIND.PRODUCT &&
          !isPendingCollection(r)
      )

      await db.settlements.add({
        id,
        courierId,
        theoretical, // snapshot del saldo derivado por moneda
        counted: countedClean,
        difference,
        base,
        semaphore: sem.color,
        semaphoreDetail: sem,
        // Que entregas quedaron conciliadas con esta liquidacion (trazabilidad).
        remittanceIds: toSettle.map((r) => r.id),
        note: String(note || '').trim(),
        settledBy,
        settledAt: ts,
        createdAt: ts
      })

      for (const r of toSettle) {
        await db.remittances.update(r.id, {
          status: REMITTANCE_STATUS.SETTLED,
          settlementId: id,
          settledAt: ts,
          updatedAt: ts
        })
        settledCount += 1
      }

      await db.auditEvents.add({
        id: newId(),
        entity: 'settlement',
        entityId: id,
        action: 'settle',
        courierId,
        settledCount,
        userId: settledBy,
        createdAt: ts
      })
    })
    return id
  }
}
