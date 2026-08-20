import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './app/providers/AuthProvider'
import { CurrencyProvider } from './app/providers/CurrencyProvider'
import { ShiftProvider } from './app/providers/ShiftProvider'
import { SyncProvider } from './app/providers/SyncProvider'
import { LicenseProvider } from './app/providers/LicenseProvider'
import { NotificationProvider } from './app/providers/NotificationProvider'
import { AppRouter } from './app/router'

export default function App() {
  return (
    <AuthProvider>
      <CurrencyProvider>
        <ShiftProvider>
          <SyncProvider>
            <NotificationProvider>
              <LicenseProvider>
                <BrowserRouter>
                  <AppRouter />
                </BrowserRouter>
              </LicenseProvider>
            </NotificationProvider>
          </SyncProvider>
        </ShiftProvider>
      </CurrencyProvider>
    </AuthProvider>
  )
}
