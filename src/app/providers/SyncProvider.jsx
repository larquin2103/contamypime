import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { observeAuth, syncConfig, refreshSession } from '../../features/sync/syncService'
import {
  syncNow, startRealtime, stopRealtime, initialPull, restartRealtime,
  setRingHandler, pullDiferido, getDeferred, reconciliarDiferidas
} from '../../features/sync/syncEngine'
import {
  ringDecision, RING_DEBOUNCE_MS, SAFETY_NET_MS,
  guardState, deferredSet, transitionPlan, parseCursor, parseDeferred,
  verdictKey, reconciledKey
} from '../../features/sync/deferred'
import { touchThisDevice, readDevices } from '../../features/sync/deviceRegistry'
import { db } from '../../db/db'
import { configRepo } from '../../repositories/configRepo'
import { licenseRepo } from '../../repositories/licenseRepo'
import { evaluateLicense, licenseModules, today, LICENSE_MODULES } from '../../lib/license'
import { logSyncEvent } from '../../lib/syncLog'

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
// FASE 2: recuperacion de sesion (renovar token + reabrir tiempo real) como
// mucho una vez cada esto, para no repetir ni gastar cuota / evitar bucles.
const RECOVER_MIN_MS = 30000

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
  // Bajada filtrada: QUE esta difiriendo este aparato ahora mismo y, si no
  // difiere nada, POR QUE. Lo pinta la tarjeta de /cloud: un ahorro que no se
  // enciende y no lo dice se da por hecho, que es justo como se pierde (H-C).
  const [filtradas, setFiltradas] = useState(() => new Set())
  const [motivoFiltro, setMotivoFiltro] = useState('')
  const busyRef = useRef(false)
  const pullBusyRef = useRef(false)
  // A) Push por evento: temporizador del debounce + bandera de "llegó algo
  // mientras subíamos" para reintentar al terminar (no perder la última venta).
  const nudgeTimerRef = useRef(null)
  const pendingPushRef = useRef(false)
  // B) Marca del último pull completo (para no repetirlo demasiado seguido).
  const lastPullAtRef = useRef(0)
  // FASE 2: marca del último intento de recuperación de sesión (throttle).
  const lastRecoverRef = useRef(0)
  // EL TIMBRE de la bajada diferida: temporizador del antirrebote y pulsaciones
  // recientes (para el tope por ventana). Van en refs y no en estado porque no
  // se pintan: cambiarlos no tiene por que repintar la app entera.
  const ringTimerRef = useRef(null)
  const ringRecentRef = useRef([])

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
      logSyncEvent('subida-periodica', null, e)
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

  // EL TIMBRE: cuando una coleccion que SIGUE EN VIVO entrega un cambio de otro
  // aparato, se baja lo diferido. Antirrebote para agrupar las rachas y tope por
  // ventana (R2), porque el alta de un negocio son miles de documentos y haria
  // sonar esto sin parar. Lo que el tope deje fuera lo recoge la red de seguridad.
  const tocarTimbre = () => {
    if (!enabled || !cloudUser) return
    clearTimeout(ringTimerRef.current)
    ringTimerRef.current = setTimeout(async () => {
      const d = ringDecision({ nowMs: Date.now(), recientes: ringRecentRef.current })
      ringRecentRef.current = d.recientes
      if (!d.suena) return
      if (!navigator.onLine) return
      try {
        await pullDiferido()
      } catch (e) {
        logSyncEvent('bajada-diferida', null, e)
      }
    }, RING_DEBOUNCE_MS)
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
      // Solo cuenta como confirmada si la respuesta vino del SERVIDOR (fromServer).
      // Si vino de cache, el SO dice "en red" pero Firestore no contesto -> se deja
      // en "sin confirmar" (badge amarillo) con el motivo. Si getDocs LANZA (token
      // muerto / sin cache), lo captura el catch de abajo.
      if (res?.ok && res.fromServer) {
        setLastPullOkAt(new Date().toISOString())
        setPullError('')
      } else if (res?.ok && !res.fromServer) {
        setPullError('El servidor no respondió; se leyó de la caché local.')
        // Huella de la cuota de lecturas agotada (docs/SYNC-LECTURAS.md §1).
        logSyncEvent('bajada-sin-servidor', null, { code: 'fromCache' })
        recoverSession() // FASE 2: en red pero sin respuesta -> intenta recuperar
      } else if (res?.reason) {
        setPullError(res.reason)
      }
    } catch (e) {
      setPullError(e?.message || 'error de red')
      console.warn('[sync] pull periodico', e?.message)
      logSyncEvent('bajada-periodica', null, e)
      recoverSession() // FASE 2: probablemente token caducado -> renovar y reabrir
    } finally {
      pullBusyRef.current = false
    }
  }

  // FASE 2: recuperacion automatica de la sesion de nube. Se dispara cuando el
  // pull ve que el servidor no responde estando "en red" (token caducado tras
  // horas offline, o listeners caidos). Fuerza un token FRESCO, reabre el tiempo
  // real y vuelve a bajar/subir. Throttle (RECOVER_MIN_MS) para no repetir ni
  // entrar en bucle: la marca se fija al ENTRAR, asi el runPull que llamamos aqui
  // dentro no vuelve a disparar otra recuperacion. Todo protegido: si falla,
  // degrada a un mensaje claro y NUNCA rompe la app ni el cobro.
  const recoverSession = async () => {
    if (!enabled || !cloudUser || !navigator.onLine) return
    if (Date.now() - lastRecoverRef.current < RECOVER_MIN_MS) return
    lastRecoverRef.current = Date.now()
    try {
      const ok = await refreshSession() // getIdToken(true): token nuevo del servidor
      if (!ok) {
        setPullError('No se pudo renovar la sesión de nube. Revisa tu conexión; si persiste, vuelve a vincular el dispositivo.')
        logSyncEvent('recuperacion-sesion', null, { code: 'token-no-renovado' })
        return
      }
      await restartRealtime() // re-arma listeners que pudieran haber muerto por auth
      await runPull()         // baja y confirma ya con el token nuevo
      await pullDiferido().catch(() => {}) // y lo diferido, que no pasa por runPull
      runPush()               // empuja lo local pendiente (no bloqueante)
    } catch (e) {
      console.warn('[sync] recover', e?.message)
      logSyncEvent('recuperacion-sesion', null, e)
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
      // FASE 2: el boton tambien REPARA la sesion: renueva el token por si estaba
      // caducado y reabre el tiempo real. Best-effort (refreshSession no lanza).
      await refreshSession()
      await restartRealtime()
      await syncNow()                 // sube lo local (motor; no lanza por red)
      const res = await initialPull() // baja y CONFIRMA ida y vuelta
      // Lo diferido NO baja por initialPull: sin esto, el dueño pulsa "Sincronizar
      // ahora", ve el verde de confirmado y el libro mayor no se ha movido.
      await pullDiferido().catch(() => {})
      lastPullAtRef.current = Date.now()
      // Solo es exito real si la respuesta vino del SERVIDOR. Leer de la cache
      // (fromServer=false) NO confirma que el servidor este accesible.
      if (res?.ok && res.fromServer) {
        setLastPullOkAt(new Date().toISOString())
        setLastSyncAt(new Date().toISOString())
        setPullError('')
        return { ok: true }
      }
      const reason = res?.ok && !res.fromServer
        ? 'El servidor no respondió; se mostró la caché local. Revisa conexión, antivirus o proxy.'
        : (res?.reason || 'No se pudo confirmar la sincronización.')
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
      pullDiferido().catch(() => {}) // lo diferido, al volver al frente
      nudgePush()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cloudUser])

  // ¿Tiene mesas este negocio? Se lee la licencia por el MISMO camino que
  // LicenseProvider y no con su hook: SyncProvider se monta POR FUERA de el
  // (App.jsx), asi que useLicense() aqui lanzaria.
  const sinMesas = async () => {
    const ev = await evaluateLicense(await licenseRepo.getToken(), { nowDate: today() })
    const desbloqueada = ['active', 'expiring', 'grace'].includes(ev.status)
    const modulos = desbloqueada ? licenseModules(ev.payload) : []
    return !modulos.includes(LICENSE_MODULES.TABLES)
  }

  // Decide si este aparato FILTRARA, y lo deja ESCRITO. No lo aplica a la sesion
  // en curso a proposito: `startRealtime` ya arranco (sale del callback de
  // observeAuth, sin esperar a nadie) y cerrar y reabrir el tiempo real aqui
  // costaria un enganche en frio de las otras 32 colecciones en CADA arranque,
  // que es justo el coste que se quiere quitar. El filtro entra en el arranque
  // siguiente, cuando el motor lee el veredicto ANTES de suscribir.
  useEffect(() => {
    if (!enabled || !cloudUser) return
    let vivo = true
    ;(async () => {
      try {
        const businessId = await syncConfig.businessId()
        if (!businessId) return
        const prevCols = parseDeferred((await db.syncState.get(verdictKey(businessId)))?.value)

        const aplicar = async (cols, motivo) => {
          const plan = transitionPlan({ prevCols, nextCols: cols })
          await db.syncState.put({ key: verdictKey(businessId), value: [...cols] })
          // Al volver al vivo se borra la marca de reconciliacion: el arranque
          // siguiente tiene que reconciliar otra vez, y esa relectura es la que
          // rellena lo que un build sin sello hubiera subido sin `_up`.
          if (plan.resetReconcile) {
            await db.syncState.put({ key: reconciledKey(businessId), value: '' })
          }
          if (plan.restart) await restartRealtime()
          if (!vivo) return
          const ahora = getDeferred()
          setFiltradas(ahora)
          setMotivoFiltro(
            motivo || (cols.size && !ahora.size ? 'Se aplicará al volver a abrir la app.' : '')
          )
        }

        if (!(await configRepo.getBajadaFiltrada())) {
          await aplicar(new Set(), 'Desactivada por el dueño.')
          return
        }

        const reconciledAtMs = parseCursor((await db.syncState.get(reconciledKey(businessId)))?.value)
        const guarda = guardState({
          devices: await readDevices(), nowMs: Date.now(), reconciledAtMs
        })
        if (!guarda.ok) {
          await aplicar(new Set(), guarda.motivo)
          return
        }

        const cols = deferredSet({
          flagOn: true,
          guardOk: true,
          sinMesas: await sinMesas(),
          ordersVacia: (await db.orders.count()) === 0
        })
        // TRANSICION: si este aparato aun no ha reconciliado, se hace AHORA, con
        // las colecciones todavia en vivo (por eso no cuesta lecturas).
        if (reconciledAtMs == null) {
          const r = await reconciliarDiferidas(businessId, cols)
          if (!r.ok) {
            await aplicar(new Set(), r.motivo)
            return
          }
        }
        await aplicar(cols, '')
      } catch (e) {
        // Ante CUALQUIER duda no se decide nada: el veredicto se queda como estaba
        // y la guarda se vuelve a evaluar en el arranque siguiente. El panel dice
        // lo que esta sesion hace DE VERDAD, no lo que se pretendia.
        if (!vivo) return
        setFiltradas(getDeferred())
        setMotivoFiltro('No se pudo comprobar si se puede filtrar; se reintenta al reabrir.')
        logSyncEvent('bajada-diferida-arranque', null, e)
      }
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cloudUser])

  // Engancha el timbre al motor. En su PROPIO efecto y no dentro del callback de
  // observeAuth: alli el cierre se quedaria con el `cloudUser` que habia al
  // registrarse -todavia undefined-, y `tocarTimbre` saldria por su guarda para
  // siempre. El timbre no sonaria nunca, sin un solo error.
  useEffect(() => {
    if (!enabled || !cloudUser) return
    setRingHandler(tocarTimbre)
    return () => setRingHandler(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cloudUser])

  // Red de seguridad: si el timbre no suena (el aparato estaba dormido, o el tope
  // de la ventana dejo fuera una racha), una bajada lenta cada 60 min. Coste
  // marginal, y acota el peor caso a una hora en vez de "hasta que algo pase".
  useEffect(() => {
    if (!enabled || !cloudUser) return
    const id = setInterval(() => {
      if (navigator.onLine) pullDiferido().catch(() => {})
    }, SAFETY_NET_MS)
    return () => clearInterval(id)
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
    nudgePush,
    // Bajada filtrada: lo lee la tarjeta de /cloud.
    filtradas,
    motivoFiltro
  }

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync() {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync debe usarse dentro de <SyncProvider>')
  return ctx
}
