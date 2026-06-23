import { firebaseConfig } from './firebaseConfig'

// ---------------------------------------------------------------------------
// Inicializacion de Firebase (Fase 4 - sincronizacion).
//
// Carga DIFERIDA del SDK: no se importa nada de Firebase hasta que algo llama
// a getFirebase(). Asi el bundle inicial sigue ligero y la app funciona 100%
// offline sin tocar la red mientras la sync este apagada.
//
// Firestore se inicializa con cache local persistente (IndexedDB) y soporte
// multipestana, de modo que las lecturas/escrituras funcionan sin conexion y
// se sincronizan solas al volver internet.
// ---------------------------------------------------------------------------

let _loading = null
let _instances = null

async function load() {
  if (_instances) return _instances
  if (_loading) return _loading

  _loading = (async () => {
    const { initializeApp, getApps } = await import('firebase/app')
    const {
      initializeFirestore,
      persistentLocalCache,
      persistentMultipleTabManager
    } = await import('firebase/firestore')
    const { getAuth } = await import('firebase/auth')

    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    })
    const auth = getAuth(app)

    _instances = { app, db, auth }
    return _instances
  })()

  return _loading
}

// Devuelve { app, db, auth } inicializados (carga el SDK la primera vez).
export function getFirebase() {
  return load()
}

// True si hay configuracion valida del proyecto (claves no vacias).
export function isFirebaseConfigured() {
  return Boolean(firebaseConfig?.apiKey && firebaseConfig?.projectId)
}
