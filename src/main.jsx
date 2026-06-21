import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ensureSeed } from './db/seed'
import './styles/global.css'

// Garantizamos la config minima antes de pintar la UI.
ensureSeed().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
