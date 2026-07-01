import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  LayoutDashboard, Package, PackagePlus, ClipboardList, ArrowLeftRight,
  Wallet, FileText, ShieldCheck, RefreshCw, Users, Settings, ChevronRight, Send, HelpCircle
} from 'lucide-react'
import { useAuth } from '../../app/providers/AuthProvider'
import { useCurrency } from '../../app/providers/CurrencyProvider'
import { useShift } from '../../app/providers/ShiftProvider'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { countsRepo } from '../../repositories/countsRepo'
import { configRepo } from '../../repositories/configRepo'
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

// Estado de turnos abiertos para el dueño. Con areas (Fase 6) tener varios
// turnos a la vez es NORMAL (uno por area/vendedor): se muestra informativo.
// La anomalia real es que el MISMO vendedor tenga 2+ turnos abiertos (colision
// de sincronizacion offline): eso si se avisa como advertencia.
function ConcurrentShiftWarning() {
  const open = useLiveQuery(() => shiftsRepo.listOpen(), [], [])
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  if (!open || open.length === 0) return null
  const nameOf = (id) => users.find((u) => u.id === id)?.name || 'vendedor'
  const labelOf = (s) => `${nameOf(s.sellerId)}${s.area ? ` (${s.area})` : ''}`

  // Anomalia: un vendedor con mas de un turno abierto.
  const counts = {}
  for (const s of open) counts[s.sellerId] = (counts[s.sellerId] || 0) + 1
  const dup = Object.entries(counts).find(([, n]) => n >= 2)
  if (dup) {
    return (
      <Link to="/shift" className="shift-status shift-status--other">
        <span>
          ⚠️ {nameOf(dup[0])} tiene más de un turno abierto. Revisa y cierra el duplicado.
        </span>
      </Link>
    )
  }

  if (open.length < 2) return null
  return (
    <Link to="/shift" className="shift-status shift-status--other">
      <span>
        🟢 {open.length} turnos abiertos por área: {open.map(labelOf).join(', ')}.
      </span>
    </Link>
  )
}

// Banner de estado de turno (accion primaria de operacion).
function ShiftBanner() {
  const { hasActive, isMine } = useShift()
  let title = 'Sin turno abierto'
  let sub = 'Ábrelo para empezar a registrar ventas'
  let cta = 'Abrir'
  if (hasActive && isMine) { title = 'Turno abierto'; sub = 'Toca para gestionar o cerrar'; cta = 'Gestionar' }
  else if (hasActive && !isMine) { title = 'Turno activo de otro vendedor'; sub = 'Solo quien lo abrió puede vender'; cta = 'Ver' }
  return (
    <Link to="/shift" className="shift-banner">
      <span className={`shift-dot ${hasActive ? 'shift-dot--on' : ''}`} aria-hidden="true" />
      <div className="shift-banner__text">
        <strong>{title}</strong>
        <span className="muted">{sub}</span>
      </div>
      <span className="shift-banner__cta">{cta}</span>
    </Link>
  )
}

// Tarjeta de accion de una seccion (icono + titulo + subtitulo).
function ActionCard({ to, icon: Icon, title, sub }) {
  return (
    <Link to={to} className="action-card">
      <span className="action-tile"><Icon size={20} strokeWidth={1.8} /></span>
      <strong className="action-card__title">{title}</strong>
      <span className="action-card__sub">{sub}</span>
    </Link>
  )
}

function Section({ label, children }) {
  return (
    <section className="home-section">
      <h3 className="home-section__label">{label}</h3>
      <div className="home-grid">{children}</div>
    </section>
  )
}

function RatesCard() {
  const { baseCurrency, rates } = useCurrency()
  return (
    <section className="card rates-card">
      <h3 className="rates-card__title">Tasas vigentes</h3>
      <div className="rates-grid">
        {FOREIGN_CURRENCIES.map((c) => {
          const r = rates?.[c.code]?.rate
          return (
            <div key={c.code} className="rate-cell">
              <span className="rate-cell__label">{c.code}</span>
              <strong className={r ? 'rate-cell__val' : 'rate-cell__val rate-cell__val--empty'}>
                {r ? `${r} ${baseCurrency}` : '— sin tasa'}
              </strong>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function Home() {
  const { user, isOwner, isManager } = useAuth()
  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const initial = (user.name || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-avatar">{initial}</div>
        <div className="home-greeting">
          <span className="home-greeting__hi">Bienvenido de nuevo</span>
          <div className="home-greeting__row">
            <strong className="home-greeting__name">{user.name}</strong>
            <span className="home-badge">{ROLE_LABELS[user.role]}</span>
          </div>
        </div>
      </header>

      <CountNotice userId={user.id} />
      {isManager && <ConcurrentShiftWarning />}

      <ShiftBanner />

      {/* Destacados */}
      <div className="home-highlights">
        {isManager && (
          <Link to="/dashboard" className="highlight highlight--accent">
            <span className="highlight__tile highlight__tile--accent">
              <LayoutDashboard size={23} strokeWidth={1.9} />
            </span>
            <div className="highlight__text">
              <strong>Panel del dueño</strong>
              <span>Ventas, caja y alertas del negocio</span>
            </div>
            <ChevronRight size={20} className="highlight__chev" />
          </Link>
        )}
        <Link to="/catalog" className="highlight">
          <span className="highlight__tile">
            <Package size={21} strokeWidth={1.9} />
          </span>
          <div className="highlight__text">
            <strong>Catálogo</strong>
            <span>Productos, precios y existencias</span>
          </div>
          <ChevronRight size={18} className="highlight__chev highlight__chev--muted" />
        </Link>
      </div>

      {!isManager && <RatesCard />}

      {isManager ? (
        <>
          <Section label="Inventario">
            <ActionCard to="/entry" icon={PackagePlus} title="Entrada de mercancía" sub="Al almacén central" />
            {areas.length > 0 && (
              <ActionCard to="/transfer" icon={Send} title="Salida a áreas" sub="Marca productos y envía por área" />
            )}
            <ActionCard to="/count" icon={ClipboardList} title="Conteo físico" sub="Ajustar existencias" />
          </Section>
          <Section label="Operación">
            <ActionCard to="/handoff" icon={ArrowLeftRight} title="Traspaso de turno" sub="Entregar la caja" />
            <ActionCard to="/finances" icon={Wallet} title="Deudas y caja" sub="Cobros y pagos" />
          </Section>
          <Section label="Gestión">
            <ActionCard to="/reports" icon={FileText} title="Reportes" sub="PDF y Excel" />
            <ActionCard to="/audit" icon={ShieldCheck} title="Auditoría" sub="Registro de cambios" />
            <ActionCard to="/help" icon={HelpCircle} title="Ayuda" sub="Cómo usar la app" />
          </Section>
          {isOwner && (
            <Section label="Sistema">
              <ActionCard to="/cloud" icon={RefreshCw} title="Sincronización" sub="Datos en la nube" />
              <ActionCard to="/users" icon={Users} title="Usuarios" sub="Permisos y roles" />
              <ActionCard to="/settings" icon={Settings} title="Ajustes" sub="Preferencias" />
            </Section>
          )}
        </>
      ) : (
        <Section label="Operación">
          <ActionCard to="/handoff" icon={ArrowLeftRight} title="Traspaso de turno" sub="Entregar la caja" />
          <ActionCard to="/count" icon={ClipboardList} title="Conteo físico" sub="Ajustar existencias" />
          <ActionCard to="/help" icon={HelpCircle} title="Ayuda" sub="Cómo vender y cerrar" />
        </Section>
      )}
    </div>
  )
}
