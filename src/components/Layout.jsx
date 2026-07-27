import { useState, useEffect } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { Home, Package, ScrollText, DollarSign, Settings, Users, LogOut, HelpCircle } from 'lucide-react'
import { useAuth } from '../app/providers/AuthProvider'
import { useShift } from '../app/providers/ShiftProvider'
import { useSync } from '../app/providers/SyncProvider'
import { useLicense } from '../app/providers/LicenseProvider'

// El verde solo es "de verdad" si hubo una bajada confirmada por el servidor
// hace menos de esto. Con el pull de respaldo cada 45s, 120s deja margen para
// dos ciclos antes de dudar (evita parpadeo pero avisa pronto si se cae la red).
const SYNC_FRESH_MS = 120000

// Indicador de sincronizacion en la cabecera (solo si la sync esta activada).
// FASE 1: refleja SALUD REAL, no solo navigator.onLine. Al tocarlo abre un panel
// con la ultima sincronizacion confirmada y un boton para forzarla con resultado.
function SyncBadge() {
  const { enabled, cloudUser, online, syncing, lastPullOkAt, pullError, manualSync } = useSync()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, error } del ultimo intento manual
  // El estado "fresco" depende del PASO DEL TIEMPO y, ante fallos repetidos, el
  // error puede reasignarse al mismo texto (React no re-renderiza). Este "tick"
  // fuerza re-evaluar el badge cada pocos segundos, para que el ☁️/⚠️ cambie
  // solo, sin tener que recargar la pestaña. (Solo redibuja este badge pequeño.)
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [])
  if (!enabled || !cloudUser) return null

  const ageMs = lastPullOkAt ? Date.now() - new Date(lastPullOkAt).getTime() : Infinity
  // Verde exige bajada reciente CONFIRMADA y sin error pendiente. Incluir
  // pullError hace que un fallo pase a amarillo de inmediato (no espera los 120s).
  const fresh = ageMs < SYNC_FRESH_MS && !pullError

  // Verde SOLO si hubo ida y vuelta reciente confirmada. Si el SO dice "en red"
  // pero no hay bajada confirmada, es AMARILLO ("sin confirmar"): ese era el
  // falso verde que enganaba.
  let icon = '⚠️', label = 'Sin confirmar', cls = 'sync-badge--warn'
  if (!online) { icon = '📴'; label = 'Sin conexión'; cls = 'sync-badge--off' }
  else if (syncing) { icon = '🔄'; label = 'Sincronizando'; cls = 'sync-badge--busy' }
  else if (fresh) { icon = '☁️'; label = 'Sincronizada'; cls = 'sync-badge--ok' }

  const since = () => {
    if (!lastPullOkAt) return 'aún no confirmada en esta sesión'
    const s = Math.max(0, Math.round(ageMs / 1000))
    if (s < 60) return `hace ${s} s`
    const m = Math.round(s / 60)
    if (m < 60) return `hace ${m} min`
    return `hace ${Math.round(m / 60)} h`
  }

  const doSync = async () => {
    setBusy(true)
    setResult(null)
    const r = await manualSync()
    setResult(r)
    setBusy(false)
  }

  return (
    <div className="sync-wrap">
      <button
        className={`sync-badge ${cls}`}
        title={label}
        aria-label={`Sincronización: ${label}`}
        onClick={() => { setOpen((v) => !v); setResult(null) }}
      >
        {icon}
      </button>
      {open && (
        <>
          <div className="sync-pop__backdrop" onClick={() => setOpen(false)} />
          <div className="sync-pop" role="dialog" aria-label="Estado de sincronización">
            <p className="sync-pop__state">{icon} {label}</p>
            <p className="sync-pop__line">Última sincronización real: <strong>{since()}</strong></p>
            {!fresh && online && !syncing && (
              <p className="sync-pop__warn">
                La nube aparece activa pero no se confirma una bajada reciente. Pulsa
                “Sincronizar ahora” para verificar la conexión real con el servidor.
              </p>
            )}
            {pullError && <p className="sync-pop__err">Último error: {pullError}</p>}
            {result && (result.ok
              ? <p className="sync-pop__ok">✅ Sincronización confirmada.</p>
              : <p className="sync-pop__err">❌ {result.error}</p>
            )}
            <button className="btn btn--primary btn--sm" disabled={busy} onClick={doSync}>
              {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Aviso de licencia por vencer / en gracia / reloj atrasado. El dueño la renueva
// desde Ajustes; el aviso lo ven todos para que no los agarre por sorpresa.
function LicenseBanner() {
  const { status, daysLeft, graceLeft, clockBack } = useLicense()
  const plural = (n) => (Math.abs(n) === 1 ? '' : 's')
  if (clockBack) {
    return (
      <div className="license-bar license-bar--warn">
        ⏰ La fecha del dispositivo parece atrasada. Ajústala para evitar problemas con la licencia.
      </div>
    )
  }
  if (status === 'grace') {
    return (
      <div className="license-bar license-bar--danger">
        ⛔ Tu licencia caducó. Te queda{plural(graceLeft)} {graceLeft} día{plural(graceLeft)} de gracia — renuévala ya en Ajustes.
      </div>
    )
  }
  if (status === 'expiring') {
    return (
      <div className="license-bar license-bar--warn">
        ⚠️ Tu licencia vence en {daysLeft} día{plural(daysLeft)}. Renuévala pronto en Ajustes.
      </div>
    )
  }
  return null
}

// Shell de la app autenticada: cabecera fina + contenido + navegacion inferior.
// La identidad rica (avatar, saludo, rol) vive en el Home; aqui solo la marca.
export function Layout({ children }) {
  const { logout, isOwner } = useAuth()
  const { canSell } = useShift()

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand brand--sm">MypiCuadre</span>
        <div className="app-header__right">
          <SyncBadge />
          <Link className="btn btn--ghost btn--sm app-header__help" to="/help" aria-label="Ayuda" title="Ayuda">
            <HelpCircle size={16} strokeWidth={2} /> Ayuda
          </Link>
          <button className="btn btn--ghost btn--sm app-header__exit" onClick={logout}>
            <LogOut size={16} strokeWidth={2} /> Salir
          </button>
        </div>
      </header>

      <LicenseBanner />

      <main className="app-main">{children}</main>

      <nav className="app-nav">
        <NavLink to="/" end className="nav-item">
          <Home size={21} strokeWidth={1.9} /><span>Inicio</span>
        </NavLink>
        <NavLink to="/catalog" className="nav-item">
          <Package size={21} strokeWidth={1.9} /><span>Catálogo</span>
        </NavLink>
        <NavLink to="/shift" className="nav-item">
          <ScrollText size={21} strokeWidth={1.9} /><span>Turno</span>
        </NavLink>
        {canSell && (
          <NavLink to="/sell" className="nav-item">
            <DollarSign size={21} strokeWidth={1.9} /><span>Vender</span>
          </NavLink>
        )}
        {isOwner && (
          <>
            <NavLink to="/settings" className="nav-item">
              <Settings size={21} strokeWidth={1.9} /><span>Ajustes</span>
            </NavLink>
            <NavLink to="/users" className="nav-item">
              <Users size={21} strokeWidth={1.9} /><span>Usuarios</span>
            </NavLink>
          </>
        )}
      </nav>
    </div>
  )
}
