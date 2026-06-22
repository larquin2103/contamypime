import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'
import { round2 } from '../lib/currency'
import { evalSemaphore } from '../lib/semaphore'
import { SHIFT_STATUS, CASH_CURRENCIES } from '../db/constants'
import { configRepo } from './configRepo'

// Caja vacia por moneda de efectivo ({ MN: 0, USD: 0 }).
function emptyCash() {
  const o = {}
  for (const c of CASH_CURRENCIES) o[c] = 0
  return o
}

export const shiftsRepo = {
  // Turno abierto actual (Fase 1 = punto unico, a lo sumo uno abierto).
  async getActive() {
    const open = await db.shifts.where('status').equals(SHIFT_STATUS.OPEN).toArray()
    return open[0] || null
  },

  async get(id) {
    return db.shifts.get(id)
  },

  async list() {
    const all = await db.shifts.toArray()
    return all.sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))
  },

  async open({ sellerId, openingCash, point = 'Principal' }) {
    const active = await this.getActive()
    if (active) throw new Error('Ya hay un turno abierto. Cierralo antes de abrir otro.')
    const id = newId()
    const ts = now()
    await db.shifts.add({
      id,
      sellerId,
      point, // multi-punto es Fase 3; en Fase 1 un punto por defecto
      status: SHIFT_STATUS.OPEN,
      openedAt: ts,
      openingCash: { ...emptyCash(), ...openingCash },
      closedAt: null,
      declaredCash: null,
      expectedCash: null,
      difference: null,
      semaphore: null,
      notes: ''
    })
    return id
  },

  // Resumen de caja del turno. Es la base del cuadre: se nutre de ventas,
  // extracciones y deudas (vacios hasta los Bloques 5/9, pero ya contemplados).
  async getSummary(shiftId) {
    const shift = await db.shifts.get(shiftId)
    if (!shift) return null

    const sales = await db.sales.where('shiftId').equals(shiftId).toArray()
    const withdrawals = await db.cashMovements.where('shiftId').equals(shiftId).toArray()
    const debts = await db.internalDebts.where('shiftId').equals(shiftId).toArray()

    const salesCash = emptyCash()
    const transfersByCur = {}
    let salesCount = 0
    let transfersCount = 0
    for (const s of sales) {
      if (s.voided) continue
      salesCount++
      if (s.paymentMethod === 'transfer') {
        // Transferencias: separadas del efectivo, no entran a caja (Fase 2).
        transfersCount++
        const cur = s.transferCurrency || 'MN'
        transfersByCur[cur] = round2((transfersByCur[cur] || 0) + Number(s.transferAmount || 0))
      } else if (s.cashCurrency && salesCash[s.cashCurrency] != null) {
        // Efectivo: monto neto que entra a caja (ya sin el cambio).
        salesCash[s.cashCurrency] += Number(s.cashAmount || 0)
      }
    }

    const withdrawalsByCur = emptyCash()
    for (const w of withdrawals) {
      if (withdrawalsByCur[w.currency] != null) withdrawalsByCur[w.currency] += Number(w.amount || 0)
    }

    const expectedCash = emptyCash()
    for (const c of CASH_CURRENCIES) {
      expectedCash[c] = round2(
        Number(shift.openingCash?.[c] || 0) + salesCash[c] - withdrawalsByCur[c]
      )
    }

    // La deuda interna NO es ingreso: solo se informa, no entra al esperado.
    const internalDebtTotal = round2(debts.reduce((a, d) => a + Number(d.valueAtTime || 0), 0))

    return {
      shift,
      salesCount,
      salesCash,
      transfersByCur,
      transfersCount,
      withdrawalsByCur,
      expectedCash,
      internalDebtTotal,
      debtsCount: debts.length
    }
  },

  async close({ shiftId, declaredCash, denominations = null, notes = '' }) {
    const summary = await this.getSummary(shiftId)
    if (!summary) throw new Error('Turno no encontrado')

    const cfg = await configRepo.getSemaphoreConfig()
    let base = await configRepo.getBaseCurrency()
    if (!CASH_CURRENCIES.includes(base)) base = CASH_CURRENCIES[0]

    const declared = { ...emptyCash(), ...declaredCash }
    const difference = emptyCash()
    for (const c of CASH_CURRENCIES) {
      difference[c] = round2(Number(declared[c] || 0) - summary.expectedCash[c])
    }

    // Semaforo sobre la moneda base (la principal del cuadre).
    const sem = evalSemaphore(summary.expectedCash[base], Number(declared[base] || 0), cfg)

    await db.shifts.update(shiftId, {
      status: SHIFT_STATUS.CLOSED,
      closedAt: now(),
      declaredCash: declared,
      denominations, // conteo por billete al cierre (Fase 2)
      expectedCash: summary.expectedCash,
      difference,
      semaphore: sem.color,
      semaphoreDetail: sem,
      notes
    })

    return { ...summary, declared, difference, semaphore: sem, base }
  }
}
