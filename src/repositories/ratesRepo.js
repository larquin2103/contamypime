import { db } from '../db/db'
import { newId } from '../lib/ids'
import { now } from '../lib/dates'

// Tasas de cambio. Append-only: cada cambio crea un registro nuevo con su
// `effectiveFrom`, conservando todo el historial (auditoria + Fase 3).
export const ratesRepo = {
  // Registra una tasa nueva para una moneda.
  async addRate(currency, rate, userId) {
    const id = newId()
    const ts = now()
    await db.exchangeRates.add({
      id,
      currency,
      rate: Number(rate),
      effectiveFrom: ts,
      createdBy: userId || null,
      createdAt: ts
    })
    return id
  },

  // Devuelve la tasa vigente de cada moneda: { USD: {rate,...}, MLC: {...} }.
  async currentRates() {
    const all = await db.exchangeRates.toArray()
    const latest = {}
    for (const r of all) {
      if (!latest[r.currency] || r.effectiveFrom > latest[r.currency].effectiveFrom) {
        latest[r.currency] = r
      }
    }
    return latest
  },

  // Tasa vigente (numero) de UNA moneda, o 0 si no hay. La usan los repos que
  // convierten precios en divisa a la base (modulo 'divisas') sin contexto React
  // (p.ej. ordersRepo.addItem, que puede llamarse desde varios sitios).
  async currentRateFor(currency) {
    const all = await this.currentRates()
    return Number(all[currency]?.rate || 0)
  },

  // Historial de una moneda, mas reciente primero.
  async history(currency) {
    const rows = await db.exchangeRates.where('currency').equals(currency).toArray()
    return rows.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
  }
}
