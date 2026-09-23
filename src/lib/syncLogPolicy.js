// ---------------------------------------------------------------------------
// Politica del registro de la SINCRONIZACION (La Patrona §14.5). PURA.
//
// Hasta ahora los fallos de la sync solo iban a console.warn, que en el telefono
// no ve nadie y se pierde al cerrar la app: por eso las dos auditorias de La
// Patrona tuvieron que INFERIR el mecanismo. Esto decide QUE se guarda en el
// registro local (/errors) sin inundarlo:
//  - una entrada por etapa + coleccion + codigo y SESION: los ciclos de 20/45 s
//    repiten el mismo fallo y no deben ocupar el registro;
//  - presupuesto PROPIO (30), aparte de los 25 de logError: si no, los avisos de
//    la sync se comerian el hueco de los errores de pantalla;
//  - la clave nunca lleva el detalle (ids, fechas), que cambia en cada ciclo y
//    romperia la deduplicacion.
// ---------------------------------------------------------------------------

export function createSyncGate({ budget = 30 } = {}) {
  const seen = new Set()
  let left = budget
  return {
    shouldLog(key) {
      if (left <= 0 || seen.has(key)) return false
      seen.add(key)
      left -= 1
      return true
    },
    left: () => left
  }
}

export const syncKey = (stage, col, code) => `${stage}|${col || '-'}|${code || '-'}`

// Codigo estable del error: el de Firestore (`e.code`) si lo trae; si no, un
// prefijo del mensaje, para que el mismo fallo de siempre deduplique.
export function codeOf(error) {
  if (error?.code) return String(error.code)
  const msg = error?.message || (typeof error === 'string' ? error : '')
  return msg ? String(msg).slice(0, 60) : 'desconocido'
}

// Mensaje legible para /errors. errorsRepo lo recorta a 500 y descarta cualquier
// campo extra: todo lo util tiene que ir aqui dentro.
export function syncMessage(stage, col, code, detail) {
  const head = [stage, col, code].filter(Boolean).join(' ')
  return (detail ? `${head}: ${detail}` : head).slice(0, 480)
}
