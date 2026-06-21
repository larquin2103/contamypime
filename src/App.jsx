import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './app/providers/AuthProvider'
import { CurrencyProvider } from './app/providers/CurrencyProvider'
import { AppRouter } from './app/router'

export default function App() {
  return (
    <AuthProvider>
      <CurrencyProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </CurrencyProvider>
    </AuthProvider>
  )
}
