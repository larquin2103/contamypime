import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../../repositories/usersRepo'
import { configRepo } from '../../repositories/configRepo'
import { ROLES } from '../../db/constants'

const AuthContext = createContext(null)
const STORAGE_KEY = 'mc_session_user'

function readStoredSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredSession)

  // Revalida la sesion contra Dexie (fuente de verdad). El `role` guardado en
  // sessionStorage es MANIPULABLE (DevTools): un vendedor podria editarlo a
  // "owner"/"admin" y desbloquear las pantallas de mando, que solo comprueban
  // el flag de contexto. Por eso, al arrancar releemos el usuario por id y
  // tomamos su rol y estado REALES; si no existe o esta inactivo, cerramos la
  // sesion. Asi el rol no se puede falsear editando el almacenamiento.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const stored = readStoredSession()
      if (!stored?.id) return
      const fresh = await usersRepo.get(stored.id)
      if (!alive) return
      if (!fresh || !fresh.active) {
        setUser(null)
        sessionStorage.removeItem(STORAGE_KEY)
        return
      }
      // Rol y nombre autoritativos desde la BD (corrige cualquier manipulacion).
      const safe = { id: fresh.id, name: fresh.name, role: fresh.role }
      setUser(safe)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(safe))
    })()
    return () => { alive = false }
  }, [])

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

  // Permisos del administrativo (Bloque 20.6+). El dueño puede QUITAR facultades
  // puntuales al admin en Ajustes. Por defecto (config ausente o clave sin poner)
  // TODO permitido -> el admin conserva sus facultades actuales (comportamiento
  // de hoy). El dueño nunca se ve afectado.
  const adminPerms = useLiveQuery(() => configRepo.get('adminPermissions', {}), [], {})
  // can(cap): ¿el usuario actual puede realizar `cap`? El dueño siempre; el admin
  // salvo que el dueño lo haya puesto explícitamente en false; otros roles no.
  const can = (cap) => isOwner || (isAdmin && (adminPerms?.[cap] !== false))

  const value = {
    user,
    login,
    logout,
    isOwner,
    isAdmin,
    can,
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
