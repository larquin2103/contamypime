import { getFirebase } from '../../lib/firebase'
import { configRepo } from '../../repositories/configRepo'
import { newId } from '../../lib/ids'
import { logSyncEvent } from '../../lib/syncLog'
import { ranLegacyBuild } from './deferred'

// ---------------------------------------------------------------------------
// Fase 5 - Bloque 31: registro de dispositivos por negocio y limite de la
// licencia (maxDispositivos).
//
// Cada dispositivo tiene un id estable local ('deviceId', config LOCAL). Al
// vincularse se registra en /businesses/{businessId}/devices/{deviceId}. El
// limite de dispositivos viene de la licencia del dueño y se guarda en el doc
// del negocio (maxDispositivos). "Quitar" un dispositivo es borrado logico
// (active:false) para respetar el modelo append-only de Firestore.
// ---------------------------------------------------------------------------

const DEVICE_ID_KEY = 'deviceId'

// Capacidades de ESTE build. `up` dice "yo sello lo que subo". La bajada
// filtrada no se enciende en NINGUN aparato hasta que todos lo publican
// (spec 2026-09-24-reduccion-cuota, D2). Viaja dentro del setDoc que ya se
// hacia, asi que no cuesta ni una lectura ni una escritura mas.
const CAPS = { up: 1 }

// Id estable de ESTE dispositivo (se genera una vez y se guarda local).
export async function getDeviceId() {
  let id = await configRepo.get(DEVICE_ID_KEY, null)
  if (!id) {
    id = newId()
    await configRepo.set(DEVICE_ID_KEY, id)
  }
  return id
}

// Nombre legible aproximado del dispositivo (para que el dueño los distinga).
export function deviceLabel() {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '').toLowerCase()
  if (/android/.test(ua)) return 'Teléfono Android'
  if (/iphone|ipad|ipod/.test(ua)) return 'iPhone/iPad'
  if (/windows/.test(ua)) return 'PC Windows'
  if (/macintosh|mac os/.test(ua)) return 'Mac'
  if (/linux/.test(ua)) return 'PC Linux'
  return 'Dispositivo'
}

// Decision PURA del limite (testeable sin Firestore). Reservar una "ranura":
//  - si el dispositivo ya esta registrado y activo, no consume ranura nueva.
//  - sin limite (max 0/null) siempre se permite.
export function evaluateSlot({ activeDeviceIds = [], deviceId, max = 0 }) {
  const already = activeDeviceIds.includes(deviceId)
  const count = already ? activeDeviceIds.length : activeDeviceIds.length + 1
  const limit = Number(max) || 0
  const allowed = already || !limit || count <= limit
  return { allowed, already, count, max: limit }
}

// Lee maxDispositivos del doc del negocio (lo escribe el dueño al crear cuenta).
async function readBusinessMax(fs, businessId, deps) {
  const { doc, getDoc } = deps
  const snap = await getDoc(doc(fs, 'businesses', businessId))
  return Number(snap.data()?.maxDispositivos || 0)
}

// Registra/actualiza ESTE dispositivo. Con enforce=true aplica el limite y
// lanza un error (code 'device/limit') si se excede; con enforce=false solo
// hace upsert (para que los ya vinculados aparezcan en la lista).
export async function registerThisDevice(fs, businessId, { enforce = false } = {}) {
  const fsm = await import('firebase/firestore')
  const { doc, getDocs, collection, setDoc, serverTimestamp } = fsm
  const deviceId = await getDeviceId()
  const devicesCol = collection(fs, 'businesses', businessId, 'devices')

  const snap = await getDocs(devicesCol)
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const active = all.filter((d) => d.active !== false)
  const activeDeviceIds = active.map((d) => d.id)
  const max = await readBusinessMax(fs, businessId, fsm)

  const slot = evaluateSlot({ activeDeviceIds, deviceId, max })
  if (enforce && !slot.allowed) {
    const err = new Error(
      `Límite de dispositivos alcanzado (${max}). Quita otro dispositivo desde Sincronización antes de añadir este.`
    )
    err.code = 'device/limit'
    throw err
  }

  const prev = all.find((d) => d.id === deviceId)
  // Si en este aparato corrio un build que NO sella despues de la ultima vez que
  // sello, se anota la hora del SERVIDOR: lo que ese build subio va sin `_up` y
  // ninguna consulta filtrada lo devolveria, asi que los aparatos que ya
  // filtraban tienen que volver al tiempo real y rellenar el hueco.
  const corrioViejo = ranLegacyBuild(prev)
  await setDoc(
    doc(devicesCol, deviceId),
    {
      deviceId,
      name: prev?.name || deviceLabel(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent || '' : '',
      active: true,
      linkedAt: prev?.linkedAt || serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      caps: CAPS,
      sealSeenAt: serverTimestamp(),
      ...(corrioViejo ? { legacyAt: serverTimestamp() } : {})
    },
    { merge: true }
  )
  return { deviceId, count: slot.count, max }
}

// Lista de dispositivos activos del negocio (para el panel del dueño).
export async function listDevices() {
  const { db: fs, auth } = await getFirebase()
  if (!auth.currentUser) return []
  const businessId = auth.currentUser.uid
  const { collection, getDocs } = await import('firebase/firestore')
  const snap = await getDocs(collection(fs, 'businesses', businessId, 'devices'))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.active !== false)
    .sort((a, b) => (a.linkedAt?.seconds || 0) - (b.linkedAt?.seconds || 0))
}

// Quitar un dispositivo (borrado logico). Libera una ranura del limite.
export async function removeDevice(deviceId) {
  const { db: fs, auth } = await getFirebase()
  if (!auth.currentUser) return
  const businessId = auth.currentUser.uid
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore')
  await setDoc(
    doc(fs, 'businesses', businessId, 'devices', deviceId),
    { active: false, removedAt: serverTimestamp() },
    { merge: true }
  )
}

// Upsert best-effort de este dispositivo (al haber sesion de nube), sin limite.
export async function touchThisDevice() {
  try {
    const { db: fs, auth } = await getFirebase()
    if (!auth.currentUser) return
    await registerThisDevice(fs, auth.currentUser.uid, { enforce: false })
  } catch (e) {
    console.warn('[devices] touch', e?.code || e?.message)
    logSyncEvent('registro-aparato', null, e)
  }
}

// Lista CRUDA de dispositivos (la usa la guarda de la bajada diferida). A
// diferencia de `listDevices`, no filtra ni ordena: la guarda necesita ver
// tambien los retirados para decidir, y decide ella.
//
// Hace su PROPIO getDocs y no reusa el de `registerThisDevice` a proposito: ese
// se lee ANTES de escribir `caps`, asi que este aparato no se veria a si mismo
// sellando y la guarda no pasaria nunca. Cuesta N filas (los aparatos del
// negocio) por arranque.
//
// Devuelve [] si no hay sesion o si falla: la guarda lee la lista vacia como
// "no filtrar", que es el lado seguro.
export async function readDevices() {
  try {
    const { db: fs, auth } = await getFirebase()
    if (!auth.currentUser) return []
    const { collection, getDocs } = await import('firebase/firestore')
    const snap = await getDocs(collection(fs, 'businesses', auth.currentUser.uid, 'devices'))
    // Si la respuesta vino de la CACHE, no sirve para decidir: Firestore no lanza
    // cuando el servidor no responde, sirve la foto de hace dias y resuelve igual.
    // Con esa foto todos parecerian al dia y se empezaria a filtrar sin haberle
    // preguntado nunca al servidor. La guarda lee la lista vacia como "no filtrar".
    if (snap.metadata.fromCache) return []
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (e) {
    logSyncEvent('guarda-dispositivos', null, e)
    return []
  }
}
