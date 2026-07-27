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

// ---------------------------------------------------------------------------
// Panel del SALON (modulo 'mesas'). De un vistazo: todas las mesas del local,
// cuales estan ocupadas, cuanto llevan consumido, cuanto tiempo abiertas y quien
// las atiende.
//
//  - El dueño / administrativo ve TODAS las areas del local.
//  - El vendedor (camarero) ve solo el area de SU turno abierto.
//
// Los datos son en vivo (useLiveQuery) y, como los pedidos se sincronizan, la
// caja ve lo que el camarero va agregando desde su telefono.
// ---------------------------------------------------------------------------

// "hace 12 min" a partir de una marca ISO.
function since(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${m % 60} min`
}

// Minutos abiertos (para resaltar mesas que llevan mucho tiempo).
function minutesOpen(iso) {
  if (!iso) return 0
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

export function SalonScreen() {
  const { user, isManager } = useAuth()
  const { hasModule } = useLicense()
  const navigate = useNavigate()
  const [busy, setBusy] = useState('')

  const areas = useLiveQuery(() => configRepo.getAreas(), [], [])
  const tablesMap = useLiveQuery(() => configRepo.getTables(), [], {})
  const charges = useLiveQuery(() => configRepo.getServiceCharges(), [], {})
  const openOrders = useLiveQuery(() => ordersRepo.listOpen(), [], [])
  // Todas las lineas vivas: para el total en curso de cada mesa.
  const allItems = useLiveQuery(() => db.orderItems.toArray(), [], [])
  const users = useLiveQuery(() => usersRepo.list(), [], [])
  const baseCurrency = useLiveQuery(() => configRepo.getBaseCurrency(), [], 'MN')
  // Turno abierto del usuario (el camarero solo opera en el area de su turno).
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
  // Areas visibles: el mando ve todo el local; el camarero solo la suya.
  const myArea = myShift?.area || ''
  const visibleAreas = isManager ? areas : (myArea ? [myArea] : [])

  // Total en curso de un pedido (solo lineas no anuladas).
  const orderTotal = (orderId) =>
    allItems
      .filter((i) => i.orderId === orderId && !i.voided)
      .reduce((a, i) => a + Number(i.lineTotal || 0), 0)

  const orderCount = (orderId) =>
    allItems.filter((i) => i.orderId === orderId && !i.voided).length

  // Abre (o retoma) la cuenta de una mesa y entra a ella.
  const openTable = async (area, table) => {
    if (!myShift || myShift.area !== area) return
    setBusy(`${area}|${table}`)
    try {
      const id = await ordersRepo.open({ area, table, shiftId: myShift.id, userId: user.id })
      navigate(`/mesa/${id}`)
    } finally {
      setBusy('')
    }
  }

  // Resumen del local (cabecera del panel).
  const totalOpen = openOrders.length
  const totalAmount = openOrders.reduce((a, o) => a + orderTotal(o.id), 0)

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

      {/* Resumen en vivo del local */}
      {visibleAreas.length > 0 && (
        <div className="salon-summary">
          <div className="salon-stat">
            <span className="salon-stat__num">{totalOpen}</span>
            <span className="salon-stat__lbl">cuenta(s) abierta(s)</span>
          </div>
          <div className="salon-stat">
            <span className="salon-stat__num">{formatMoney(totalAmount, baseCurrency)}</span>
            <span className="salon-stat__lbl">consumo en curso</span>
          </div>
        </div>
      )}

      {visibleAreas.map((area) => {
        const tables = Array.isArray(tablesMap[area]) ? tablesMap[area] : []
        const pct = Number(charges[area]) || 0
        // Cuentas abiertas del area que ya no estan en la lista de mesas (la
        // mesa se quito de Ajustes): se siguen mostrando para poder cobrarlas.
        const orphan = openOrders.filter((o) => o.area === area && !tables.includes(o.table))
        return (
          <section key={area} className="card">
            <div className="kv">
              <h3 style={{ margin: 0 }}>{area}</h3>
              {pct > 0 && <span className="muted">Servicio {pct}%</span>}
            </div>

            {tables.length === 0 && orphan.length === 0 && (
              <p className="muted">
                Esta área no tiene mesas configuradas{isManager ? ' (Ajustes → Mesas y cuentas).' : '.'}
              </p>
            )}

            <div className="salon-grid">
              {[...tables, ...orphan.map((o) => o.table)].map((t) => {
                const order = openOrders.find((o) => o.area === area && o.table === t)
                const busyThis = busy === `${area}|${t}`
                const mine = myShift && myShift.area === area
                const mins = order ? minutesOpen(order.openedAt) : 0
                const long = mins >= 60 // lleva mucho abierta: se resalta
                return (
                  <button
                    key={t}
                    className={`table-card ${order ? (long ? 'table-card--long' : 'table-card--busy') : 'table-card--free'}`}
                    disabled={busyThis || (!order && !mine)}
                    onClick={() => (order ? navigate(`/mesa/${order.id}`) : openTable(area, t))}
                    title={order ? 'Ver la cuenta' : (mine ? 'Abrir cuenta' : 'Solo el vendedor con turno en esta área puede abrirla')}
                  >
                    <span className="table-card__name">{t}</span>
                    {order ? (
                      <>
                        <span className="table-card__total">{formatMoney(orderTotal(order.id), baseCurrency)}</span>
                        <span className="table-card__meta">
                          {orderCount(order.id)} ítem(s) · {since(order.openedAt)}
                        </span>
                        <span className="table-card__who">{userName(order.openedBy)}</span>
                      </>
                    ) : (
                      <span className="table-card__meta">{busyThis ? 'Abriendo…' : 'Libre'}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}

      {isManager && openOrders.length > 0 && (
        <p className="muted">
          Toca cualquier mesa para ver su cuenta y cobrarla. Las mesas en rojo llevan
          más de una hora abiertas.
        </p>
      )}
    </div>
  )
}
