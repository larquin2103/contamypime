import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLicense } from '../../app/providers/LicenseProvider'
import { useEscapeClose } from '../../lib/useEscapeClose'

const STORAGE_KEY = 'welcomeSeen'

// Fase D - Bienvenida de primer arranque. Se muestra UNA vez (por dispositivo)
// tras entrar, con los 3 pasos esenciales y los días de prueba restantes. Da
// contexto inmediato para que el usuario del demo no vea una pantalla en blanco.
export function WelcomeModal() {
  const { daysLeft, status } = useLicense()
  const [seen, setSeen] = useState(() => localStorage.getItem(STORAGE_KEY) === '1')
  const close = () => { localStorage.setItem(STORAGE_KEY, '1'); setSeen(true) }
  useEscapeClose(close)
  if (seen) return null
  // Días de prueba (si la licencia caduca). Solo se muestra si es un número real.
  const showDays = Number.isFinite(daysLeft) && (status === 'active' || status === 'expiring')

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal welcome-modal" role="dialog" aria-modal="true" aria-label="Bienvenida a MypiCuadre" onClick={(e) => e.stopPropagation()}>
        <h2 className="brand">¡Bienvenido a MypiCuadre!</h2>
        <p className="muted">Tu sistema de ventas y cuadre de caja, funciona sin internet.</p>

        {showDays && (
          <div className="welcome-badge">
            🎁 Prueba activa: te quedan <strong>{daysLeft} día{daysLeft === 1 ? '' : 's'}</strong>
          </div>
        )}

        <p className="welcome-lead">En 3 pasos ya estás vendiendo:</p>
        <ol className="welcome-steps">
          <li><strong>Prepara:</strong> pon tus tasas de cambio y carga tus productos.</li>
          <li><strong>Vende:</strong> abre tu turno y cobra en efectivo o transferencia.</li>
          <li><strong>Cuadra:</strong> cierra el turno y la app te dice si la caja cuadra 🟢.</li>
        </ol>

        <div className="modal__actions welcome-actions">
          <Link className="btn btn--ghost" to="/help" onClick={close}>Ver la guía completa</Link>
          <button className="btn btn--primary" onClick={close}>Empezar</button>
        </div>
      </div>
    </div>
  )
}
