import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { configRepo } from '../../repositories/configRepo'
import { ordersRepo } from '../../repositories/ordersRepo'
import { usersRepo } from '../../repositories/usersRepo'
import { shiftsRepo } from '../../repositories/shiftsRepo'
import { useAuth } from '../../app/providers/AuthProvider'
import { useLicense } from '../../app/providers/LicenseProvider'
import { LICENSE_MODULES } from '../../lib/license'
import { formatMoney } from '../../lib/currency'
import { ORDER_STATUS } from '../../db/constants'

// ---------------------------------------------------------------------------
// Panel del SALON (modulo 'mesas'). De un vistazo: el estado de cada mesa del
// local, cuanto lleva consumido, cuanto tiempo abierta y quien la atiende.
//
// Estados de una mesa:
//   LIBRE      - sin cuenta viva. Es tambien el estado al que vuelve en cuanto
//                se COBRA (el pedido pasa a 'closed' y deja de estar viva).
//   RESERVADA  - apartada para un cliente que aun no llega (sin consumo).
//   OCUPADA    - con cuenta en curso. Si lleva mas de una hora, se resalta.
//
//  - El dueño / administrativo ve TODAS las areas del local.
//  - El vendedor (camarero) ve solo el area de SU turno abierto.
// ---------------------------------------------------------------------------

function since(iso) {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

function minutesOpen(iso) {
  if (!iso) return 0
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

export function SalonScreen() {
  const { user, isManager } = useAuth()
  const { hasModule } = useLicense()
  const navigate = useNavigate()
  const [busy, setBusy] = useState('')
  const [menu, setMenu] = useState(null) // { area, table, order } al tocar una mesa

  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const tablesMap = useLiveQuery(() => configRepo.getTables(), [], {})
  const charges = useLiveQuery(() => configRepo.getServiceCharges(), [], {})
  // Mesas NO libres: ocupadas + reservadas.
  const active = useLiveQuery(() => ordersRepo.listActive(), [], [])
  const allItems = useLiveQuery(() => db.orderItems.toArray(), [], [])
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const baseCurrency = useLiveQuery(() => configRepo.getBaseCurrency(), [], 'MN')
  const myShift = useLiveQuery(() => (user ? shiftsRepo.getActiveFor(user.id) : null), [user?.id], undefined)

  if (!hasModule(LICENSE_MODULES.TABLES)) {
    return (
      <div className="screen">
        <h2>Mesas</h2>
        <p className="muted">Este módulo no está incluido en tu licencia.</p>
      </div>
    )
  }
  if (myShift === undefined) return <div className="screen"><p className="muted">Cargando…</p></div>

  const userName = (id) => users.find((u) => u.id === id)?.name || '—'
  const myArea = myShift?.area || ''
  const visibleAreas = isManager ? areas : (myArea ? [myArea] : [])

  const orderTotal = (orderId) =>
    allItems.filter((i) => i.orderId === orderId && !i.voided)
      .reduce((a, i) => a + Number(i.lineTotal || 0), 0)
  const orderCount = (orderId) =>
    allItems.filter((i) => i.orderId === orderId && !i.voided)
      .reduce((a, i) => a + Number(i.qty || 0), 0)

  const canOperate = (area) => !!myShift && myShift.area === area

  const openTable = async (area, table) => {
    if (!canOperate(area)) return
    setBusy(`${area}|${table}`)
    try {
      const id = await ordersRepo.open({ area, table, shiftId: myShift.id, userId: user.id })
      setMenu(null)
      navigate(`/mesa/${id}`)
    } finally { setBusy('') }
  }

  const reserveTable = async (area, table) => {
    setBusy(`${area}|${table}`)
    try {
      await ordersRepo.reserve({ area, table, userId: user.id })
      setMenu(null)
    } finally { setBusy('') }
  }

  const occupyReserved = async (order) => {
    if (!canOperate(order.area)) return
    setBusy(`${order.area}|${order.table}`)
    try {
      await ordersRepo.occupy({ orderId: order.id, shiftId: myShift.id, userId: user.id })
      setMenu(null)
      navigate(`/mesa/${order.id}`)
    } finally { setBusy('') }
  }

  const cancelReserve = async (order) => {
    setBusy(`${order.area}|${order.table}`)
    try {
      await ordersRepo.cancelReservation({ orderId: order.id, userId: user.id })
      setMenu(null)
    } finally { setBusy('') }
  }

  // Resumen: solo las OCUPADAS suman consumo (las reservadas aun no consumen).
  const busyOrders = active.filter((o) => o.status === ORDER_STATUS.OPEN)
  const totalAmount = busyOrders.reduce((a, o) => a + orderTotal(o.id), 0)
  const reservedCount = active.filter((o) => o.status === ORDER_STATUS.RESERVED).length

  return (
    <div className="screen">
      <h2>🍽️ Salón</h2>

      {visibleAreas.length === 0 && (
        <div className="card">
          <p className="muted">
            {isManager
              ? 'No hay áreas configuradas. Créalas en Ajustes y define sus mesas.'
              : 'Abre tu turno en un área para atender sus mesas.'}
          </p>
        </div>
      )}

      {visibleAreas.length > 0 && (
        <>
          <div className="salon-summary">
            <div className="salon-stat">
              <span className="salon-stat__num">{busyOrders.length}</span>
              <span className="salon-stat__lbl">ocupada(s)</span>
            </div>
            <div className="salon-stat">
              <span className="salon-stat__num">{reservedCount}</span>
              <span className="salon-stat__lbl">reservada(s)</span>
            </div>
            <div className="salon-stat">
              <span className="salon-stat__num salon-stat__num--money">{formatMoney(totalAmount, baseCurrency)}</span>
              <span className="salon-stat__lbl">consumo en curso</span>
            </div>
          </div>

          {/* Leyenda de estados */}
          <div className="salon-legend">
            <span className="salon-legend__item"><i className="dot dot--free" />Libre</span>
            <span className="salon-legend__item"><i className="dot dot--busy" />Ocupada</span>
            <span className="salon-legend__item"><i className="dot dot--reserved" />Reservada</span>
            <span className="salon-legend__item"><i className="dot dot--long" />+1 h</span>
          </div>
        </>
      )}

      {visibleAreas.map((area) => {
        const tables = Array.isArray(tablesMap[area]) ? tablesMap[area] : []
        const pct = Number(charges[area]) || 0
        const orphan = active.filter((o) => o.area === area && !tables.includes(o.table))
        const allTables = [...tables, ...orphan.map((o) => o.table)]
        return (
          <section key={area} className="card">
            <div className="salon-area-head">
              <h3>{area}</h3>
              {pct > 0 && <span className="muted">Servicio {pct}%</span>}
            </div>

            {allTables.length === 0 && (
              <p className="muted">
                Esta área no tiene mesas configuradas{isManager ? ' (Ajustes → Mesas y cuentas).' : '.'}
              </p>
            )}

            <div className="salon-grid">
              {allTables.map((t) => {
                const order = active.find((o) => o.area === area && o.table === t)
                const reserved = order?.status === ORDER_STATUS.RESERVED
                const occupied = order?.status === ORDER_STATUS.OPEN
                const long = occupied && minutesOpen(order.openedAt) >= 60
                const state = reserved ? 'reserved' : long ? 'long' : occupied ? 'busy' : 'free'
                const mine = canOperate(area)
                // Un toque abre/entra a la mesa (accion mas frecuente). El boton
                // "..." deja a mano reservar o cancelar sin estorbar.
                const primary = () => {
                  if (occupied) return navigate(`/mesa/${order.id}`)
                  if (reserved) return mine ? occupyReserved(order) : setMenu({ area, table: t, order })
                  return mine ? openTable(area, t) : setMenu({ area, table: t, order })
                }
                return (
                  <div key={t} className={`table-card table-card--${state}`}>
                    <button
                      className="table-card__more"
                      onClick={() => setMenu({ area, table: t, order })}
                      aria-label="Más acciones"
                    >⋯</button>
                    <button
                      className="table-card__main"
                      disabled={busy === `${area}|${t}`}
                      onClick={primary}
                    >
                    <span className="table-card__name">{t}</span>
                    {occupied && (
                      <>
                        <span className="table-card__total">{formatMoney(orderTotal(order.id), baseCurrency)}</span>
                        <span className="table-card__meta">{orderCount(order.id)} ítem(s) · {since(order.openedAt)}</span>
                        <span className="table-card__who">{userName(order.openedBy)}</span>
                      </>
                    )}
                    {reserved && (
                      <>
                        <span className="table-card__state">Reservada</span>
                        <span className="table-card__meta">hace {since(order.openedAt)}</span>
                      </>
                    )}
                    {!order && <span className="table-card__state">Libre</span>}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {/* Acciones al tocar una mesa libre o reservada */}
      {menu && (
        <div className="modal-backdrop" onClick={() => setMenu(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{menu.table}</h3>
            <p className="muted">{menu.area}</p>

            {!canOperate(menu.area) && !menu.order && (
              <p className="muted">Necesitas turno abierto en esta área para atenderla.</p>
            )}

            {menu.order?.status === ORDER_STATUS.RESERVED ? (
              <>
                <p className="muted">Mesa reservada hace {since(menu.order.openedAt)}.</p>
                {canOperate(menu.area) && (
                  <button className="btn btn--primary btn--block" onClick={() => occupyReserved(menu.order)}>
                    El cliente llegó · abrir cuenta
                  </button>
                )}
                <button className="btn btn--ghost btn--block" onClick={() => cancelReserve(menu.order)}>
                  Cancelar reserva
                </button>
              </>
            ) : (
              <>
                {canOperate(menu.area) && (
                  <button className="btn btn--primary btn--block" onClick={() => openTable(menu.area, menu.table)}>
                    Abrir cuenta
                  </button>
                )}
                <button className="btn btn--ghost btn--block" onClick={() => reserveTable(menu.area, menu.table)}>
                  Reservar mesa
                </button>
              </>
            )}

            <button className="btn btn--ghost btn--block" onClick={() => setMenu(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}
