// ---------------------------------------------------------------------------
// Vigilante de lotes de subida (La Patrona §14.5, commit 2). PURO: el reloj, la
// red y el registro se inyectan.
//
// La hipotesis de la perdida de filas es un batch.commit() que NUNCA se resuelve
// ni se rechaza: no hay error que registrar, el .catch no corre, la fila no entra
// en la cola y el cursor ya avanzo. Esto no lo arregla (eso es H3-c): lo hace
// VISIBLE en /errors.
//  - 'subida-sin-confirmar': lotes que llevan `timeoutMs` sin confirmarse EN LINEA.
//  - 'subida-confirmada-tarde': esos mismos lotes, cuando por fin se confirman o fallan.
// Cada etapa deja UN aviso por ronda con TODAS las colecciones (revision): si se
// atasca el conducto, se atasca todo a la vez, y con un aviso por coleccion el tope
// del registro escondia justo las que importan (stockMovements, purchases...).
// Sin red, quedar pendiente es lo normal: no avisa, pero se REARMA (revision), y
// tras reconectar concede una ventana mas antes de avisar, para no marcar un lote
// que acaba de volver.
//
// Garantias para doPush, que es quien lo llama:
//  - devuelve LA MISMA promesa que recibe (===): su .then/.catch no cambia;
//  - lo suyo va por un ramal APARTE, que maneja su propio rechazo;
//  - nunca lanza: ante cualquier fallo interno, devuelve la promesa tal cual.
// Limites: los temporizadores viven en memoria (si la app se cierra, ese lote no
// deja rastro); navigator.onLine solo dice que hay interfaz de red, no internet.
// ---------------------------------------------------------------------------

// Une `parts` detras de `head` sin pasar de `max`; si no caben todas, lo dice.
function joinCapped(head, parts, max) {
  let out = head
  for (let i = 0; i < parts.length; i++) {
    const sep = i ? ', ' : ''
    const tail = ` (+${parts.length - i} mas)`
    if ((out + sep + parts[i]).length + (i < parts.length - 1 ? tail.length : 0) > max) return out + tail
    out += sep + parts[i]
  }
  return out
}

// Resumen de una ronda de lotes atascados: cuantas colecciones y filas, el rango
// de marcas (el que hay que pedir al reenviar) y `coleccion:filas` de cada una.
export function roundSummary(items, max = 440) {
  const list = Array.isArray(items) ? items : []
  let rows = 0
  let first = ''
  let last = ''
  for (const it of list) {
    rows += it.rows || 0
    if (it.first && (!first || it.first < first)) first = it.first
    if (it.last && it.last > last) last = it.last
  }
  return joinCapped(`${list.length} coleccion(es), ${rows} fila(s), ${first}..${last}: `, list.map((it) => `${it.col}:${it.rows}`), max)
}

export function createCommitWatch({
  timeoutMs = 120000,
  flushMs = 2000,
  maxRearms = 30,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  log = () => {}
} = {}) {
  const buf = { stuck: [], late: [] }
  let flushTimer = null
  const flush = () => {
    flushTimer = null
    const stuck = buf.stuck
    const late = buf.late
    buf.stuck = []
    buf.late = []
    try {
      if (stuck.length) log('subida-sin-confirmar', null, { code: 'en-linea' }, roundSummary(stuck))
      if (late.length) log('subida-confirmada-tarde', null, { code: 'lotes' }, joinCapped(`${late.length} lote(s): `, late, 440))
    } catch { /* nunca lanza */ }
  }
  const queue = (kind, item) => {
    buf[kind].push(item)
    if (!flushTimer) flushTimer = setTimer(flush, flushMs)
  }

  return function watch(col, slice, promise) {
    try {
      if (!promise || typeof promise.then !== 'function') return promise
      const s = Array.isArray(slice) ? slice : []
      const start = now()
      let settled = false
      let warned = false
      let wasOffline = false
      let rearms = 0
      let timer = null
      // El ramal aparte va PRIMERO: si `then` lanzara, no queda ningun temporizador suelto.
      promise.then(() => settle('ok'), () => settle('error'))
      const check = () => {
        try {
          if (settled) return
          const online = isOnline()
          if (!online || wasOffline) {
            wasOffline = !online
            if (rearms < maxRearms) { rearms += 1; timer = setTimer(check, timeoutMs) }
            return
          }
          warned = true
          queue('stuck', { col, rows: s.length, first: s[0]?.ts || '', last: s[s.length - 1]?.ts || '' })
        } catch { /* nunca lanza */ }
      }
      function settle(code) {
        try {
          settled = true
          clearTimer(timer)
          if (warned) queue('late', `${col}:${code} (${Math.round((now() - start) / 1000)} s)`)
        } catch { /* nunca lanza */ }
      }
      timer = setTimer(check, timeoutMs)
      return promise
    } catch {
      return promise
    }
  }
}
