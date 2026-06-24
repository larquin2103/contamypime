import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fuente Manrope empaquetada (offline-first: no depende de Google Fonts).
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
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
