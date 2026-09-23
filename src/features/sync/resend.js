import { syncTs } from './collections.js'

// ---------------------------------------------------------------------------
// Reenvio forzado de una coleccion (auditoria Burger Premium, H3-a).
//
// El cursor de subida (`push:<col>`) salta al maximo del lote y nunca retrocede:
// una fila que quedo POR DEBAJO sin llegar a la nube no se vuelve a subir jamas.
// Esto permite al dueno retroceder ese cursor a una fecha y reusar la subida de
// siempre. SOLO para libros INMUTABLES: pushEngine sube con batch.set, que pisa
// el documento de la nube sin comparar marcas; reenviar una fila MUTABLE desde
// una copia atrasada devolveria la nube a una version vieja. Una fila que nunca
// cambia no puede regresar a nada. Verificado: estas cuatro no tienen ni un
// update/put/modify/delete en src/ (salvo el bulkPut de filas identicas del traspaso).
// ---------------------------------------------------------------------------
export const RESENDABLE = ['stockMovements', 'productions', 'purchases', 'transfers']

export const isResendable = (name) => RESENDABLE.includes(name)

const validIso = (s) => typeof s === 'string' && s !== '' && !Number.isNaN(Date.parse(s))

// Cuantas filas subiria doPush con el cursor en `sinceIso`: MISMO predicado que
// pushEngine (syncTs(r) > cursor, estricto), para que la cifra que ve el dueno
// sea la que se va a gastar de la cuota.
export function countSince(rows, sinceIso) {
  let n = 0
  for (const r of rows) {
    const ts = syncTs(r)
    if (ts && ts > (sinceIso || '')) n++
  }
  return n
}

// Nuevo valor del cursor, o null si no hay que tocarlo. Solo RETROCEDE: avanzar
// es cosa de setCursorForward, y un cursor vacio ya lo sube todo.
export function rewindTo(current, sinceIso) {
  if (!validIso(sinceIso)) return null
  if (!current) return null
  return sinceIso < current ? sinceIso : null
}

// El campo <input type="datetime-local"> da hora LOCAL del aparato; el cursor es
// ISO UTC (now() = toISOString). Confundirlos corre el corte 4 h en Cuba (§9.8).
export function localInputToIso(value) {
  if (!value) return null
  const t = new Date(value)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}
