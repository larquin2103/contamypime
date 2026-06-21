import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './app/providers/AuthProvider'
import { CurrencyProvider } from './app/providers/CurrencyProvider'
import { ShiftProvider } from './app/providers/ShiftProvider'
import { AppRouter } from './app/router'

export default function App() {
  return (
    <AuthProvider>
      <CurrencyProvider>
        <ShiftProvider>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </ShiftProvider>
      </CurrencyProvider>
    </AuthProvider>
  )
}
