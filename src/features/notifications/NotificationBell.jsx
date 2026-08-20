import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../../app/providers/AuthProvider'
import { notificationsRepo, NOTIFICATION_STATUS, NOTIFICATION_SEVERITY } from '../../repositories/notificationsRepo'
import { markAsRead, dismissNotification } from './notificationService'
import { formatDateTime } from '../../lib/dates'

// Centro visual de notificaciones (Fase 9). Campana + badge + panel desplegable,
// filtro por prioridad, marcar leído y ver detalle. Solo lo ve el MANDO
// (dueño/admin). Consume SIEMPRE datos reales de notificationsRepo (nada falso):
// si no hay avisos, el panel queda vacío.
//
// Rendimiento: el badge sale de `unreadCount()` (count indexado) y el panel de
// `feed()` (solo activas, acotado), NO de leer toda la tabla en cada cambio.

// Prioridad visual: CRITICAL rojo, WARNING amarillo, INFO azul.
const SEV = {
  [NOTIFICATION_SEVERITY.CRITICAL]: { cls: 'critical', dot: '🔴' },
  [NOTIFICATION_SEVERITY.WARNING]: { cls: 'warning', dot: '🟡' },
  [NOTIFICATION_SEVERITY.INFO]: { cls: 'info', dot: '🔵' }
}

const FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: NOTIFICATION_SEVERITY.CRITICAL, label: '🔴 Críticas' },
  { key: NOTIFICATION_SEVERITY.WARNING, label: '🟡 Advertencias' },
  { key: NOTIFICATION_SEVERITY.INFO, label: '🔵 Info' }
]

export function NotificationBell() {
  const { isManager, isOwner } = useAuth()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)

  // Badge: conteo de no leídas (count indexado). Sin mando, no consulta nada.
  const unreadCount = useLiveQuery(
    () => (isManager ? notificationsRepo.unreadCount() : Promise.resolve(0)),
    [isManager],
    0
  )
  // Panel: solo activas (unread + read), acotado y reciente-primero.
  const feedRows = useLiveQuery(
    () => (isManager ? notificationsRepo.feed() : Promise.resolve([])),
    [isManager],
    []
  )

  // Filtro por prioridad (en memoria sobre el feed acotado; barato).
  const feed = useMemo(() => {
    const byFilter = filter === 'all' ? feedRows : feedRows.filter((n) => n.severity === filter)
    return byFilter.slice(0, 50)
  }, [feedRows, filter])

  if (!isManager) return null

  const openItem = async (n) => {
    setExpanded((id) => (id === n.id ? null : n.id))
    if (n.status === NOTIFICATION_STATUS.UNREAD) await markAsRead(n.id)
  }
  const markAll = async () => {
    // Marca TODAS las no leídas (consulta directa, no depende del feed acotado).
    const list = await notificationsRepo.getUnread()
    for (const n of list) await markAsRead(n.id)
  }
  const dismiss = async (e, id) => {
    e.stopPropagation()
    await dismissNotification(id)
  }

  return (
    <div className="notif-wrap">
      <button
        className="notif-bell"
        aria-label={`Notificaciones${unreadCount ? ` (${unreadCount} sin leer)` : ''}`}
        title="Notificaciones"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} strokeWidth={2} />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <>
          <div className="notif-pop__backdrop" onClick={() => setOpen(false)} />
          <div className="notif-pop" role="dialog" aria-label="Centro de notificaciones">
            <div className="notif-pop__head">
              <strong>Notificaciones</strong>
              <div className="notif-pop__actions">
                {unreadCount > 0 && (
                  <button className="btn btn--ghost btn--sm" onClick={markAll}>Marcar leídas</button>
                )}
                {isOwner && (
                  <Link className="btn btn--ghost btn--sm" to="/notifications" onClick={() => setOpen(false)} title="Configurar">⚙</Link>
                )}
              </div>
            </div>

            <div className="chip-row">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`chip-btn ${filter === f.key ? 'is-active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {feed.length === 0 ? (
              <p className="notif-empty">Sin avisos{filter !== 'all' ? ' con este filtro' : ''}.</p>
            ) : (
              feed.map((n) => {
                const sev = SEV[n.severity] || SEV[NOTIFICATION_SEVERITY.INFO]
                const isUnread = n.status === NOTIFICATION_STATUS.UNREAD
                const isExpanded = expanded === n.id
                return (
                  <div
                    key={n.id}
                    className={`notif-item notif-item--${sev.cls} ${isUnread ? 'notif-item--unread' : ''}`}
                    onClick={() => openItem(n)}
                  >
                    <div className="notif-item__title">
                      {sev.dot} {n.title}
                      {isUnread && <span className="notif-item__new" aria-label="sin leer">•</span>}
                    </div>
                    <div className="notif-item__msg">{n.message}</div>
                    <div className="notif-item__time">
                      {formatDateTime(n.createdAt)}
                      {n.requiresAction ? ' · requiere revisión' : ''}
                    </div>
                    {isExpanded && (
                      <div className="notif-item__detail">
                        <button className="btn btn--ghost btn--sm" onClick={(e) => dismiss(e, n.id)}>
                          Descartar
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
