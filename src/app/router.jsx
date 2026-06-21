import { Routes, Route, Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../repositories/usersRepo'
import { useAuth } from './providers/AuthProvider'
import { Layout } from '../components/Layout'
import { Onboarding } from '../features/auth/Onboarding'
import { Login } from '../features/auth/Login'
import { Home } from '../features/home/Home'
import { Settings } from '../features/settings/Settings'
import { UsersAdmin } from '../features/auth/UsersAdmin'

// Decide que mostrar segun el estado:
//  - sin usuarios          -> Onboarding (crear dueno)
//  - usuarios pero sin sesion -> Login
//  - con sesion            -> app (Layout + rutas)
export function AppRouter() {
  const userCount = useLiveQuery(() => usersRepo.count(), [])
  const { user } = useAuth()

  if (userCount === undefined) {
    return <div className="screen screen--centered"><p className="muted">Cargando…</p></div>
  }
  if (userCount === 0) return <Onboarding />
  if (!user) return <Login />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<UsersAdmin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
