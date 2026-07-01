import { Routes, Route, Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { usersRepo } from '../repositories/usersRepo'
import { useAuth } from './providers/AuthProvider'
import { useLicense } from './providers/LicenseProvider'
import { Layout } from '../components/Layout'
import { ActivationScreen } from '../features/license/ActivationScreen'
import { Onboarding } from '../features/auth/Onboarding'
import { Login } from '../features/auth/Login'
import { Home } from '../features/home/Home'
import { Catalog } from '../features/products/Catalog'
import { PriceScreen } from '../features/products/PriceScreen'
import { ImportScreen } from '../features/import/ImportScreen'
import { ShiftScreen } from '../features/shifts/ShiftScreen'
import { SalesScreen } from '../features/sales/SalesScreen'
import { EntryScreen } from '../features/inventory/EntryScreen'
import { TransferScreen } from '../features/inventory/TransferScreen'
import { CountScreen } from '../features/inventory/CountScreen'
import { CashScreen } from '../features/cash/CashScreen'
import { FinancesScreen } from '../features/cash/FinancesScreen'
import { HandoffScreen } from '../features/handoff/HandoffScreen'
import { DashboardScreen } from '../features/dashboard/DashboardScreen'
import { AuditScreen } from '../features/audit/AuditScreen'
import { ReportsScreen } from '../features/reports/ReportsScreen'
import { CloudScreen } from '../features/sync/CloudScreen'
import { Settings } from '../features/settings/Settings'
import { UsersAdmin } from '../features/auth/UsersAdmin'
import { HelpScreen } from '../features/help/HelpScreen'

// Decide que mostrar segun el estado:
//  - sin licencia valida   -> Activacion (compuerta: ni se crea dueño ni se entra)
//  - sin usuarios          -> Onboarding (crear dueño)
//  - usuarios pero sin sesion -> Login
//  - con sesion            -> app (Layout + rutas)
export function AppRouter() {
  const userCount = useLiveQuery(() => usersRepo.count(), [])
  const { user } = useAuth()
  const license = useLicense()

  if (!license.ready || userCount === undefined) {
    return <div className="screen screen--centered"><p className="muted">Cargando…</p></div>
  }
  // Compuerta de activacion: sin licencia firmada y vigente, la app no abre.
  if (!license.unlocked) return <ActivationScreen />
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
        <Route path="/transfer" element={<TransferScreen />} />
        <Route path="/count" element={<CountScreen />} />
        <Route path="/cash" element={<CashScreen />} />
        <Route path="/finances" element={<FinancesScreen />} />
        <Route path="/handoff" element={<HandoffScreen />} />
        <Route path="/dashboard" element={<DashboardScreen />} />
        <Route path="/audit" element={<AuditScreen />} />
        <Route path="/reports" element={<ReportsScreen />} />
        <Route path="/cloud" element={<CloudScreen />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<UsersAdmin />} />
        <Route path="/help" element={<HelpScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
