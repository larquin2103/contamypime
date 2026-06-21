import { NavLink } from 'react-router-dom'
import { useAuth } from '../app/providers/AuthProvider'

// Shell de la app autenticada: cabecera + contenido + navegacion inferior.
export function Layout({ children }) {
  const { user, logout, isOwner } = useAuth()

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand brand--sm">MypiCuadre</span>
        <button className="btn btn--ghost btn--sm" onClick={logout}>
          Salir
        </button>
      </header>

      <main className="app-main">{children}</main>

      <nav className="app-nav">
        <NavLink to="/" end className="nav-item">
          🏠<span>Inicio</span>
        </NavLink>
        <NavLink to="/catalog" className="nav-item">
          📦<span>Catalogo</span>
        </NavLink>
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
