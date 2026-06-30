// ---------------------------------------------------------------------------
// Bloqueo anti-fuerza-bruta para el PIN (4 digitos) y el codigo de
// recuperacion. Es DE DISPOSITIVO: vive en localStorage (sobrevive recargas,
// no viaja a la nube) para que recargar la pagina no reinicie el contador.
//
// Politica: unos intentos "gratis"; a partir de ahi, retardo creciente entre
// intentos (30s, 1m, 2m, 5m, tope 10m). El contador solo se reinicia tras un
// acierto. Esto convierte la fuerza bruta de 10.000 combinaciones en algo
// inviable en la practica sin afectar al uso normal.
// ---------------------------------------------------------------------------

const PREFIX = 'mc_lock_'
const FREE_ATTEMPTS = 4
// Retardo (ms) segun cuantos fallos lleva ya por encima del cupo gratis.
const BACKOFF = [30_000, 60_000, 120_000, 300_000, 600_000]

function read(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : { fails: 0, until: 0 }
  } catch {
    return { fails: 0, until: 0 }
  }
}

function write(key, state) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(state))
  } catch {
    /* almacenamiento lleno o no disponible: el bloqueo es best-effort */
  }
}

// Milisegundos que faltan para poder reintentar (0 si no esta bloqueado).
export function lockRemaining(key) {
  const { until } = read(key)
  const left = until - Date.now()
  return left > 0 ? left : 0
}

// Registra un intento fallido y devuelve los ms de espera resultantes (0 si aun
// quedan intentos gratis).
export function recordFail(key) {
  const s = read(key)
  s.fails += 1
  const over = s.fails - FREE_ATTEMPTS
  if (over > 0) {
    const wait = BACKOFF[Math.min(over - 1, BACKOFF.length - 1)]
    s.until = Date.now() + wait
  }
  write(key, s)
  return lockRemaining(key)
}

// Limpia el contador tras un acierto.
export function clearFails(key) {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* ignore */
  }
}

// Texto legible para la espera ("45 s" / "3 min").
export function formatWait(ms) {
  const s = Math.ceil(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.ceil(s / 60)} min`
}
