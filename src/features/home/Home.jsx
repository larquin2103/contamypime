import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { countsRepo } from '../../repositories/countsRepo'
import { FOREIGN_CURRENCIES, ROLE_LABELS, COUNT_STATUS } from '../../db/constants'

// Aviso al vendedor cuando el dueño resuelve su conteo fisico (aprobado/rechazado).
function CountNotice({ userId }) {
  const last = useLiveQuery(() => countsRepo.latestResolvedFor(userId), [userId], undefined)
  const [seen, setSeen] = useState(() => localStorage.getItem('countNoticeSeen'))
  if (!last || last.id === seen) return null
  const approved = last.status === COUNT_STATUS.APPROVED
  const ack = () => { localStorage.setItem('countNoticeSeen', last.id); setSeen(last.id) }
  return (
    <div className={`cuadre-banner cuadre-banner--${approved ? 'green' : 'red'}`}>
      <span className="cuadre-emoji">{approved ? '✅' : '↩️'}</span>
      <div>
        <strong>{approved ? 'Tu conteo físico fue aprobado' : 'Tu conteo físico fue rechazado'}</strong>
        {!approved && last.rejectReason && <p className="muted">Motivo: {last.rejectReason}</p>}
        {approved && <p className="muted">Las existencias se ajustaron según lo contado.</p>}
        <button className="btn btn--ghost btn--sm" onClick={ack}>Entendido</button>
      </div>
    </div>
  )
}

// Aviso al dueño si hay mas de un turno abierto a la vez (puede ocurrir si dos
// dispositivos abrieron turno sin conexion y luego sincronizaron).
function ConcurrentShiftWarning() {
  const open = useLiveQuery(() => shiftsRepo.listOpen(), [], [])
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  if (!open || open.length < 2) return null
  const nameOf = (id) => users.find((u) => u.id === id)?.name || 'vendedor'
  return (
    <Link to="/shift" className="shift-status shift-status--other">
      <span>
        ⚠️ Hay {open.length} turnos abiertos a la vez ({open.map((s) => nameOf(s.sellerId)).join(', ')}).
        Revisa y cierra el que corresponda.
      </span>
    </Link>
  )
}

export function Home() {
  const { user, isOwner } = useAuth()
  const { baseCurrency, rates } = useCurrency()
  const { hasActive, isMine } = useShift()

  return (
    <div className="screen">
      <div className="welcome">
        <h2>Hola, {user.name}</h2>
        <span className="badge">{ROLE_LABELS[user.role]}</span>
      </div>

      <CountNotice userId={user.id} />
      {isOwner && <ConcurrentShiftWarning />}

      <Link to="/shift" className={`shift-status shift-status--${hasActive ? (isMine ? 'mine' : 'other') : 'none'}`}>
        {!hasActive && <span>🟢 Sin turno abierto — toca para abrir</span>}
        {hasActive && isMine && <span>🧾 Tu turno está activo — gestionar / cerrar</span>}
        {hasActive && !isMine && <span>🔒 Turno activo de otro vendedor</span>}
      </Link>

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

      <div className="quick-links">
        <Link className="btn btn--block" to="/catalog">
          📦 Catalogo
        </Link>
        <Link className="btn btn--block" to="/handoff">
          🔄 Traspaso de turno
        </Link>
        <Link className="btn btn--block" to="/count">
          📋 Conteo fisico
        </Link>
        {isOwner && (
          <>
            <Link className="btn btn--block" to="/dashboard">
              📊 Panel del dueño
            </Link>
            <Link className="btn btn--block" to="/audit">
              🗂️ Auditoria
            </Link>
            <Link className="btn btn--block" to="/reports">
              📄 Reportes (PDF/Excel)
            </Link>
            <Link className="btn btn--block" to="/cloud">
              ☁️ Sincronización
            </Link>
            <Link className="btn btn--block" to="/entry">
              📥 Entrada de mercancia
            </Link>
            <Link className="btn btn--block" to="/finances">
              💰 Deudas y caja
            </Link>
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
