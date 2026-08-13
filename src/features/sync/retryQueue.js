// ---------------------------------------------------------------------------
// Bloque C (diseno B) - Cola de reintentos del PUSH. Modulo PURO: no importa
// Dexie ni Firebase, opera sobre listas planas -> testeable con `node` sin
// framework (ver retryQueue.test.mjs). El pushEngine lo usa como maquina de
// estados; la persistencia (syncState) y la red viven alla.
//
// Entrada de la cola: { id, attempts, lastAttemptAt, lastErrorCode, state }
//   state: 'active'  -> reintentando con backoff
//          'paused'  -> RETRY_EXHAUSTED (transitorio agotado) o error permanente
//                       NO es "dato invalido": queda recuperable.
// Solo se elimina de la cola al CONFIRMAR (onSuccess). El cursor no interviene:
// los pendientes se rescatan por ID.
// ---------------------------------------------------------------------------

// Codigos de Firestore que NO tiene sentido reintentar en bucle (permanentes).
export const PERMANENT = new Set(['permission-denied', 'invalid-argument', 'failed-precondition'])

export const MAX_ATTEMPTS = 8          // tras esto, un transitorio pasa a PAUSED
export const BASE_MS = 5000            // backoff base
export const CAP_MS = 300000           // tope del backoff (5 min)
export const RESUME_COOLDOWN_MS = 600000 // reactivar un PAUSED transitorio tras 10 min

export const isPermanent = (code) => PERMANENT.has(String(code || ''))

// Backoff exponencial acotado: 5s, 10s, 20s, ... hasta CAP.
export const backoffMs = (attempts) =>
  Math.min(BASE_MS * 2 ** Math.max(0, (Number(attempts) || 0) - 1), CAP_MS)

const find = (list, id) => list.find((e) => e.id === id)
const without = (list, id) => list.filter((e) => e.id !== id)
const upsert = (list, entry) => [...without(list, entry.id), entry]

// IDs ACTIVE cuyo backoff ya vencio (elegibles para reintentar).
export function dueIds(list, now) {
  return list
    .filter((e) => e.state === 'active' && now >= (e.lastAttemptAt || 0) + backoffMs(e.attempts))
    .map((e) => e.id)
}

// Marca el intento (throttlea el proximo aunque el resultado quede pendiente,
// p.ej. offline). Solo afecta a entradas ACTIVE.
export function markAttempted(list, ids, now) {
  const set = new Set(ids)
  return list.map((e) => (set.has(e.id) && e.state === 'active' ? { ...e, lastAttemptAt: now } : e))
}

// Confirmado en la nube -> sale de la cola (unico camino de eliminacion).
export function onSuccess(list, id) {
  return without(list, id)
}

// Fallo TRANSITORIO -> attempts++. Al llegar a MAX pasa a PAUSED (RETRY_EXHAUSTED),
// pero NO se marca como invalido (state 'paused', no se borra). Devuelve
// { list, exhausted } para que el llamador registre el diagnostico si se agoto.
export function onTransient(list, id, code, now) {
  const cur = find(list, id) || { id, attempts: 0, state: 'active' }
  const attempts = (cur.attempts || 0) + 1
  const exhausted = attempts >= MAX_ATTEMPTS
  const entry = {
    id,
    attempts,
    lastAttemptAt: now,
    lastErrorCode: String(code || ''),
    state: exhausted ? 'paused' : 'active'
  }
  return { list: upsert(list, entry), exhausted }
}

// Fallo PERMANENTE -> PAUSED permanente. No se auto-reactiva (solo resumeAll).
export function onPermanent(list, id, code, now) {
  return upsert(list, {
    id,
    attempts: find(list, id)?.attempts || 0,
    lastAttemptAt: now,
    lastErrorCode: String(code || ''),
    state: 'paused'
  })
}

// Auto-reanudacion por cool-down: reactiva SOLO los PAUSED de clase TRANSITORIA.
// El PAUSED permanente queda intacto (condicion: no se auto-reactiva).
export function autoResume(list, now) {
  return list.map((e) =>
    e.state === 'paused' && !isPermanent(e.lastErrorCode) && now >= (e.lastAttemptAt || 0) + RESUME_COOLDOWN_MS
      ? { ...e, state: 'active', attempts: 0, lastAttemptAt: 0 }
      : e
  )
}

// Reanudacion EXPLICITA: reactiva TODOS los PAUSED (incluye permanentes). Pensada
// para un disparo manual tras corregir la causa (datos/reglas).
export function resumeAll(list) {
  return list.map((e) => (e.state === 'paused' ? { ...e, state: 'active', attempts: 0, lastAttemptAt: 0 } : e))
}
