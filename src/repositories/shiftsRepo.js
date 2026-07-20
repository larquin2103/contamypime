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
  // Primer turno abierto (compatibilidad). Con varias areas puede haber varios
  // turnos abiertos a la vez; para la operacion de un vendedor usar getActiveFor.
  async getActive() {
    const open = await db.shifts.where('status').equals(SHIFT_STATUS.OPEN).toArray()
    return open[0] || null
  },

  // Turno abierto de UN vendedor concreto (Fase 6 - Bloque 19). Cada vendedor
  // tiene a lo sumo un turno abierto; varios vendedores pueden estar activos a
  // la vez en areas distintas del mismo punto.
  async getActiveFor(sellerId) {
    if (!sellerId) return null
    const open = await db.shifts.where('status').equals(SHIFT_STATUS.OPEN).toArray()
    return open.find((s) => s.sellerId === sellerId) || null
  },

  async get(id) {
    return db.shifts.get(id)
  },

  // Todos los turnos abiertos a la vez. Con areas (Fase 6) es normal tener
  // varios (uno por vendedor/area). Dos turnos del MISMO vendedor indican una
  // colision de sincronizacion que el dueño debe revisar.
  async listOpen() {
    const open = await db.shifts.where('status').equals(SHIFT_STATUS.OPEN).toArray()
    return open.sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1))
  },

  async list() {
    const all = await db.shifts.toArray()
    return all.sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))
  },

  async open({ sellerId, openingCash, point = 'Principal', area = '' }) {
    // Solo se bloquea si ESTE vendedor ya tiene turno abierto. Varios vendedores
    // pueden estar activos a la vez en areas distintas del mismo punto.
    const mine = await this.getActiveFor(sellerId)
    if (mine) throw new Error('Ya tienes un turno abierto. Cierralo antes de abrir otro.')
    const id = newId()
    const ts = now()
    await db.shifts.add({
      id,
      sellerId,
      point, // punto fisico (multi-punto = Fase 6 diferida); por defecto uno
      area: String(area || '').trim(), // area de venta dentro del punto
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
      if (s.paymentMethod === 'mixed' && Array.isArray(s.payments)) {
        // Pago mixto (Bloque H): cada parte suma a SU metodo y moneda, para
        // que el cuadre cierre igual que si fueran ventas separadas.
        let hasTransfer = false
        for (const p of s.payments) {
          if (p.method === 'transfer') {
            hasTransfer = true
            const cur = p.currency || 'MN'
            transfersByCur[cur] = round2((transfersByCur[cur] || 0) + Number(p.amount || 0))
          } else if (salesCash[p.currency] != null) {
            salesCash[p.currency] += Number(p.amount || 0)
          }
        }
        if (hasTransfer) transfersCount++
      } else if (s.paymentMethod === 'transfer') {
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

  // Efectivo a heredar por el proximo turno: el fondo del ultimo turno cerrado
  // (lo que el dueño dejo en caja). Se deriva de los turnos (que SI sincronizan).
  // Con areas, cada area hereda su PROPIA caja: se filtra por `area` para que el
  // fondo de un area no se cruce con el de otra. `area = null` = sin filtro.
  async lastClosedCash(area = null) {
    const closed = (await db.shifts.toArray())
      .filter((s) => s.status === SHIFT_STATUS.CLOSED && s.closedAt &&
        (area == null || String(s.area || '') === String(area || '')))
      .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))
    const last = closed[0]
    if (!last) return null
    return last.closingFloat || last.declaredCash || null
  },

  // `closingFloat` (opcional): efectivo que se deja en caja para el proximo
  // turno; lo demas se considera retirado por el dueño (ajuste del saldo final).
  async close({ shiftId, declaredCash, denominations = null, notes = '', closedBy = null, countSkipped = false, closingFloat = null }) {
    const summary = await this.getSummary(shiftId)
    if (!summary) throw new Error('Turno no encontrado')
    if (summary.shift.status === SHIFT_STATUS.CLOSED) throw new Error('El turno ya fue cerrado')

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

    // Lo cerro alguien distinto al vendedor del turno? (p.ej. el dueño por abandono)
    const forced = !!closedBy && closedBy !== summary.shift.sellerId

    // Fondo que queda para el proximo turno y retiro del dueño (declarado - fondo).
    const float = closingFloat ? { ...emptyCash(), ...closingFloat } : { ...declared }
    const ownerWithdrawal = emptyCash()
    for (const c of CASH_CURRENCIES) {
      ownerWithdrawal[c] = round2(Math.max(0, Number(declared[c] || 0) - Number(float[c] || 0)))
    }

    await db.shifts.update(shiftId, {
      status: SHIFT_STATUS.CLOSED,
      closedAt: now(),
      closedBy,
      forced,
      countSkipped,
      declaredCash: declared,
      denominations, // conteo por billete al cierre (Fase 2)
      expectedCash: summary.expectedCash,
      difference,
      semaphore: sem.color,
      semaphoreDetail: sem,
      closingFloat: float, // efectivo que hereda el proximo turno
      ownerWithdrawal, // retirado por el dueño al cierre (ajuste del saldo)
      notes
    })

    return { ...summary, declared, difference, semaphore: sem, base, forced, countSkipped, closingFloat: float, ownerWithdrawal }
  }
}
