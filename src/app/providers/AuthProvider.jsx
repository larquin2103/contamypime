import { createContext, useContext, useState, useCallback } from 'react'
import { usersRepo } from '../../repositories/usersRepo'
import { ROLES } from '../../db/constants'

const AuthContext = createContext(null)
const STORAGE_KEY = 'mc_session_user'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  const login = useCallback(async (userId, pin) => {
    const u = await usersRepo.verifyLogin(userId, pin)
    if (!u) return false
    // Guardamos solo datos no sensibles (nunca el hash del PIN).
    const safe = { id: u.id, name: u.name, role: u.role }
    setUser(safe)
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(safe))
    return true
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    sessionStorage.removeItem(STORAGE_KEY)
  }, [])

  const isOwner = user?.role === ROLES.OWNER
  const isAdmin = user?.role === ROLES.ADMIN

  const value = {
    user,
    login,
    logout,
    isOwner,
    isAdmin,
    // "Mando": dueño O administrativo. Habilita inventario, supervision y la
    // visibilidad financiera. Lo exclusivo del dueño (usuarios, licencia, nube)
    // se sigue comprobando con isOwner.
    isManager: isOwner || isAdmin
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
