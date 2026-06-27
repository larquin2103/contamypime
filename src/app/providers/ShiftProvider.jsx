import { createContext, useContext } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { useAuth } from './AuthProvider'

const ShiftContext = createContext(null)

// Expone el turno PROPIO del usuario actual. Regla de oro (plan):
// solo el vendedor con su turno abierto puede vender — ni siquiera el dueño
// sin haber abierto turno. Con areas (Fase 6) varios vendedores pueden tener
// turno a la vez; cada uno opera el suyo, por eso se consulta por sellerId.
export function ShiftProvider({ children }) {
  const { user } = useAuth()
  const activeShift = useLiveQuery(
    () => (user ? shiftsRepo.getActiveFor(user.id) : null),
    [user?.id],
    undefined
  )

  const value = {
    activeShift: activeShift || null,
    loading: activeShift === undefined,
    hasActive: !!activeShift,
    // El turno del provider es siempre el del usuario actual (es "mio").
    isMine: !!activeShift,
    canSell: !!activeShift
  }

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
}

export function useShift() {
  const ctx = useContext(ShiftContext)
  if (!ctx) throw new Error('useShift debe usarse dentro de <ShiftProvider>')
  return ctx
}
