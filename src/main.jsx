import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fuente Manrope empaquetada (offline-first: no depende de Google Fonts).
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import App from './App.jsx'
import { ensureSeed } from './db/seed'
import { requestPersistentStorage } from './lib/storage'
import { installErrorLogging } from './lib/errorLog'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/global.css'

// Bloque 33: captura global de errores (window/promesas) al log local.
installErrorLogging()

// Bloque 32.1: pedimos proteccion del almacenamiento cuanto antes para que el
// navegador no pueda desalojar IndexedDB (ahi vive TODO el negocio). No
// bloquea el arranque; el estado se consulta y muestra en Respaldo/Ajustes.
requestPersistentStorage()

// Garantizamos la config minima antes de pintar la UI.
ensureSeed().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
})
