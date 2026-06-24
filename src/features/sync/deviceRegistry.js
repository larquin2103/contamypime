import { getFirebase } from '../../lib/firebase'
import { configRepo } from '../../repositories/configRepo'
import { newId } from '../../lib/ids'

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
  await setDoc(
    doc(devicesCol, deviceId),
    {
      deviceId,
      name: prev?.name || deviceLabel(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent || '' : '',
      active: true,
      linkedAt: prev?.linkedAt || serverTimestamp(),
      lastSeenAt: serverTimestamp()
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
  }
}
