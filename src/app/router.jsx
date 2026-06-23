import { Routes, Route, Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../repositories/usersRepo'
import { useAuth } from './providers/AuthProvider'
import { Layout } from '../components/Layout'
import { Onboarding } from '../features/auth/Onboarding'
import { Login } from '../features/auth/Login'
import { Home } from '../features/home/Home'
import { Catalog } from '../features/products/Catalog'
import { PriceScreen } from '../features/products/PriceScreen'
import { ImportScreen } from '../features/import/ImportScreen'
import { ShiftScreen } from '../features/shifts/ShiftScreen'
import { SalesScreen } from '../features/sales/SalesScreen'
import { EntryScreen } from '../features/inventory/EntryScreen'
import { CountScreen } from '../features/inventory/CountScreen'
import { CashScreen } from '../features/cash/CashScreen'
import { FinancesScreen } from '../features/cash/FinancesScreen'
import { HandoffScreen } from '../features/handoff/HandoffScreen'
import { DashboardScreen } from '../features/dashboard/DashboardScreen'
import { AuditScreen } from '../features/audit/AuditScreen'
import { Settings } from '../features/settings/Settings'
import { UsersAdmin } from '../features/auth/UsersAdmin'

// Decide que mostrar segun el estado:
//  - sin usuarios          -> Onboarding (crear dueño)
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
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/price" element={<PriceScreen />} />
        <Route path="/import" element={<ImportScreen />} />
        <Route path="/shift" element={<ShiftScreen />} />
        <Route path="/sell" element={<SalesScreen />} />
        <Route path="/entry" element={<EntryScreen />} />
        <Route path="/count" element={<CountScreen />} />
        <Route path="/cash" element={<CashScreen />} />
        <Route path="/finances" element={<FinancesScreen />} />
        <Route path="/handoff" element={<HandoffScreen />} />
        <Route path="/dashboard" element={<DashboardScreen />} />
        <Route path="/audit" element={<AuditScreen />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<UsersAdmin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
