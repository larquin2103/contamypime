import { getFirebase } from '../../lib/firebase'
import { db } from '../../db/db'
import { syncConfig } from './syncService'
import { SYNC_COLLECTIONS, LOCAL_CONFIG_KEYS, syncTs } from './collections'
import { logError } from '../../lib/errorLog'
import { logSyncEvent } from '../../lib/syncLog'
import { isPermanent, dueIds, markAttempted, onSuccess, onTransient, onPermanent, autoResume } from './retryQueue'
import { isResendable, countSince, rewindTo, waitWhile } from './resend'

// ---------------------------------------------------------------------------
// Fase 4 - Bloque 23 + Bloque C (diseno B): motor de SUBIDA (push).
//
// Por cada coleccion hay un cursor (marca de agua) en `syncState` (`push:<col>`):
// solo se suben los registros cuya marca de sync supera el cursor. El cursor es
// MONOTONO HACIA ADELANTE (nunca retrocede).
//
// Bloque C (robustez ante RECHAZO del servidor). Antes: un lote rechazado se
// perdia o se reintentaba en bucle (poison pill). Ahora:
//  - Los fallos NO se rescatan por el cursor sino por una COLA de reintentos por
//    ID (`retry:<col>` en syncState, LOCAL): cursor y reintentos son mecanismos
//    separados -> ningun pendiente queda oculto bajo el cursor.
//  - Rechazo TRANSITORIO (red/cuota/unauthenticated): el registro va a la cola
//    ACTIVE y se reintenta con backoff; al agotar MAX pasa a PAUSED (recuperable,
//    NO invalido). Auto-reanuda por cool-down.
//  - Rechazo PERMANENTE (permission-denied/invalid-argument/failed-precondition):
//    se AISLA el lote (envio individual) para no perder inocentes; el veneno va a
//    PAUSED permanente + errorLog (diagnostico) y NO se auto-reactiva.
//  - OFFLINE: `commit()` queda PENDIENTE (ni resuelve ni rechaza); no entra a la
//    cola (lo entrega la cache de Firestore al reconectar) -> identico a antes.
//  - CERROJO global: pushChanges no corre concurrente, venga de donde venga
//    (runPush/manualSync/CloudScreen/futuro). MINI-MUTEX por `retry:<col>`:
//    serializa lectura-modificacion-escritura de cada cola (sin esperas
//    indefinidas ni bloqueo offline).
// ---------------------------------------------------------------------------

const BATCH = 400 // limite Firestore: 500 ops por lote
const IMAGE_BATCH = 50 // las imagenes pesan mas: lotes chicos
// Colecciones que llevan FOTO (dataUrl de hasta 40 KB, ver lib/image.js): el limite
// que manda no es el de 500 operaciones sino el de ~10 MiB por peticion. A 400 docs
// serian ~16 MB y el lote se rechazaria; se reenviaria uno a uno (no se pierde nada,
// pero quema escrituras de la cuota). Con lotes de 50 cabe con holgura.
//  - `images`   : miniaturas del modulo 'imagenes'.
//  - `deliveries`/`collections`: comprobante de entrega y de cobro (modulo 'remesas').
const PHOTO_COLLECTIONS = new Set(['images', 'deliveries', 'collections'])
const batchSizeFor = (name) => (PHOTO_COLLECTIONS.has(name) ? IMAGE_BATCH : BATCH)
const cursorKey = (name) => `push:${name}`
const retryKey = (name) => `retry:${name}`

async function getCursor(name) {
  const row = await db.syncState.get(cursorKey(name))
  return row?.value || ''
}
// El cursor NUNCA retrocede: solo se escribe si el valor avanza.
async function setCursorForward(name, value) {
  const cur = await getCursor(name)
  if (value && value > cur) await db.syncState.put({ key: cursorKey(name), value })
}

// Quita undefined (Firestore no lo admite) serializando a JSON plano.
function toCloud(rec) {
  return JSON.parse(JSON.stringify(rec))
}

// --- MINI-MUTEX por retry:<col> -------------------------------------------
// Serializa la lectura-modificacion-escritura de cada cola: cada operacion lee
// la lista fresca de syncState, aplica fn(list)->nuevaLista y persiste, encadenada
// tras la anterior. No hace red -> no cuelga offline ni espera indefinidamente.
// La cadena nunca queda rechazada (un paso que falle se registra y se sigue).
const retryChains = {}
function withRetry(name, fn) {
  const run = async () => {
    const row = await db.syncState.get(retryKey(name))
    const list = Array.isArray(row?.value) ? row.value : []
    const out = await fn(list)
    const newList = Array.isArray(out) ? out : out && out.list
    if (newList) await db.syncState.put({ key: retryKey(name), value: newList })
  }
  const next = (retryChains[name] || Promise.resolve())
    .then(run, run) // corre aunque el paso anterior fallara
    .catch((e) => {
      console.warn('[sync] retry', name, e?.code || e?.message)
      logSyncEvent('cola-reintentos', name, e)
    })
  retryChains[name] = next
  return next
}

// Diagnostico (errorLog local): responsabilidad distinta a `retry` (operacional).
const logSync = (col, id, code, reason) =>
  logError('sync', new Error(`push ${col} ${reason} ${code || ''}: ${id}`))

// --- CERROJO GLOBAL de reentrancia ----------------------------------------
// Garantiza que pushChanges nunca se ejecute concurrentemente, sin importar el
// llamador. Si llega otra invocacion mientras corre, se marca `queued` y se
// relanza al terminar (no se pierde el pedido). No bloquea offline: el cuerpo
// dispara los commits sin esperarlos y termina rapido.
let running = false
let queued = false
export async function pushChanges() {
  if (running) {
    queued = true
    return { queued: 0, skipped: 'in-flight' }
  }
  running = true
  try {
    let res = await doPush()
    while (queued) {
      queued = false
      const r = await doPush()
      res = { queued: (res.queued || 0) + (r.queued || 0), skipped: r.skipped }
    }
    return res
  } finally {
    running = false
  }
}

async function doPush() {
  if (!(await syncConfig.isEnabled())) return { queued: 0, skipped: 'disabled' }
  const businessId = await syncConfig.businessId()
  if (!businessId) return { queued: 0, skipped: 'no-business' }

  const { db: fs, auth } = await getFirebase()
  if (!auth.currentUser) return { queued: 0, skipped: 'no-auth' }
  const { doc, writeBatch, setDoc } = await import('firebase/firestore')

  const now = Date.now()
  const ref = (name, id) => doc(fs, 'businesses', businessId, name, id)
  const ctx = { fs, setDoc, ref }

  let queuedCount = 0
  for (const col of SYNC_COLLECTIONS) {
    const table = db[col.name]
    if (!table) continue

    const cursor = await getCursor(col.name)
    let rows = await table.toArray()
    if (col.name === 'config') rows = rows.filter((r) => !LOCAL_CONFIG_KEYS.has(r.key))
    const rowById = new Map(rows.map((r) => [String(r[col.pk]), r]))

    // NUEVOS: por cursor (marca de agua), ordenados por marca de sync.
    const nuevos = rows
      .map((r) => ({ r, id: String(r[col.pk]), ts: syncTs(r) }))
      .filter((x) => x.ts && x.ts > cursor)
      .sort((a, b) => (a.ts < b.ts ? -1 : 1))
    const changedIds = new Set(nuevos.map((x) => x.id))

    // RETRIES: auto-reanuda transitorios vencidos y calcula los ELEGIBLES por ID
    // (excluye los que ya van como nuevos). Todo serializado por el mini-mutex.
    let due = []
    await withRetry(col.name, (list) => {
      const resumed = autoResume(list, now)
      due = dueIds(resumed, now).filter((id) => !changedIds.has(id))
      return markAttempted(resumed, due, now)
    })

    if (!nuevos.length && !due.length) continue

    // El cursor solo lo mueven los NUEVOS; nunca retrocede.
    let maxTs = cursor
    for (const x of nuevos) if (x.ts > maxTs) maxTs = x.ts

    // 1) NUEVOS -> lotes (como siempre). Sin await: offline queda pendiente.
    const step = batchSizeFor(col.name)
    for (let i = 0; i < nuevos.length; i += step) {
      const slice = nuevos.slice(i, i + step)
      const batch = writeBatch(fs)
      for (const { r, id } of slice) batch.set(ref(col.name, id), toCloud(r))
      batch
        .commit()
        .then(() => withRetry(col.name, (list) => slice.reduce((l, { id }) => onSuccess(l, id), list)))
        .catch((e) => onBatchError(col, slice, e, { ...ctx, now: Date.now() }))
      queuedCount += slice.length
    }

    // 2) RETRIES ACTIVE elegibles -> individuales (salida limpia por registro).
    for (const id of due) {
      const r = rowById.get(id)
      if (!r) {
        await withRetry(col.name, (list) => onSuccess(list, id)) // ya no existe local: sale de la cola
        continue
      }
      setDoc(ref(col.name, id), toCloud(r))
        .then(() => withRetry(col.name, (list) => onSuccess(list, id)))
        .catch((e) => onOneError(col, id, e, Date.now()))
      queuedCount += 1
    }

    await setCursorForward(col.name, maxTs)
  }
  return { queued: queuedCount }
}

// Rechazo de un LOTE de nuevos. Transitorio -> todo el lote a la cola. Permanente
// -> aislar (envio individual) para no perder inocentes; el veneno a PAUSED.
async function onBatchError(col, slice, e, ctx) {
  const code = e?.code || ''
  console.warn('[sync] push', col.name, code || e?.message)
  logSyncEvent('subida-lote-rechazado', col.name, e,
    `${slice.length} fila(s) ${slice[0]?.ts || ''}..${slice[slice.length - 1]?.ts || ''}`)
  if (!isPermanent(code)) {
    await withRetry(col.name, (list) => {
      let l = list
      for (const { id } of slice) {
        const { list: nl, exhausted } = onTransient(l, id, code, ctx.now)
        l = nl
        if (exhausted) logSync(col.name, id, code, 'RETRY_EXHAUSTED')
      }
      return l
    })
    return
  }
  // PERMANENTE: el commit atomico fallo -> los inocentes fallaron solo por
  // compartir lote. Reenviar cada uno por separado para salvarlos.
  const results = await Promise.allSettled(
    slice.map(({ r, id }) => ctx.setDoc(ctx.ref(col.name, id), toCloud(r)))
  )
  await withRetry(col.name, (list) => {
    let l = list
    results.forEach((res, k) => {
      const id = slice[k].id
      if (res.status === 'fulfilled') {
        l = onSuccess(l, id)
        return
      }
      const c = res.reason?.code || ''
      if (isPermanent(c)) {
        logSync(col.name, id, c, 'PAUSED-permanente')
        l = onPermanent(l, id, c, ctx.now)
      } else {
        const { list: nl, exhausted } = onTransient(l, id, c, ctx.now)
        l = nl
        if (exhausted) logSync(col.name, id, c, 'RETRY_EXHAUSTED')
      }
    })
    return l
  })
}

// Resultado de un reintento INDIVIDUAL (registro ya en la cola).
async function onOneError(col, id, e, now) {
  const code = e?.code || ''
  console.warn('[sync] retry', col.name, code || e?.message)
  logSyncEvent('subida-reintento-fallido', col.name, e, id)
  if (isPermanent(code)) {
    logSync(col.name, id, code, 'PAUSED-permanente')
    await withRetry(col.name, (list) => onPermanent(list, id, code, now))
  } else {
    await withRetry(col.name, (list) => {
      const { list: nl, exhausted } = onTransient(list, id, code, now)
      if (exhausted) logSync(col.name, id, code, 'RETRY_EXHAUSTED')
      return nl
    })
  }
}

// --- REENVIO FORZADO (auditoria Burger Premium, H3-a) ------------------------
// Solo lectura: cuantas filas de `name` subiria un reenvio desde `sinceIso`.
export async function countResend(name, sinceIso) {
  if (!isResendable(name)) throw new Error('Esa colección no se puede reenviar')
  return countSince(await db[name].toArray(), sinceIso)
}

// Retrocede `push:<name>` a `sinceIso` y dispara la subida de siempre. Toma el
// MISMO cerrojo que pushChanges: si el retroceso cayera en medio de un doPush,
// su setCursorForward lo desharia en silencio. Reenviar es idempotente
// (batch.set por id de filas que no cambian); lo que cuesta es cuota.
//
// Ronda 1 (hallazgo B): si `rewindTo` no encuentra nada que retroceder (cursor
// vacio, o la fecha pedida ya esta cubierta), esta funcion IGUAL dispara una
// subida normal (el dueno pudo pedir un reenvio que no hacia falta, y esa
// subida de todos modos recoge lo pendiente). Pero el resultado debe decir la
// verdad: `rewound` distingue "de verdad retrocedi el cursor" de "no hizo
// falta, fue una subida normal", para que la pantalla no anuncie un reenvio
// que no ocurrio.
export async function forceResend(name, sinceIso) {
  if (!isResendable(name)) throw new Error('Esa colección no se puede reenviar')
  if (!(await syncConfig.isEnabled())) throw new Error('La sincronización no está activa en este aparato')
  // Revision de la rama (hallazgo 8): si coincide con la subida periodica, ESPERA
  // a que termine (con tope) en vez de fallar. El `while` vuelve a mirar
  // `running` de forma SINCRONA justo antes de tomarlo: entre el fin de la
  // espera y esta linea hay saltos de microtarea por los que otro pushChanges
  // podria haber entrado.
  // Revision 2 (menor 3): el tope es un PLAZO ABSOLUTO para toda la espera, no
  // 15 s nuevos en cada vuelta del `while`.
  const deadline = Date.now() + 15000
  while (running) {
    const left = deadline - Date.now()
    if (left <= 0 || !(await waitWhile(() => running, { timeoutMs: left }))) {
      throw new Error('Hay una subida en curso: reintenta en unos segundos')
    }
  }
  running = true
  let rewound = false
  try {
    const next = rewindTo(await getCursor(name), sinceIso)
    if (next) {
      await db.syncState.put({ key: cursorKey(name), value: next })
      rewound = true
    }
  } finally {
    running = false
  }
  const res = await pushChanges()
  return { ...res, rewound }
}
