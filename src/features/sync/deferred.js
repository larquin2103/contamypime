// ---------------------------------------------------------------------------
// Bajada diferida por marca de llegada (spec 2026-09-24-reduccion-cuota).
// MODULO PURO: sin Dexie, sin Firestore, sin React. Todo lo externo se inyecta,
// asi que se prueba entero con node. El cableado vive en pushEngine/pullEngine/
// syncEngine/SyncProvider. Mismo patron que compareResend.js.
// ---------------------------------------------------------------------------

// Colecciones que llevan el sello `_up`. SON SOLO ESTAS DOS, y ampliarlas exige
// medir antes: mientras el eco del §10.4 siga ahi, cada resubida de una fila
// sellada lleva un _up nuevo y cuesta una lectura en los demas aparatos.
export const SEALED = ['stockMovements', 'sales']
export const isSealed = (name) => SEALED.includes(name)

// El sello va DESPUES de serializar. JSON.stringify(serverTimestamp()) da
// {"_methodName":"serverTimestamp"} (ejecutado, §10.2): puesto antes, en la nube
// quedaria un MAPA inerte, y un mapa no entra en ningun filtro de rango. Ademas
// asi pisa cualquier _up que un build viejo hubiera guardado en Dexie.
export function seal(name, plain, sentinel) {
  if (!isSealed(name)) return plain
  return { ...plain, _up: sentinel() }
}

// `_up` puede llegar de cuatro formas: Timestamp del SDK, Timestamp plano
// ({seconds,nanoseconds}) cuando viene serializado, Date, o AUSENTE (documento
// que subio un build viejo). Devuelve milisegundos o null. NUNCA NaN: un NaN en
// el cursor lo envenena para siempre y la coleccion deja de bajar en silencio.
export function upToMillis(v) {
  if (v == null) return null
  if (typeof v.toMillis === 'function') {
    const ms = v.toMillis()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof v.seconds === 'number') {
    const ms = v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6)
    return Number.isFinite(ms) ? ms : null
  }
  if (v instanceof Date) {
    const ms = v.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof v === 'string') {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

// P2: quita `_up` antes de que la tanda entre en Dexie (no viaja en respaldos ni
// se resube) y devuelve el maximo visto, que es lo unico que se conserva de el.
export function stripUp(docs) {
  let maxUpMs = null
  const out = docs.map((d) => {
    const ms = upToMillis(d?._up)
    if (ms != null && (maxUpMs == null || ms > maxUpMs)) maxUpMs = ms
    if (d && '_up' in d) {
      const copia = { ...d }
      delete copia._up
      return copia
    }
    return d
  })
  return { docs: out, maxUpMs }
}

// El cursor va atado al NEGOCIO: unlinkDevice no limpia syncState (solo apaga el
// flag), asi que un cursor de otro negocio dejaria huecos permanentes en este.
//
// Se llama `pullCursorKey` y no `cursorKey` a proposito: en pushEngine.js ya hay
// un `cursorKey` que significa otra cosa (`push:<coleccion>`), y ese fichero
// tambien importa de aqui.
export const pullCursorKey = (businessId, name) => `pull:${businessId}:${name}`

// EL TIPO DEL CURSOR (hallazgo H-A del §10.5, el critico). Se GUARDA como texto
// ISO —la convencion de la casa, legible en syncState— y se USA en milisegundos.
// parseCursor devuelve SIEMPRE un numero o null, para que sea imposible pasarle
// una cadena al `where`: Firestore ordena primero por TIPO (Timestamp=3,
// String=5), asi que comparar un Timestamp contra una cadena devuelve CERO
// documentos, sin error y para siempre.
export function parseCursor(stored) {
  if (typeof stored !== 'string' || !stored) return null
  const ms = Date.parse(stored)
  return Number.isFinite(ms) ? ms : null
}

export function formatCursor(ms) {
  return new Date(ms).toISOString()
}

// Solapamiento deliberado: Firestore no garantiza entregar en orden de `_up`, y
// el limite de la consulta es ESTRICTO (>), asi que sin margen se perderia el
// documento que empate al milisegundo. Con la hora del SERVIDOR ya no hay relojes
// de telefono que cubrir: basta con superar el plazo de un commit (60 s).
export const CURSOR_MARGIN_MS = 120000

// El cursor avanza SOLO si la respuesta vino del servidor de ESA coleccion, y
// NUNCA retrocede.
export function nextCursor({ prevMs, maxUpMs, fromServer }) {
  const base = Number.isFinite(prevMs) ? prevMs : null
  if (!fromServer || maxUpMs == null) return base
  const candidato = maxUpMs - CURSOR_MARGIN_MS
  if (base == null) return candidato
  return candidato > base ? candidato : base
}
