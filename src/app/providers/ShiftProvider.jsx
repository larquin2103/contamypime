import { createContext, useContext } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { useAuth } from './AuthProvider'

const ShiftContext = createContext(null)

// Expone el turno activo a toda la app. Regla de oro (plan):
// solo el vendedor del turno activo puede vender — ni siquiera el dueño
// sin haber abierto turno.
export function ShiftProvider({ children }) {
  const { user } = useAuth()
  const activeShift = useLiveQuery(() => shiftsRepo.getActive(), [], undefined)

  const value = {
    activeShift: activeShift || null,
    loading: activeShift === undefined,
    hasActive: !!activeShift,
    isMine: !!activeShift && !!user && activeShift.sellerId === user.id,
    canSell: !!activeShift && !!user && activeShift.sellerId === user.id
  }

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
}

export function useShift() {
  const ctx = useContext(ShiftContext)
  if (!ctx) throw new Error('useShift debe usarse dentro de <ShiftProvider>')
  return ctx
}
