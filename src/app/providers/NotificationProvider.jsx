import { useEffect, useRef } from 'react'
import { useAuth } from './AuthProvider'
import { useSync } from './SyncProvider'
import { refreshFromSources } from '../../features/notifications/notificationService'

// ---------------------------------------------------------------------------
// Runtime del centro de notificaciones (Fase 9) — CABLEADO, sin UI propia.
// SOLO en dispositivos de MANDO (dueño/admin) corre el motor de derivación
// (refreshFromSources): lee los eventos ya sincronizados y materializa los avisos
// locales. Los vendedores NO lo corren (no generan avisos del dueño).
//
// Cuándo deriva:
//  - al montar (mando),
//  - cada vez que una BAJADA confirmada trae datos nuevos (lastPullOkAt cambia),
//  - al traer la app al frente (visibilitychange),
//  - y de respaldo, en un intervalo suave (para el caso single-device sin sync).
//
// Es idempotente (id determinista + addIfAbsent) y de sólo lectura sobre el resto:
// no puede romper ventas/caja/inventario. Los errores se tragan (nunca rompen la app).
// ---------------------------------------------------------------------------

// Intervalo de respaldo (rendimiento): los eventos cross-dispositivo llegan por
// `lastPullOkAt` (pull confirmado) y al enfocar la app; este intervalo solo cubre
// el caso single-device sin sync, por eso es holgado.
const REFRESH_INTERVAL_MS = 60000

export function NotificationProvider({ children }) {
  const { isManager } = useAuth()
  const { lastPullOkAt } = useSync()
  const busyRef = useRef(false)

  const run = async () => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      await refreshFromSources()
    } catch (e) {
      console.warn('[notif] refresh', e?.message)
    } finally {
      busyRef.current = false
    }
  }

  // Al montar (mando), intervalo de respaldo y al enfocar la app.
  useEffect(() => {
    if (!isManager) return
    run()
    const id = setInterval(run, REFRESH_INTERVAL_MS)
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager])

  // Cada bajada confirmada (datos nuevos del vendedor/admin) dispara una derivación.
  useEffect(() => {
    if (!isManager || !lastPullOkAt) return
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, lastPullOkAt])

  return children
}
