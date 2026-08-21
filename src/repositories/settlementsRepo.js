import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { evalSemaphore } from '../lib/semaphore'
import { CASH_CURRENCIES } from '../db/constants'
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
  async create({ courierId, counted = {}, note = '', settledBy = null }) {
    if (!courierId) throw new Error('Falta el mensajero')
    const theoretical = await custodyRepo.balanceOf(courierId) // { cur: monto } derivado
    let base = await configRepo.getBaseCurrency()
    if (!CASH_CURRENCIES.includes(base)) base = CASH_CURRENCIES[0]
    const cfg = await configRepo.getSemaphoreConfig()

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

    const id = newId()
    const ts = now()
    await db.transaction('rw', db.settlements, db.auditEvents, async () => {
      await db.settlements.add({
        id,
        courierId,
        theoretical, // snapshot del saldo derivado por moneda
        counted: countedClean,
        difference,
        base,
        semaphore: sem.color,
        semaphoreDetail: sem,
        note: String(note || '').trim(),
        settledBy,
        settledAt: ts,
        createdAt: ts
      })
      await db.auditEvents.add({
        id: newId(),
        entity: 'settlement',
        entityId: id,
        action: 'settle',
        courierId,
        userId: settledBy,
        createdAt: ts
      })
    })
    return id
  }
}
