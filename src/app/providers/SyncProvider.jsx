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
// A) Push por evento: tras una venta se pide subir enseguida (con un pequeño
// debounce para agrupar ventas seguidas), en vez de esperar el ciclo de 20s.
const NUDGE_DEBOUNCE_MS = 1200
// B) Al traer la app al frente se baja lo nuevo, pero el pull completo es caro
// (relee todo): se limita a como mucho uno cada FOREGROUND_PULL_MIN_MS.
const FOREGROUND_PULL_MIN_MS = 15000

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
  // FASE 1 (salud honesta de la sync): marca de la ULTIMA bajada CONFIRMADA por
  // el servidor y el ultimo error real. Con esto la cabecera deja de mostrar
  // "conectada" solo porque el sistema operativo dice que hay red: el verde solo
  // aparece si hubo ida y vuelta real reciente con Firestore.
  const [lastPullOkAt, setLastPullOkAt] = useState(null)
  const [pullError, setPullError] = useState('')
  const busyRef = useRef(false)
  const pullBusyRef = useRef(false)
  // A) Push por evento: temporizador del debounce + bandera de "llegó algo
  // mientras subíamos" para reintentar al terminar (no perder la última venta).
  const nudgeTimerRef = useRef(null)
  const pendingPushRef = useRef(false)
  // B) Marca del último pull completo (para no repetirlo demasiado seguido).
  const lastPullAtRef = useRef(0)

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
    // Si ya hay un push en curso, marcamos que hay algo pendiente y salimos: al
    // terminar el push actual se relanza para incluir lo último (p.ej. una venta
    // registrada mientras subíamos). Evita perder la venta hasta el próximo ciclo.
    if (busyRef.current) { pendingPushRef.current = true; return }
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
      if (pendingPushRef.current) { pendingPushRef.current = false; runPush() }
    }
  }

  // A) Pide subir enseguida tras un evento local (una venta), con debounce para
  // agrupar ventas seguidas. No-op si la sync está apagada. Al dispararse solo
  // sube si hay conexión; si no la hay, la venta espera al ciclo/reconexión (la
  // caché de Firestore la entrega igual). Reutiliza el guard de runPush.
  const nudgePush = () => {
    if (!enabled || !cloudUser) return
    clearTimeout(nudgeTimerRef.current)
    nudgeTimerRef.current = setTimeout(() => {
      if (navigator.onLine) runPush()
    }, NUDGE_DEBOUNCE_MS)
  }

  // Bajada de respaldo (getDocs de todas las colecciones + recalculo de stock).
  // Complementa el tiempo real: si onSnapshot no entrega (red movil/proxy), esto
  // mantiene el inventario al dia en todos los dispositivos.
  const runPull = async () => {
    if (pullBusyRef.current) return
    if (!enabled || !cloudUser || !navigator.onLine) return
    pullBusyRef.current = true
    try {
      const res = await initialPull()
      lastPullAtRef.current = Date.now()
      // initialPull hace getDocs y ESPERA respuesta del servidor. Si resuelve con
      // ok, hubo ida y vuelta real -> "confirmada". Si el token murio o la red
      // bloquea Firestore, getDocs LANZA -> lo captura el catch (badge en amarillo).
      if (res?.ok) {
        setLastPullOkAt(new Date().toISOString())
        setPullError('')
      } else if (res?.reason) {
        setPullError(res.reason)
      }
    } catch (e) {
      setPullError(e?.message || 'error de red')
      console.warn('[sync] pull periodico', e?.message)
    } finally {
      pullBusyRef.current = false
    }
  }

  // FASE 1: sincronizacion MANUAL con resultado visible (boton "Sincronizar
  // ahora" de la cabecera). Sube lo local y luego baja CONFIRMANDO con el
  // servidor; devuelve { ok, error } para mostrar exito o el fallo real en la UI.
  const manualSync = async () => {
    if (!enabled || !cloudUser) return { ok: false, error: 'La sincronización no está activada en este dispositivo.' }
    if (!navigator.onLine) return { ok: false, error: 'Sin conexión a internet.' }
    setSyncing(true)
    try {
      await syncNow()                 // sube lo local (motor; no lanza por red)
      const res = await initialPull() // baja y CONFIRMA ida y vuelta
      lastPullAtRef.current = Date.now()
      if (res?.ok) {
        setLastPullOkAt(new Date().toISOString())
        setLastSyncAt(new Date().toISOString())
        setPullError('')
        return { ok: true }
      }
      const reason = res?.reason || 'No se pudo confirmar la sincronización.'
      setPullError(reason)
      return { ok: false, error: reason }
    } catch (e) {
      const msg = e?.message || 'Error de red al sincronizar.'
      setPullError(msg)
      return { ok: false, error: msg }
    } finally {
      setSyncing(false)
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

  // B) Al traer la app al frente (el dueño la abre): baja lo nuevo al instante
  // sin esperar el ciclo de 45s, y empuja cualquier cambio local pendiente. El
  // pull completo se limita a uno cada FOREGROUND_PULL_MIN_MS (es caro).
  useEffect(() => {
    if (!enabled || !cloudUser) return
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
      if (!navigator.onLine) return
      if (Date.now() - lastPullAtRef.current > FOREGROUND_PULL_MIN_MS) runPull()
      nudgePush()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cloudUser])

  const value = {
    enabled,
    cloudUser,
    online,
    syncing,
    lastSyncAt,
    // FASE 1: salud honesta para la cabecera.
    lastPullOkAt,
    pullError,
    manualSync,
    // refresca el flag tras vincular/desvincular desde la pantalla de nube
    refresh: async () => setEnabled(await syncConfig.isEnabled()),
    syncNow: runPush,
    // A) lo llama la pantalla de venta tras registrar una venta (no-op sin sync).
    nudgePush
  }

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync() {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync debe usarse dentro de <SyncProvider>')
  return ctx
}
