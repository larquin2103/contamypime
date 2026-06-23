import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './app/providers/AuthProvider'
import { CurrencyProvider } from './app/providers/CurrencyProvider'
import { ShiftProvider } from './app/providers/ShiftProvider'
import { SyncProvider } from './app/providers/SyncProvider'
import { AppRouter } from './app/router'

export default function App() {
  return (
    <AuthProvider>
      <CurrencyProvider>
        <ShiftProvider>
          <SyncProvider>
            <BrowserRouter>
              <AppRouter />
            </BrowserRouter>
          </SyncProvider>
        </ShiftProvider>
      </CurrencyProvider>
    </AuthProvider>
  )
}
