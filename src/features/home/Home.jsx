import { Link } from 'react-router-dom'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { FOREIGN_CURRENCIES, ROLE_LABELS } from '../../db/constants'

export function Home() {
  const { user, isOwner } = useAuth()
  const { baseCurrency, rates } = useCurrency()

  return (
    <div className="screen">
      <div className="welcome">
        <h2>Hola, {user.name}</h2>
        <span className="badge">{ROLE_LABELS[user.role]}</span>
      </div>

      <section className="card">
        <h3>Tasas vigentes</h3>
        <div className="convert-grid">
          {FOREIGN_CURRENCIES.map((c) => (
            <div key={c.code} className="convert-cell">
              <span className="muted">{c.code}</span>
              <strong>
                {rates?.[c.code]?.rate
                  ? `${rates[c.code].rate} ${baseCurrency}`
                  : '— sin tasa'}
              </strong>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Proximamente (Fase 1)</h3>
        <p className="muted">
          Catalogo, importacion, turnos, ventas, compras, caja y cuadre se iran activando
          en los siguientes bloques.
        </p>
      </section>

      <div className="quick-links">
        <Link className="btn btn--block" to="/catalog">
          📦 Catalogo
        </Link>
        {isOwner && (
          <>
            <Link className="btn btn--block" to="/settings">
              ⚙️ Ajustes
            </Link>
            <Link className="btn btn--block" to="/users">
              👥 Usuarios
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
