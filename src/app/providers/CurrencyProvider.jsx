import { createContext, useContext, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { configRepo } from '../../repositories/configRepo'
import { ratesRepo } from '../../repositories/ratesRepo'
import { foreignToBase, baseToForeign } from '../../lib/currency'

const CurrencyContext = createContext(null)

// Expone la moneda base, las tasas vigentes y helpers de conversion.
// Todo reactivo: si el dueño cambia la tasa en Ajustes, se actualiza al vuelo.
export function CurrencyProvider({ children }) {
  const baseCurrency = useLiveQuery(() => configRepo.getBaseCurrency(), [], 'MN')
  const rates = useLiveQuery(() => ratesRepo.currentRates(), [], {})

  const value = useMemo(() => {
    const rateOf = (currency) => Number(rates?.[currency]?.rate || 0)

    return {
      baseCurrency,
      rates: rates || {},
      rateOf,
      // moneda -> base
      toBase: (amount, currency) =>
        currency === baseCurrency ? Number(amount) : foreignToBase(amount, rateOf(currency)),
      // base -> moneda
      toForeign: (amount, currency) =>
        currency === baseCurrency ? Number(amount) : baseToForeign(amount, rateOf(currency))
    }
  }, [baseCurrency, rates])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency debe usarse dentro de <CurrencyProvider>')
  return ctx
}
