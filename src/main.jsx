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

// Recuperacion ante desfase de version (PWA): si falla la carga de un modulo
// diferido (xlsx/jspdf/firebase) es casi siempre porque la app abierta es una
// version vieja y el deploy nuevo reemplazo los archivos (hash distinto).
// Recargamos UNA vez para traer la version vigente; el candado en
// sessionStorage evita un bucle de recargas si el fallo es por falta de red.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'chunkReloadAt'
  const last = Number(sessionStorage.getItem(KEY) || 0)
  if (Date.now() - last < 60_000) return // ya recargamos hace <1 min: no insistir
  sessionStorage.setItem(KEY, String(Date.now()))
  event.preventDefault() // evita que el error se propague: vamos a recargar
  window.location.reload()
})

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
