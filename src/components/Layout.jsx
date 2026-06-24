import { NavLink } from 'react-router-dom'
import { useAuth } from '../app/providers/AuthProvider'
import { useShift } from '../app/providers/ShiftProvider'
import { useSync } from '../app/providers/SyncProvider'
import { useLicense } from '../app/providers/LicenseProvider'
import { ROLE_LABELS } from '../db/constants'

// Indicador de sincronizacion en la cabecera (solo si la sync esta activada).
function SyncBadge() {
  const { enabled, cloudUser, online, syncing } = useSync()
  if (!enabled || !cloudUser) return null
  let icon = '☁️'
  let label = 'En línea'
  let cls = 'sync-badge--ok'
  if (!online) { icon = '📴'; label = 'Sin conexión'; cls = 'sync-badge--off' }
  else if (syncing) { icon = '🔄'; label = 'Sincronizando'; cls = 'sync-badge--busy' }
  return (
    <span className={`sync-badge ${cls}`} title={label}>
      {icon}
    </span>
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

// Shell de la app autenticada: cabecera + contenido + navegacion inferior.
export function Layout({ children }) {
  const { user, logout, isOwner } = useAuth()
  const { canSell } = useShift()

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="brand brand--sm">MypiCuadre</span>
          <span className="active-user">
            {user.name} · {ROLE_LABELS[user.role]}
          </span>
        </div>
        <div className="app-header__right">
          <SyncBadge />
          <button className="btn btn--ghost btn--sm" onClick={logout}>
            Salir
          </button>
        </div>
      </header>

      <LicenseBanner />

      <main className="app-main">{children}</main>

      <nav className="app-nav">
        <NavLink to="/" end className="nav-item">
          🏠<span>Inicio</span>
        </NavLink>
        <NavLink to="/catalog" className="nav-item">
          📦<span>Catalogo</span>
        </NavLink>
        <NavLink to="/shift" className="nav-item">
          🧾<span>Turno</span>
        </NavLink>
        {canSell && (
          <NavLink to="/sell" className="nav-item">
            💵<span>Vender</span>
          </NavLink>
        )}
        {isOwner && (
          <>
            <NavLink to="/settings" className="nav-item">
              ⚙️<span>Ajustes</span>
            </NavLink>
            <NavLink to="/users" className="nav-item">
              👥<span>Usuarios</span>
            </NavLink>
          </>
        )}
      </nav>
    </div>
  )
}
