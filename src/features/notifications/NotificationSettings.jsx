import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../../app/providers/AuthProvider'
import { getPreferences, savePreferences } from './notificationService'

// Pantalla de configuración del centro de notificaciones (Fase 9). El dueño elige
// qué categorías recibe en la campana y si quiere solo las importantes. Solo el
// dueño (la config es del negocio y sincroniza). Los interruptores escriben la
// clave 'notificationPreferences'; el motor la relee en cada barrido.

// Categorías (los 5 interruptores). `live` = ya tiene productor cableado; las que
// no, se muestran (son preferencia real) pero aún no generan avisos: se marca honesto.
const CATEGORIES = [
  { key: 'caja', label: 'Caja', desc: 'Diferencias al cerrar turno (faltante/sobrante).', live: true },
  { key: 'inventario', label: 'Inventario', desc: 'Conteo físico aprobado con diferencia.', live: true },
  { key: 'ventas', label: 'Ventas', desc: 'Cambios de precio de productos.', live: true },
  { key: 'transferencias', label: 'Transferencias', desc: 'Cobros por transferencia con diferencia (de más o de menos).', live: true },
  { key: 'remesas', label: 'Remesas', desc: 'Entregas fallidas y diferencias al liquidar a un mensajero.', live: true }
]

export function NotificationSettings() {
  const { isOwner } = useAuth()
  const prefs = useLiveQuery(() => getPreferences(), [], undefined)

  if (!isOwner) {
    return (
      <div className="screen">
        <h2>Notificaciones</h2>
        <p className="muted">Solo el dueño puede configurar las notificaciones.</p>
        <Link className="btn btn--primary btn--block" to="/">Volver</Link>
      </div>
    )
  }
  if (prefs === undefined) return null

  const toggle = (key) => savePreferences({ ...prefs, [key]: !prefs[key] })
  const isOn = (key) => prefs[key] !== false

  return (
    <div className="screen">
      <h2>Notificaciones</h2>
      <p className="muted">
        Elige qué avisos recibes en la campana. Se generan en tu dispositivo a partir de lo que
        sincronizan los vendedores y administrativos; no se inventa nada.
      </p>

      <section className="card">
        <h3>Tipos de aviso</h3>
        {CATEGORIES.map((c) => (
          <div key={c.key} className="kv">
            <span className="muted">
              {c.label}
              <br />
              <span className="notif-set__desc">
                {c.desc}{!c.live ? ' · aún sin avisos' : ''}
              </span>
            </span>
            <button
              className={`btn btn--sm ${isOn(c.key) ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => toggle(c.key)}
            >
              {isOn(c.key) ? 'Activado ✓' : 'Desactivado'}
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <h3>Solo alertas importantes</h3>
        <p className="muted">
          Con esto activado, recibes solo advertencias y alertas críticas; se omiten los avisos
          informativos (como los cambios de precio).
        </p>
        <div className="kv">
          <span className="muted">Recibir solo importantes</span>
          <button
            className={`btn btn--sm ${prefs.onlyImportant ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => toggle('onlyImportant')}
          >
            {prefs.onlyImportant ? 'Activado ✓' : 'Desactivado'}
          </button>
        </div>
      </section>

      <Link className="btn btn--ghost btn--block" to="/settings">Volver a Ajustes</Link>
    </div>
  )
}
