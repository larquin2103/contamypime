import { getFirebase } from '../../lib/firebase'
import { configRepo } from '../../repositories/configRepo'

// ---------------------------------------------------------------------------
// Fase 4 - Bloque 22: cuenta de nube del negocio.
//
// Modelo: una sola cuenta de Firebase (email/contraseña) por NEGOCIO. El uid
// de esa cuenta ES el businessId, y todos los datos cuelgan de
// /businesses/{businessId}. Cada dispositivo (dueño o vendedor) inicia sesion
// con esa MISMA cuenta; el PIN local sigue distinguiendo quien opera.
//
//  - Primer dispositivo: createBusinessAccount() crea la cuenta y el negocio.
//  - Otros dispositivos:  linkDevice() inicia sesion en la cuenta existente.
//
// La sesion de Firebase persiste en IndexedDB, asi que tras vincular una vez
// el dispositivo sigue autenticado aunque se quede sin internet.
// ---------------------------------------------------------------------------

const CFG = {
  ENABLED: 'syncEnabled',
  BUSINESS_ID: 'syncBusinessId',
  EMAIL: 'syncEmail'
}

export const syncConfig = {
  async isEnabled() {
    return Boolean(await configRepo.get(CFG.ENABLED, false))
  },
  async businessId() {
    return configRepo.get(CFG.BUSINESS_ID, null)
  },
  async email() {
    return configRepo.get(CFG.EMAIL, null)
  },
  async save({ businessId, email }) {
    await configRepo.set(CFG.BUSINESS_ID, businessId)
    await configRepo.set(CFG.EMAIL, email)
    await configRepo.set(CFG.ENABLED, true)
  },
  async clear() {
    await configRepo.set(CFG.ENABLED, false)
  }
}

// Asegura que existe el documento del negocio (lo "reclama" el dueño).
async function ensureBusinessDoc(db, uid, businessName) {
  const { doc, getDoc, setDoc, serverTimestamp } = await import('firebase/firestore')
  const ref = doc(db, 'businesses', uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      ownerUid: uid,
      name: businessName || 'Mi negocio',
      createdAt: serverTimestamp()
    })
  }
  return ref
}

// Crear la cuenta del negocio (primer dispositivo / dueño).
export async function createBusinessAccount({ email, password, businessName }) {
  const { auth, db } = await getFirebase()
  const { createUserWithEmailAndPassword } = await import('firebase/auth')
  try {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
    const uid = cred.user.uid
    await ensureBusinessDoc(db, uid, businessName)
    await syncConfig.save({ businessId: uid, email: email.trim() })
    return { uid, email: email.trim() }
  } catch (e) {
    throw new Error(authErrorMessage(e))
  }
}

// Vincular este dispositivo a una cuenta de negocio existente.
export async function linkDevice({ email, password }) {
  const { auth, db } = await getFirebase()
  const { signInWithEmailAndPassword } = await import('firebase/auth')
  try {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password)
    const uid = cred.user.uid
    // Caso borde: cuenta creada fuera de la app y sin negocio aun.
    await ensureBusinessDoc(db, uid, 'Mi negocio')
    await syncConfig.save({ businessId: uid, email: email.trim() })
    return { uid, email: email.trim() }
  } catch (e) {
    throw new Error(authErrorMessage(e))
  }
}

// Desvincular este dispositivo (cierra sesion de la nube; los datos locales
// permanecen intactos en IndexedDB).
export async function unlinkDevice() {
  const { auth } = await getFirebase()
  const { signOut } = await import('firebase/auth')
  await signOut(auth)
  await syncConfig.clear()
}

// Escucha cambios de sesion. Devuelve la funcion para desuscribirse.
export async function observeAuth(callback) {
  const { auth } = await getFirebase()
  const { onAuthStateChanged } = await import('firebase/auth')
  return onAuthStateChanged(auth, callback)
}

// Mensajes de error en español para los codigos de Firebase Auth.
function authErrorMessage(e) {
  const code = e?.code || ''
  switch (code) {
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con ese correo. Usa "Vincular dispositivo" en su lugar.'
    case 'auth/invalid-email':
      return 'El correo no es valido.'
    case 'auth/weak-password':
      return 'La contraseña es muy debil (minimo 6 caracteres).'
    case 'auth/missing-password':
      return 'Escribe la contraseña.'
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Correo o contraseña incorrectos.'
    case 'auth/user-not-found':
      return 'No existe una cuenta con ese correo. Crea la cuenta del negocio primero.'
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera un momento e intenta de nuevo.'
    case 'auth/network-request-failed':
      return 'Sin conexion. Necesitas internet para vincular el dispositivo la primera vez.'
    default:
      return e?.message || 'No se pudo completar la operacion.'
  }
}
