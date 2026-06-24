import { NavLink } from 'react-router-dom'
import { Home, Package, ScrollText, DollarSign, Settings, Users, LogOut } from 'lucide-react'
import { useAuth } from '../app/providers/AuthProvider'
import { useShift } from '../app/providers/ShiftProvider'
import { useSync } from '../app/providers/SyncProvider'
import { useLicense } from '../app/providers/LicenseProvider'

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
