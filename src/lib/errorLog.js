import { errorsRepo } from '../repositories/errorsRepo'
import { version as appVersion } from '../../package.json'

// Bloque 33 - Captura global de errores hacia el registro local (Dexie).
// Convierte "se me trabo" en un reporte diagnostico consultable en Ajustes.

// Anti-inundacion: un mismo mensaje se registra una vez por sesion y hay un
// tope total (un error dentro de un bucle de render puede disparar cientos).
const seen = new Set()
let budget = 25

export function logError(source, error, extra = {}) {
  try {
    const message = error?.message || String(error)
    const key = `${source}:${message}`
    if (budget <= 0 || seen.has(key)) return
    seen.add(key)
    budget -= 1
    errorsRepo.add({
      source,
      message,
      stack: error?.stack || '',
      route: window.location?.pathname || '',
      appVersion,
      ...extra
    })
  } catch { /* jamas tumbar la app por registrar */ }
}

// Instala los capturadores globales (llamar UNA vez, en el arranque).
export function installErrorLogging() {
  window.addEventListener('error', (e) => {
    logError('window', e.error || e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    logError('promise', e.reason)
  })
}
