import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { observeAuth, syncConfig } from '../../features/sync/syncService'
import { syncNow, startRealtime, stopRealtime, initialPull } from '../../features/sync/syncEngine'
import { touchThisDevice } from '../../features/sync/deviceRegistry'

const SyncContext = createContext(null)

const PUSH_INTERVAL_MS = 20000 // sube cambios locales cada 20s si hay conexion
// Bajada de respaldo: el tiempo real (onSnapshot) es streaming y algunas redes
// moviles/proxies lo bloquean; sin esto un dispositivo subiria sus ventas pero
// no bajaria las de otros. Un getDocs periodico garantiza que el inventario
// (libro mayor) converja en todos los equipos aunque el streaming falle.
const PULL_INTERVAL_MS = 45000

// ---------------------------------------------------------------------------
// Fase 4 - Bloque 24/25: arranca la sincronizacion a nivel de toda la app.
//
//  - Si la sync esta APAGADA, NO carga ni toca Firebase: la app sigue 100%
//    offline e identica.
//  - Si esta activada, escucha la sesion de nube; al haberla abre los listeners
//    en tiempo real (bajada) y sube los cambios locales periodicamente.
//  - Expone el estado (en linea / sincronizando / sin conexion) para la UI.
// ---------------------------------------------------------------------------
export function SyncProvider({ children }) {
  const [enabled, setEnabled] = useState(false)
  const [cloudUser, setCloudUser] = useState(undefined)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const busyRef = useRef(false)
  const pullBusyRef = useRef(false)

  // ¿Esta activada la sync en este dispositivo? (no toca Firebase)
  useEffect(() => {
    let alive = true
    syncConfig.isEnabled().then((v) => alive && setEnabled(v))
    return () => { alive = false }
  }, [])

  // Estado de conexion.
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  // Solo si la sync esta activada: observa la sesion de nube y abre/cierra los
  // listeners en vivo. Aqui es donde (y solo donde) se carga Firebase.
  useEffect(() => {
    if (!enabled) {
      setCloudUser(undefined)
      return
    }
    let unsub = null
    let alive = true
    observeAuth((u) => {
      if (!alive) return
      setCloudUser(u)
      if (u) {
        startRealtime()
        touchThisDevice() // registra/actualiza este dispositivo (sin limite)
      } else {
        stopRealtime()
      }
    }).then((fn) => { unsub = fn })
    return () => {
      alive = false
      if (unsub) unsub()
      stopRealtime()
    }
  }, [enabled])

  const runPush = async () => {
    if (busyRef.current) return
    if (!enabled || !cloudUser || !navigator.onLine) return
    busyRef.current = true
    setSyncing(true)
    try {
      await syncNow()
      setLastSyncAt(new Date().toISOString())
    } catch (e) {
      console.warn('[sync] push periodico', e?.message)
    } finally {
      busyRef.current = false
      setSyncing(false)
    }
  }

  // Bajada de respaldo (getDocs de todas las colecciones + recalculo de stock).
  // Complementa el tiempo real: si onSnapshot no entrega (red movil/proxy), esto
  // mantiene el inventario al dia en todos los dispositivos.
  const runPull = async () => {
    if (pullBusyRef.current) return
    if (!enabled || !cloudUser || !navigator.onLine) return
    pullBusyRef.current = true
    try {
      await initialPull()
    } catch (e) {
      console.warn('[sync] pull periodico', e?.message)
    } finally {
      pullBusyRef.current = false
    }
  }

  // Sube cambios al volver la conexion y de forma periodica.
  useEffect(() => {
    if (!enabled || !cloudUser) return
    if (online) runPush()
    const id = setInterval(() => {
      if (navigator.onLine) runPush()
    }, PUSH_INTERVAL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cloudUser, online])

  // Baja cambios al iniciar/reconectar y de forma periodica (respaldo del vivo).
  useEffect(() => {
    if (!enabled || !cloudUser) return
    if (online) runPull()
    const id = setInterval(() => {
      if (navigator.onLine) runPull()
    }, PULL_INTERVAL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cloudUser, online])

  const value = {
    enabled,
    cloudUser,
    online,
    syncing,
    lastSyncAt,
    // refresca el flag tras vincular/desvincular desde la pantalla de nube
    refresh: async () => setEnabled(await syncConfig.isEnabled()),
    syncNow: runPush
  }

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync() {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync debe usarse dentro de <SyncProvider>')
  return ctx
}
