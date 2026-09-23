// ---------------------------------------------------------------------------
// Vigilante de lotes de subida (La Patrona §14.5, commit 2). PURO: el reloj, la
// red y el registro se inyectan.
//
// La hipotesis de la perdida de filas es un batch.commit() que NUNCA se resuelve
// ni se rechaza: no hay error que registrar, el .catch no corre, la fila no entra
// en la cola y el cursor ya avanzo. Esto no lo arregla (eso es H3-c): lo hace
// VISIBLE en /errors. Si un lote lleva `timeoutMs` sin confirmarse estando EN
// LINEA, deja 'subida-sin-confirmar'; si despues se confirma o falla, deja
// 'subida-confirmada-tarde'. Sin red, quedar pendiente es lo normal: no avisa.
//
// Garantias para doPush, que es quien lo llama:
//  - devuelve LA MISMA promesa que recibe (===): el .then/.catch de doPush
//    queda exactamente como estaba;
//  - lo suyo va por un ramal APARTE, que maneja su propio rechazo;
//  - nunca lanza: ante cualquier fallo interno, devuelve la promesa tal cual.
// Limite conocido: el temporizador vive en memoria. Si la app se cierra antes de
// que venza, ese lote no deja rastro (tampoco lo dejaba antes).
// ---------------------------------------------------------------------------

const range = (slice) => {
  const s = Array.isArray(slice) ? slice : []
  return `${s.length} fila(s) ${s[0]?.ts || ''}..${s[s.length - 1]?.ts || ''}`
}

export function createCommitWatch({
  timeoutMs = 120000,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  log = () => {}
} = {}) {
  return function watch(col, slice, promise) {
    try {
      if (!promise || typeof promise.then !== 'function') return promise
      const start = now()
      let warned = false
      const timer = setTimer(() => {
        try {
          if (!isOnline()) return
          warned = true
          log('subida-sin-confirmar', col, { code: 'en-linea' }, `${range(slice)}, ${Math.round(timeoutMs / 1000)} s`)
        } catch { /* nunca lanza */ }
      }, timeoutMs)
      const settle = (code) => {
        try {
          clearTimer(timer)
          if (warned) log('subida-confirmada-tarde', col, { code }, `${range(slice)}, tras ${Math.round((now() - start) / 1000)} s`)
        } catch { /* nunca lanza */ }
      }
      promise.then(() => settle('ok'), () => settle('error'))
      return promise
    } catch {
      return promise
    }
  }
}
